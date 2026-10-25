import type { SupabaseClient } from '@supabase/supabase-js';

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
