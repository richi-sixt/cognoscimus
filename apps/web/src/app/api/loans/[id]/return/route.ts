import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { isUuid } from '@/libs/grantsServer';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/loans/[id]/return — owner only: the printed book is back.
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid loan id' }, { status: 400 });

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    // Someone else's loan answers like a missing one.
    const { data, error } = await createSupabaseAdminClient()
      .from('book_loans')
      .update({ returned_at: new Date().toISOString() })
      .eq('id', id)
      .eq('owner_id', user.id)
      .is('returned_at', null)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
    }
    return NextResponse.json({ returned: true });
  } catch (error) {
    console.error('book_loans return failed:', error);
    return NextResponse.json({ error: 'Could not save the return' }, { status: 500 });
  }
}
