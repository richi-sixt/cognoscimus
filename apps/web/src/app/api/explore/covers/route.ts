import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { getDownloadSignedUrl } from '@/utils/object';
import { canBrowseLibrary, visibleBookHashes } from '@/libs/exploreServer';
import { isUuid } from '@/libs/grantsServer';
import { EXPLORE_COVER_TTL_SECONDS, EXPLORE_PAGE_SIZE } from '@/services/constants';

// POST /api/explore/covers { ownerId, hashes } — signs the cover images of one
// page of a followed person's shared library. Only for an accepted follower of
// an owner who shares the library, and never for hidden books.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { ownerId?: unknown; hashes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const hashes = Array.isArray(body.hashes)
    ? body.hashes.filter(
        (h): h is string => typeof h === 'string' && h.length > 0 && h.length <= 64,
      )
    : [];
  if (!isUuid(body.ownerId) || hashes.length === 0 || hashes.length > EXPLORE_PAGE_SIZE * 2) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  try {
    if (!(await canBrowseLibrary(supabase, user.id, body.ownerId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const allowed = await visibleBookHashes(supabase, body.ownerId, hashes);
    if (allowed.length === 0) return NextResponse.json({ urls: {} });

    // The cover is a `files` row next to the book; its key comes from there.
    const { data: files, error } = await supabase
      .from('files')
      .select('book_hash, file_key')
      .eq('user_id', body.ownerId)
      .in('book_hash', allowed)
      .like('file_key', '%/cover.png')
      .is('deleted_at', null);
    if (error) throw error;

    const urls: Record<string, string> = {};
    await Promise.all(
      (files ?? []).map(async (f) => {
        urls[f.book_hash as string] = await getDownloadSignedUrl(
          f.file_key as string,
          EXPLORE_COVER_TTL_SECONDS,
        );
      }),
    );
    return NextResponse.json({ urls });
  } catch (error) {
    console.error('explore covers failed:', error);
    return NextResponse.json({ error: 'Could not load covers' }, { status: 500 });
  }
}
