import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { REQUEST_COLUMNS, type BookRequestRow } from '@/libs/requestsServer';

// GET /api/requests/list?role=owner|requester — requests for the caller's books
// (owner) or the caller's own requests (requester), newest first, with the other
// person's handle. Handles come from the profiles table, never the e-mail.
export async function GET(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const role =
    new URL(request.url).searchParams.get('role') === 'requester' ? 'requester' : 'owner';
  const supabase = createSupabaseAdminClient();
  try {
    const { data, error } = await supabase
      .from('book_requests')
      .select(REQUEST_COLUMNS)
      .eq(role === 'owner' ? 'owner_id' : 'requester_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as BookRequestRow[];

    const otherIds = [
      ...new Set(rows.map((r) => (role === 'owner' ? r.requester_id : r.owner_id))),
    ];
    const handles = new Map<string, { handle: string; display_name: string }>();
    if (otherIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, handle, display_name')
        .in('user_id', otherIds);
      if (profileError) throw profileError;
      for (const p of profiles ?? []) handles.set(p.user_id, p);
    }

    return NextResponse.json({
      requests: rows.map((r) => {
        const other = handles.get(role === 'owner' ? r.requester_id : r.owner_id);
        return { ...r, other_handle: other?.handle ?? '', other_name: other?.display_name ?? '' };
      }),
    });
  } catch (error) {
    console.error('book_requests list failed:', error);
    return NextResponse.json({ error: 'Could not load requests' }, { status: 500 });
  }
}
