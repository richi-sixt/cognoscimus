import type { SupabaseClient } from '@supabase/supabase-js';
import { GRANT_MAX_ACTIVE_PER_OWNER } from '@/services/constants';

export interface GrantRow {
  id: string;
  owner_id: string;
  grantee_id: string;
  book_hash: string;
  book_title: string;
  book_author: string | null;
  book_format: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export const GRANT_COLUMNS =
  'id, owner_id, grantee_id, book_hash, book_title, book_author, book_format, expires_at, revoked_at, created_at';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

// Deliberately loose: the address only has to be looked up, not delivered to.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isPlausibleEmail = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());

export const isGrantActive = (
  grant: Pick<GrantRow, 'expires_at' | 'revoked_at'>,
  now = Date.now(),
) => !grant.revoked_at && new Date(grant.expires_at).getTime() > now;

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/**
 * The owner's live book file (not its cover) for a book hash. Covers share the
 * `files` table and the hash, so the image extensions are filtered out.
 */
export const findBookFile = async (
  supabase: SupabaseClient,
  ownerId: string,
  bookHash: string,
): Promise<{ file_key: string; file_size: number } | null> => {
  const { data, error } = await supabase
    .from('files')
    .select('file_key, file_size')
    .eq('user_id', ownerId)
    .eq('book_hash', bookHash)
    .is('deleted_at', null);
  if (error) throw error;
  return (data ?? []).find((f) => !IMAGE_RE.test(f.file_key)) ?? null;
};

/**
 * Book hashes the user holds only through someone else's grant (current or
 * past) and does not own a file for. Their rows must never reach the user's own
 * cloud records: the book is the owner's, and a grant ends.
 */
export const foreignGrantedHashes = async (
  supabase: SupabaseClient,
  userId: string,
  hashes: string[],
): Promise<Set<string>> => {
  if (hashes.length === 0) return new Set();
  const { data: grants, error: grantError } = await supabase
    .from('book_grants')
    .select('book_hash')
    .eq('grantee_id', userId)
    .in('book_hash', hashes);
  if (grantError) throw grantError;
  const granted = [...new Set((grants ?? []).map((g) => g.book_hash as string))];
  if (granted.length === 0) return new Set();

  const { data: owned, error: ownedError } = await supabase
    .from('files')
    .select('book_hash')
    .eq('user_id', userId)
    .in('book_hash', granted)
    .is('deleted_at', null);
  if (ownedError) throw ownedError;
  const ownedHashes = new Set((owned ?? []).map((f) => f.book_hash as string));
  return new Set(granted.filter((hash) => !ownedHashes.has(hash)));
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type CreateGrantResult =
  | { grant: GrantRow }
  | { error: { status: number; code: string; message: string } };

/**
 * Grants `granteeId` the owner's book until the expiry, or renews an existing
 * grant. Shared by the e-mail route and by accepting a borrow request, so both
 * enforce the same checks: the book is the owner's, its file is uploaded and the
 * owner stays under the active-grant cap. Display data comes from the owner's
 * library row, never from the client.
 */
export const createGrant = async (
  supabase: SupabaseClient,
  params: { ownerId: string; granteeId: string; bookHash: string; expirationDays: number },
): Promise<CreateGrantResult> => {
  const { ownerId, granteeId, bookHash, expirationDays } = params;

  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('title, author, format')
    .eq('user_id', ownerId)
    .eq('book_hash', bookHash)
    .is('deleted_at', null)
    .maybeSingle();
  if (bookError) throw bookError;
  if (!book) {
    return { error: { status: 404, code: 'book_not_found', message: 'Book not found' } };
  }

  const file = await findBookFile(supabase, ownerId, bookHash);
  if (!file) {
    return {
      error: { status: 409, code: 'book_not_uploaded', message: 'Book is not uploaded yet' },
    };
  }

  const nowIso = new Date().toISOString();
  const { count, error: countError } = await supabase
    .from('book_grants')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .is('revoked_at', null)
    .gt('expires_at', nowIso);
  if (countError) throw countError;
  if ((count ?? 0) >= GRANT_MAX_ACTIVE_PER_OWNER) {
    return {
      error: {
        status: 429,
        code: 'grant_limit_reached',
        message: `You have reached the maximum of ${GRANT_MAX_ACTIVE_PER_OWNER} active grants.`,
      },
    };
  }

  const { data: grant, error: upsertError } = await supabase
    .from('book_grants')
    .upsert(
      {
        owner_id: ownerId,
        grantee_id: granteeId,
        book_hash: bookHash,
        book_title: book.title || 'Untitled',
        book_author: book.author || null,
        book_format: (book.format || '').toLowerCase() || 'epub',
        expires_at: new Date(Date.now() + expirationDays * DAY_MS).toISOString(),
        revoked_at: null,
        created_at: nowIso,
      },
      { onConflict: 'owner_id,grantee_id,book_hash' },
    )
    .select(GRANT_COLUMNS)
    .single();
  if (upsertError) throw upsertError;
  return { grant: grant as GrantRow };
};
