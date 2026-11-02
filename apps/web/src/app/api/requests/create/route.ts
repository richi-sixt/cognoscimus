import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { canBrowseLibrary, visibleBookHashes } from '@/libs/exploreServer';
import { findBookFile, isUuid } from '@/libs/grantsServer';
import { borrowRequestMail, notifyUser } from '@/libs/notifyServer';
import { mayAskAgain, REQUEST_COLUMNS, type BookRequestRow } from '@/libs/requestsServer';
import {
  BOOK_REQUEST_MAX_PENDING,
  BOOK_REQUEST_MESSAGE_MAX,
  BOOK_REQUEST_RETRY_DAYS,
} from '@/services/constants';

const fail = (status: number, code: string, error: string) =>
  NextResponse.json({ error, code }, { status });

// POST /api/requests/create { ownerId, bookHash, message? } — a follower asks to
// borrow one book of a shared library. The owner answers; accepting creates the
// grant. One row per person and book: a declined request can be sent again only
// after the retry period.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) return fail(401, 'unauthenticated', 'Not authenticated');

  let body: { ownerId?: unknown; bookHash?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail(400, 'invalid_body', 'Invalid JSON body');
  }
  const bookHash = typeof body.bookHash === 'string' ? body.bookHash.trim() : '';
  if (!isUuid(body.ownerId) || !bookHash || bookHash.length > 64) {
    return fail(400, 'invalid_request', 'Invalid request');
  }
  if (body.ownerId === user.id) return fail(400, 'self_request', 'This is your own book');
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > BOOK_REQUEST_MESSAGE_MAX) {
    return fail(400, 'message_too_long', 'The message is too long');
  }
  const ownerId = body.ownerId;

  const supabase = createSupabaseAdminClient();
  try {
    // Whatever is not visible to the caller answers like a missing book.
    if (
      !(await canBrowseLibrary(supabase, user.id, ownerId)) ||
      (await visibleBookHashes(supabase, ownerId, [bookHash])).length === 0
    ) {
      return fail(404, 'book_not_found', 'Book not found');
    }
    if (!(await findBookFile(supabase, ownerId, bookHash))) {
      return fail(409, 'book_not_uploaded', 'Book is not available for borrowing');
    }

    const { data: book, error: bookError } = await supabase
      .from('books')
      .select('title, author, format')
      .eq('user_id', ownerId)
      .eq('book_hash', bookHash)
      .maybeSingle();
    if (bookError) throw bookError;
    if (!book) return fail(404, 'book_not_found', 'Book not found');

    const { data: existing, error: existingError } = await supabase
      .from('book_requests')
      .select(REQUEST_COLUMNS)
      .eq('owner_id', ownerId)
      .eq('requester_id', user.id)
      .eq('book_hash', bookHash)
      .maybeSingle();
    if (existingError) throw existingError;
    const previous = existing as BookRequestRow | null;
    if (previous?.status === 'pending') {
      return fail(409, 'already_requested', 'You already asked for this book');
    }
    if (
      previous?.status === 'declined' &&
      !mayAskAgain(previous.answered_at, BOOK_REQUEST_RETRY_DAYS)
    ) {
      return fail(429, 'declined_recently', 'This request was declined recently');
    }

    const { count, error: countError } = await supabase
      .from('book_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requester_id', user.id)
      .eq('status', 'pending');
    if (countError) throw countError;
    if ((count ?? 0) >= BOOK_REQUEST_MAX_PENDING) {
      return fail(429, 'request_limit_reached', 'Too many open requests');
    }

    const { data: saved, error: saveError } = await supabase
      .from('book_requests')
      .upsert(
        {
          owner_id: ownerId,
          requester_id: user.id,
          book_hash: bookHash,
          book_title: book.title || 'Untitled',
          book_author: book.author || null,
          book_format: (book.format || '').toLowerCase() || 'epub',
          message: message || null,
          status: 'pending',
          created_at: new Date().toISOString(),
          answered_at: null,
        },
        { onConflict: 'owner_id,requester_id,book_hash' },
      )
      .select(REQUEST_COLUMNS)
      .single();
    if (saveError) throw saveError;

    // Tell the owner. The handle comes from the requester's profile, not the request body.
    const { data: me } = await supabase
      .from('profiles')
      .select('handle')
      .eq('user_id', user.id)
      .maybeSingle();
    await notifyUser(
      supabase,
      ownerId,
      borrowRequestMail({
        requesterHandle: me?.handle ?? '',
        bookTitle: book.title || 'Untitled',
        message: message || null,
      }),
    );
    return NextResponse.json({ request: saved });
  } catch (error) {
    console.error('book_requests create failed:', error);
    return fail(500, 'server_error', 'Could not send the request');
  }
}
