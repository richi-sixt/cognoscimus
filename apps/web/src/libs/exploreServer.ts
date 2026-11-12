import type { SupabaseClient } from '@supabase/supabase-js';
import { isWish } from './loansServer';

/**
 * Whether `viewerId` may browse `ownerId`'s library: an accepted follow and the
 * owner's opt-in. The database functions of 0022 answer the same for the
 * signed-in caller; the server routes use the service role and so ask here.
 */
export const canBrowseLibrary = async (
  supabase: SupabaseClient,
  viewerId: string,
  ownerId: string,
): Promise<boolean> => {
  const { data: follow, error: followError } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', viewerId)
    .eq('followee_id', ownerId)
    .maybeSingle();
  if (followError) throw followError;
  if (follow?.status !== 'accepted') return false;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('library_shared')
    .eq('user_id', ownerId)
    .maybeSingle();
  if (profileError) throw profileError;
  return profile?.library_shared === true;
};

/**
 * The subset of `hashes` that are live, not hidden books of `ownerId`. The
 * wishlist (printed books not owned yet) is private and never among them.
 */
export const visibleBookHashes = async (
  supabase: SupabaseClient,
  ownerId: string,
  hashes: string[],
): Promise<string[]> => {
  if (hashes.length === 0) return [];
  const { data: books, error: booksError } = await supabase
    .from('books')
    .select('book_hash, format, metadata')
    .eq('user_id', ownerId)
    .in('book_hash', hashes)
    .is('deleted_at', null);
  if (booksError) throw booksError;
  const { data: hidden, error: hiddenError } = await supabase
    .from('library_hidden')
    .select('book_hash')
    .eq('user_id', ownerId)
    .in('book_hash', hashes);
  if (hiddenError) throw hiddenError;
  const hiddenSet = new Set((hidden ?? []).map((h) => h.book_hash as string));
  return (books ?? [])
    .filter((b) => !isWish(b.format, b.metadata))
    .map((b) => b.book_hash as string)
    .filter((h) => !hiddenSet.has(h));
};
