import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { readCapturedHtml } from '@/libs/later/captured';
import { authenticateLater } from '@/libs/later/extensionAuth';
import { NoArticleError } from '@/libs/later/extract';
import { fetchPage, FetchPageError, normalizeUrl } from '@/libs/later/fetchPage';
import { bookmarkFromUrl, ingestPage, type IngestedItem, toRow } from '@/libs/later/ingest';
import { kindFromUrl } from '@/libs/later/kind';
import { FetchBlockedError } from '@/libs/later/ssrf';
import { TRASH_RETENTION_DAYS } from '@/libs/later/constants';
import { isUuid } from '@/libs/grantsServer';

const URL_MAX_LENGTH = 2048;

// POST /api/later/save — fetches a web page, extracts the readable article and
// stores it for the signed-in user. Saving a link again refreshes the stored
// copy and keeps its reading state. A browser extension may send the page as
// the browser shows it (`html`); it then takes the place of the download and
// goes through the same extraction and sanitising.
export async function POST(request: Request) {
  // The browser extension signs in with a token of its own.
  const who = await authenticateLater(request);
  if (!who) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const user = { id: who.userId };

  let body: { url?: unknown; collectionId?: unknown; html?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; collectionId?: unknown; html?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > URL_MAX_LENGTH) {
    return NextResponse.json(
      { error: 'Missing or invalid url', code: 'invalid_url' },
      { status: 400 },
    );
  }

  if (body.collectionId !== undefined && !isUuid(body.collectionId)) {
    return NextResponse.json({ error: 'Invalid collectionId' }, { status: 400 });
  }

  const captured = readCapturedHtml(body.html);
  if (!captured.ok) {
    return NextResponse.json(
      { error: 'Invalid or too large page content', code: captured.code },
      { status: captured.code === 'too_large' ? 413 : 400 },
    );
  }

  try {
    const target = normalizeUrl(body.url);
    // Files such as PDFs are kept as bookmarks without being downloaded.
    let finalUrl = target;
    let article: IngestedItem;
    if (kindFromUrl(target) === 'document') {
      article = bookmarkFromUrl(target, 'document');
    } else if (captured.html) {
      article = ingestPage(captured.html, target.toString());
    } else {
      const page = await fetchPage(target);
      finalUrl = page.finalUrl;
      article = ingestPage(page.html, finalUrl.toString());
    }

    const supabase = createSupabaseAdminClient();

    // Only the user's own collection may receive the article.
    if (body.collectionId) {
      const { data: collection, error: collectionError } = await supabase
        .from('later_collections')
        .select('id')
        .eq('id', body.collectionId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (collectionError) throw collectionError;
      if (!collection) {
        return NextResponse.json(
          { error: 'Collection not found', code: 'collection_not_found' },
          { status: 404 },
        );
      }
    }

    // Housekeeping: drop this user's trash that has outlived its retention.
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await supabase
      .from('later_items')
      .delete()
      .eq('user_id', user.id)
      .lt('deleted_at', cutoff.toISOString());

    const { data, error } = await supabase
      .from('later_items')
      .upsert(
        {
          user_id: user.id,
          url: normalizeUrl(finalUrl.toString()).toString(),
          ...toRow(article),
          // Saving a link again also takes it out of the trash.
          deleted_at: null,
          // Without a target collection a saved-again link keeps the one it has.
          ...(body.collectionId ? { collection_id: body.collectionId } : {}),
        },
        { onConflict: 'user_id,url' },
      )
      .select('id, title, kind, collection_id, note')
      .single();
    if (error) throw error;

    // A link that was saved before comes back with what it already carries, so
    // the extension shows its note, collection and labels instead of blanks.
    const { data: links, error: linksError } = await supabase
      .from('later_item_labels')
      .select('later_labels(name)')
      .eq('item_id', data.id);
    if (linksError) throw linksError;
    const labels = (links ?? [])
      .flatMap((link) => link.later_labels as { name: string } | { name: string }[] | null)
      .flatMap((label) => (label ? [label.name] : []));

    return NextResponse.json({
      id: data.id,
      title: data.title,
      kind: data.kind,
      collectionId: data.collection_id,
      note: data.note,
      labels,
    });
  } catch (error) {
    if (error instanceof FetchBlockedError) {
      return NextResponse.json({ error: error.message, code: 'blocked_url' }, { status: 400 });
    }
    if (error instanceof FetchPageError) {
      const status = error.code === 'fetch_failed' ? 502 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof NoArticleError) {
      return NextResponse.json({ error: error.message, code: 'no_content' }, { status: 422 });
    }
    console.error('later save failed:', error);
    return NextResponse.json({ error: 'Could not save the article' }, { status: 500 });
  }
}
