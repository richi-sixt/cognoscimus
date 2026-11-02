import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { createGrant, isPlausibleEmail } from '@/libs/grantsServer';
import { GRANT_EXPIRATION_DAYS } from '@/services/constants';

interface CreateGrantBody {
  bookHash?: unknown;
  granteeEmail?: unknown;
  expirationDays?: unknown;
}

const isAllowedExpiration = (value: unknown): value is number =>
  typeof value === 'number' && (GRANT_EXPIRATION_DAYS as readonly number[]).includes(value);

// POST /api/grants/create — owner shares one of their uploaded books with a
// registered user until the chosen expiry. Sharing the same book with the same
// person again renews the grant (new expiry, revocation cleared).
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: CreateGrantBody;
  try {
    body = (await request.json()) as CreateGrantBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bookHash = typeof body.bookHash === 'string' ? body.bookHash.trim() : '';
  if (!bookHash || bookHash.length > 64) {
    return NextResponse.json({ error: 'Missing or invalid bookHash' }, { status: 400 });
  }
  if (!isPlausibleEmail(body.granteeEmail)) {
    return NextResponse.json(
      { error: 'Invalid email address', code: 'invalid_email' },
      { status: 400 },
    );
  }
  if (!isAllowedExpiration(body.expirationDays)) {
    return NextResponse.json(
      {
        error: `expirationDays must be one of ${GRANT_EXPIRATION_DAYS.join(', ')}`,
        code: 'invalid_expiration',
      },
      { status: 400 },
    );
  }
  const granteeEmail = body.granteeEmail.trim();

  if (user.email && user.email.toLowerCase() === granteeEmail.toLowerCase()) {
    return NextResponse.json(
      { error: 'You cannot share a book with yourself', code: 'self_grant' },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();

  try {
    const { data: granteeId, error: lookupError } = await supabase.rpc('find_user_id_by_email', {
      p_email: granteeEmail,
    });
    if (lookupError) throw lookupError;
    if (!granteeId) {
      return NextResponse.json(
        { error: 'No user with this email address', code: 'user_not_found' },
        { status: 404 },
      );
    }
    if (granteeId === user.id) {
      return NextResponse.json(
        { error: 'You cannot share a book with yourself', code: 'self_grant' },
        { status: 400 },
      );
    }

    const result = await createGrant(supabase, {
      ownerId: user.id,
      granteeId,
      bookHash,
      expirationDays: body.expirationDays,
    });
    if ('error' in result) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status: result.error.status },
      );
    }
    const grant = result.grant;

    return NextResponse.json({ grant: { ...grant, grantee_email: granteeEmail } });
  } catch (error) {
    console.error('book_grants create failed:', error);
    return NextResponse.json({ error: 'Could not create grant' }, { status: 500 });
  }
}
