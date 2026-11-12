import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { createLoan, readBorrowerName, readDueDate } from '@/libs/loansServer';

const fail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status });

// POST /api/loans/create { bookHash, borrowerName, dueDate? } — the owner notes
// by hand that a printed book is with someone, who needs no account.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return fail(401, 'unauthenticated', 'Not authenticated');

  const body = (await request.json().catch(() => null)) as {
    bookHash?: unknown;
    borrowerName?: unknown;
    dueDate?: unknown;
  } | null;
  const bookHash = typeof body?.bookHash === 'string' ? body.bookHash.trim() : '';
  const borrowerName = readBorrowerName(body?.borrowerName);
  const dueAt = readDueDate(body?.dueDate);
  if (!bookHash || bookHash.length > 64) return fail(400, 'invalid_request', 'Invalid request');
  if (!borrowerName) return fail(400, 'invalid_name', 'A name is required');
  if (dueAt === undefined) return fail(400, 'invalid_date', 'This is not a valid date');

  try {
    const result = await createLoan(createSupabaseAdminClient(), {
      ownerId: user.id,
      bookHash,
      borrowerId: null,
      borrowerName,
      dueAt,
    });
    if ('error' in result) {
      return fail(result.error.status, result.error.code, result.error.message);
    }
    return NextResponse.json({ loan: result.loan });
  } catch (error) {
    console.error('book_loans create failed:', error);
    return fail(500, 'server_error', 'Could not save the loan');
  }
}
