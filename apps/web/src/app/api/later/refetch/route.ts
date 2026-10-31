import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { NoArticleError } from '@/libs/later/extract';
import { fetchPage, FetchPageError, normalizeUrl } from '@/libs/later/fetchPage';
import { bookmarkFromUrl, ingestPage, type IngestedItem, toRow } from '@/libs/later/ingest';
import { kindFromUrl } from '@/libs/later/kind';
import { FetchBlockedError } from '@/libs/later/ssrf';
import { isUuid } from '@/libs/grantsServer';

// POST /api/later/refetch — loads the article text of a link that was imported
// (or whose first fetch failed). The saved title is kept when the page has none.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { id?: unknown; asArticle?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; asArticle?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isUuid(body.id)) {
    return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: item, error: readError } = await supabase
    .from('later_items')
    .select('id, url, title, fetch_state')
    .eq('id', body.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError) {
    console.error('later refetch read failed:', readError);
    return NextResponse.json({ error: 'Could not load the article' }, { status: 500 });
  }
  if (!item) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

  // An article that already has its text keeps it when a retry fails.
  const markFailed = () =>
    item.fetch_state === 'ready'
      ? Promise.resolve()
      : supabase.from('later_items').update({ fetch_state: 'failed' }).eq('id', item.id);

  try {
    const target = normalizeUrl(item.url as string);
    let ingested: IngestedItem;
    if (kindFromUrl(target) === 'document' && !body.asArticle) {
      // Files such as PDFs stay bookmarks and are not downloaded.
      ingested = { ...bookmarkFromUrl(target, 'document'), title: item.title as string };
    } else {
      const { html, finalUrl } = await fetchPage(target);
      ingested = ingestPage(html, finalUrl.toString(), { asArticle: body.asArticle === true });
    }
    const { error } = await supabase
      .from('later_items')
      .update({
        ...toRow(ingested),
        title: ingested.title || item.title,
        fetch_state: 'ready',
      })
      .eq('id', item.id);
    if (error) throw error;
    return NextResponse.json({ id: item.id });
  } catch (error) {
    if (
      error instanceof FetchBlockedError ||
      error instanceof FetchPageError ||
      error instanceof NoArticleError
    ) {
      await markFailed();
      const code =
        error instanceof FetchBlockedError
          ? 'blocked_url'
          : error instanceof NoArticleError
            ? 'no_content'
            : error.code;
      return NextResponse.json({ error: error.message, code }, { status: 422 });
    }
    console.error('later refetch failed:', error);
    return NextResponse.json({ error: 'Could not load the article' }, { status: 500 });
  }
}
