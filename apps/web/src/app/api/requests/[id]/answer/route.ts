import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { createGrant, isUuid } from '@/libs/grantsServer';
import { borrowAnswerMail, notifyUser } from '@/libs/notifyServer';
import { createLoan, isPhysicalFormat, readDueDate } from '@/libs/loansServer';
import { REQUEST_COLUMNS, type BookRequestRow } from '@/libs/requestsServer';
import { GRANT_EXPIRATION_DAYS } from '@/services/constants';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/requests/[id]/answer { accept, expirationDays?, dueDate? } — owner only.
// Accepting creates (or renews) the grant for the requester; for a printed book it
// notes the loan instead, with an optional return date. Declining keeps the row so
// the requester sees the answer.
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { accept?: unknown; expirationDays?: unknown; dueDate?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.accept !== 'boolean') {
    return NextResponse.json({ error: 'accept must be true or false' }, { status: 400 });
  }
  const days = body.expirationDays;
  const dueAt = readDueDate(body.dueDate);
  if (dueAt === undefined) {
    return NextResponse.json(
      { error: 'This is not a valid date', code: 'invalid_date' },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  try {
    const { data, error } = await supabase
      .from('book_requests')
      .select(REQUEST_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const row = data as BookRequestRow | null;
    // Someone else's request answers like a missing one.
    if (!row || row.owner_id !== user.id) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json(
        { error: 'This request was already answered', code: 'already_answered' },
        { status: 409 },
      );
    }

    const printed = isPhysicalFormat(row.book_format);
    if (body.accept && printed) {
      // A printed book is handed over in person: note who has it.
      const { data: requester } = await supabase
        .from('profiles')
        .select('handle')
        .eq('user_id', row.requester_id)
        .maybeSingle();
      const result = await createLoan(supabase, {
        ownerId: user.id,
        bookHash: row.book_hash,
        borrowerId: row.requester_id,
        borrowerName: requester?.handle ? `@${requester.handle}` : 'Follower',
        dueAt,
      });
      if ('error' in result) {
        return NextResponse.json(
          { error: result.error.message, code: result.error.code },
          { status: result.error.status },
        );
      }
    } else if (body.accept) {
      if (
        !(typeof days === 'number' && (GRANT_EXPIRATION_DAYS as readonly number[]).includes(days))
      ) {
        return NextResponse.json(
          {
            error: `expirationDays must be one of ${GRANT_EXPIRATION_DAYS.join(', ')}`,
            code: 'invalid_expiration',
          },
          { status: 400 },
        );
      }
      const result = await createGrant(supabase, {
        ownerId: user.id,
        granteeId: row.requester_id,
        bookHash: row.book_hash,
        expirationDays: days as number,
      });
      if ('error' in result) {
        return NextResponse.json(
          { error: result.error.message, code: result.error.code },
          { status: result.error.status },
        );
      }
    }

    const { error: updateError } = await supabase
      .from('book_requests')
      .update({
        status: body.accept ? 'accepted' : 'declined',
        answered_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending');
    if (updateError) throw updateError;

    const { data: me } = await supabase
      .from('profiles')
      .select('handle')
      .eq('user_id', user.id)
      .maybeSingle();
    await notifyUser(
      supabase,
      row.requester_id,
      borrowAnswerMail({
        ownerHandle: me?.handle ?? '',
        bookTitle: row.book_title,
        accepted: body.accept,
        printed,
      }),
    );
    return NextResponse.json({ status: body.accept ? 'accepted' : 'declined' });
  } catch (error) {
    console.error('book_requests answer failed:', error);
    return NextResponse.json({ error: 'Could not answer the request' }, { status: 500 });
  }
}
