import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { findBookFile, GRANT_COLUMNS, isPlausibleEmail } from '@/libs/grantsServer';
import { GRANT_EXPIRATION_DAYS, GRANT_MAX_ACTIVE_PER_OWNER } from '@/services/constants';

interface CreateGrantBody {
  bookHash?: unknown;
  granteeEmail?: unknown;
  expirationDays?: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

    // Display data comes from the owner's own library row, never the client.
    const { data: book, error: bookError } = await supabase
      .from('books')
      .select('title, author, format')
      .eq('user_id', user.id)
      .eq('book_hash', bookHash)
      .is('deleted_at', null)
      .maybeSingle();
    if (bookError) throw bookError;
    if (!book) {
      return NextResponse.json(
        { error: 'Book not found', code: 'book_not_found' },
        { status: 404 },
      );
    }

    const file = await findBookFile(supabase, user.id, bookHash);
    if (!file) {
      return NextResponse.json(
        { error: 'Book is not uploaded yet', code: 'book_not_uploaded' },
        { status: 409 },
      );
    }

    const nowIso = new Date().toISOString();
    const { count, error: countError } = await supabase
      .from('book_grants')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .is('revoked_at', null)
      .gt('expires_at', nowIso);
    if (countError) throw countError;
    if ((count ?? 0) >= GRANT_MAX_ACTIVE_PER_OWNER) {
      return NextResponse.json(
        {
          error: `You have reached the maximum of ${GRANT_MAX_ACTIVE_PER_OWNER} active grants.`,
          code: 'grant_limit_reached',
        },
        { status: 429 },
      );
    }

    const expiresAt = new Date(Date.now() + body.expirationDays * DAY_MS).toISOString();
    const { data: grant, error: upsertError } = await supabase
      .from('book_grants')
      .upsert(
        {
          owner_id: user.id,
          grantee_id: granteeId,
          book_hash: bookHash,
          book_title: book.title || 'Untitled',
          book_author: book.author || null,
          book_format: (book.format || '').toLowerCase() || 'epub',
          expires_at: expiresAt,
          revoked_at: null,
          created_at: nowIso,
        },
        { onConflict: 'owner_id,grantee_id,book_hash' },
      )
      .select(GRANT_COLUMNS)
      .single();
    if (upsertError) throw upsertError;

    return NextResponse.json({ grant: { ...grant, grantee_email: granteeEmail } });
  } catch (error) {
    console.error('book_grants create failed:', error);
    return NextResponse.json({ error: 'Could not create grant' }, { status: 500 });
  }
}
