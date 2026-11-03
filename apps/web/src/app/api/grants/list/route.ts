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

  // The other party, so people recognise who a grant is with. A person with a
  // profile is shown by name and username, and then the address stays on the
  // server: the username is the only name people agreed to share. The address
  // is only a fallback for someone without a profile.
  const otherIds = [...new Set(grants.map((g) => (role === 'owner' ? g.grantee_id : g.owner_id)))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name')
    .in('user_id', otherIds);
  const labels = new Map<string, string>();
  for (const p of profiles ?? []) {
    labels.set(p.user_id, p.display_name ? `${p.display_name} (@${p.handle})` : `@${p.handle}`);
  }
  const emails = new Map<string, string>();
  await Promise.all(
    otherIds
      .filter((id) => !labels.has(id))
      .map(async (id) => {
        const { data: found } = await supabase.auth.admin.getUserById(id);
        if (found?.user?.email) emails.set(id, found.user.email);
      }),
  );
  const who = (id: string) => ({
    label: labels.get(id) ?? emails.get(id) ?? null,
    email: emails.get(id) ?? null,
  });

  return NextResponse.json({
    grants: grants.map((g) => ({
      ...g,
      grantee_label: who(g.grantee_id).label,
      grantee_email: who(g.grantee_id).email,
      owner_label: who(g.owner_id).label,
      owner_email: who(g.owner_id).email,
    })),
  });
}
