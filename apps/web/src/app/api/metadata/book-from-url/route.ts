import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { extractBookFromPage } from '@/libs/bookPage';
import { FetchPageError, fetchPage, normalizeUrl } from '@/libs/later/fetchPage';
import { FetchBlockedError } from '@/libs/later/ssrf';

const fail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status });

// POST /api/metadata/book-from-url { url } — reads title, author, ISBN and cover
// from a bookshop page. Nothing is stored; the answer fills the form.
export async function POST(request: Request) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) return fail(401, 'unauthenticated', 'Not authenticated');

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  if (typeof body?.url !== 'string' || !body.url.trim() || body.url.length > 2000) {
    return fail(400, 'invalid_url', 'A link is required');
  }
  let target: URL;
  try {
    target = normalizeUrl(body.url);
  } catch {
    return fail(400, 'invalid_url', 'This is not a valid link');
  }

  try {
    const { html, finalUrl } = await fetchPage(target);
    const book = extractBookFromPage(html, finalUrl.toString());
    if (!book) return fail(422, 'no_book', 'No book was found on this page');
    return NextResponse.json({ book });
  } catch (error) {
    if (error instanceof FetchBlockedError) return fail(400, 'blocked', error.message);
    if (error instanceof FetchPageError) return fail(422, error.code, error.message);
    console.error('book from url failed:', error);
    return fail(500, 'server_error', 'The page could not be read');
  }
}
