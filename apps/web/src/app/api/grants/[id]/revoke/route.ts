import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { isUuid } from '@/libs/grantsServer';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/grants/[id]/revoke — owner only. The grantee loses access at once;
// a download URL signed a moment earlier stays valid until its short TTL ends.
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Invalid grant id' }, { status: 400 });
  }

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: grant, error: lookupError } = await supabase
    .from('book_grants')
    .select('id, owner_id, revoked_at')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('book_grants lookup failed:', lookupError);
    return NextResponse.json({ error: 'Could not look up grant' }, { status: 500 });
  }
  // A grant of someone else answers like a missing one.
  if (!grant || grant.owner_id !== user.id) {
    return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
  }
  if (grant.revoked_at) return new NextResponse(null, { status: 204 });

  const { error: updateError } = await supabase
    .from('book_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  if (updateError) {
    console.error('book_grants revoke failed:', updateError);
    return NextResponse.json({ error: 'Could not revoke grant' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
