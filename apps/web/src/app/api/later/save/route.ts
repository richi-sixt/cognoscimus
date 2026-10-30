import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { extractArticle, NoArticleError } from '@/libs/later/extract';
import { fetchPage, FetchPageError, normalizeUrl } from '@/libs/later/fetchPage';
import { FetchBlockedError } from '@/libs/later/ssrf';
import { TRASH_RETENTION_DAYS } from '@/libs/later/constants';

const URL_MAX_LENGTH = 2048;

// POST /api/later/save — fetches a web page, extracts the readable article and
// stores it for the signed-in user. Saving a link again refreshes the stored
// copy and keeps its reading state.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > URL_MAX_LENGTH) {
    return NextResponse.json(
      { error: 'Missing or invalid url', code: 'invalid_url' },
      { status: 400 },
    );
  }

  try {
    const { html, finalUrl } = await fetchPage(normalizeUrl(body.url));
    const article = extractArticle(html, finalUrl.toString());

    const supabase = createSupabaseAdminClient();

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
          title: article.title,
          author: article.author,
          site_name: article.siteName,
          excerpt: article.excerpt,
          content_html: article.contentHtml,
          content_text: article.contentText,
          thumbnail: article.thumbnail,
          word_count: article.wordCount,
          // Saving a link again also takes it out of the trash.
          deleted_at: null,
        },
        { onConflict: 'user_id,url' },
      )
      .select('id')
      .single();
    if (error) throw error;

    return NextResponse.json({ id: data.id });
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
