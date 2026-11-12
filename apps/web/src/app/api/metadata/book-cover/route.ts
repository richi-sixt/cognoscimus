import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { CoverFetchError, fetchCoverImage } from '@/libs/bookLookupServer';
import { FetchBlockedError } from '@/libs/later/ssrf';

const fail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status });

// POST /api/metadata/book-cover { url } — hands a cover image from a public
// address to the signed-in user. The library page is cross-origin isolated and
// cannot load foreign images itself.
export async function POST(request: Request) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) return fail(401, 'unauthenticated', 'Not authenticated');

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  let target: URL;
  try {
    if (typeof body?.url !== 'string' || body.url.length > 2000) throw new Error('invalid');
    target = new URL(body.url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('invalid');
  } catch {
    return fail(400, 'invalid_url', 'This is not a valid link');
  }

  try {
    const { bytes, type } = await fetchCoverImage(target);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof FetchBlockedError) return fail(400, 'blocked', error.message);
    if (error instanceof CoverFetchError) return fail(422, error.code, error.message);
    console.error('book cover failed:', error);
    return fail(502, 'fetch_failed', 'The image could not be loaded');
  }
}
