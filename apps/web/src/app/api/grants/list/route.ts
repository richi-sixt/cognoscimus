import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { GRANT_COLUMNS, type GrantRow } from '@/libs/grantsServer';

const LIMIT = 200;

// GET /api/grants/list?role=owner|grantee
//   owner   – every grant the caller handed out (active, expired, revoked)
//   grantee – grants the caller can use right now (not revoked, not expired)
export async function GET(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const role = new URL(request.url).searchParams.get('role');
  if (role !== 'owner' && role !== 'grantee') {
    return NextResponse.json({ error: 'role must be owner or grantee' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  let query = supabase.from('book_grants').select(GRANT_COLUMNS);
  if (role === 'owner') {
    query = query.eq('owner_id', user.id);
  } else {
    query = query
      .eq('grantee_id', user.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(LIMIT);
  if (error) {
    console.error('book_grants list failed:', error);
    return NextResponse.json({ error: 'Could not list grants' }, { status: 500 });
  }

  const grants = (data ?? []) as GrantRow[];

  // The other party's email, so people recognise who a grant is with.
  const otherIds = [...new Set(grants.map((g) => (role === 'owner' ? g.grantee_id : g.owner_id)))];
  const emails = new Map<string, string>();
  await Promise.all(
    otherIds.map(async (id) => {
      const { data: found } = await supabase.auth.admin.getUserById(id);
      if (found?.user?.email) emails.set(id, found.user.email);
    }),
  );

  return NextResponse.json({
    grants: grants.map((g) => ({
      ...g,
      grantee_email: emails.get(g.grantee_id) ?? null,
      owner_email: emails.get(g.owner_id) ?? null,
    })),
  });
}
