import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { getDownloadSignedUrl } from '@/utils/object';
import {
  findBookFile,
  GRANT_COLUMNS,
  isGrantActive,
  isUuid,
  type GrantRow,
} from '@/libs/grantsServer';
import { GRANT_PRESIGN_TTL_SECONDS } from '@/services/constants';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/grants/[id]/download — grantee only. Signs a short-lived URL for the
// owner's book file after checking the grant is neither revoked nor expired.
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid grant id' }, { status: 400 });
  }

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  try {
    const { data, error } = await supabase
      .from('book_grants')
      .select(GRANT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const grant = data as GrantRow | null;

    // Someone else's grant answers like a missing one.
    if (!grant || grant.grantee_id !== user.id) {
      return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
    }
    if (!isGrantActive(grant)) {
      return NextResponse.json(
        { error: 'This grant has expired or was revoked', code: 'grant_inactive' },
        { status: 403 },
      );
    }

    const file = await findBookFile(supabase, grant.owner_id, grant.book_hash);
    if (!file) {
      return NextResponse.json(
        { error: 'The book is no longer available', code: 'book_unavailable' },
        { status: 404 },
      );
    }

    const url = await getDownloadSignedUrl(file.file_key, GRANT_PRESIGN_TTL_SECONDS);
    return NextResponse.json({
      url,
      bookHash: grant.book_hash,
      title: grant.book_title,
      author: grant.book_author,
      format: grant.book_format,
      expiresAt: grant.expires_at,
    });
  } catch (error) {
    console.error('book_grants download failed:', error);
    return NextResponse.json({ error: 'Could not prepare download' }, { status: 500 });
  }
}
