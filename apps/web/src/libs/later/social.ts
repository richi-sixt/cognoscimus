import { supabase } from '@/utils/supabase';

export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;

export interface Profile {
  user_id: string;
  handle: string;
  display_name: string;
  discoverable: boolean;
}

/** A person on the other side of a follow. */
export interface Person {
  user_id: string;
  handle: string;
  display_name: string;
}

export type FollowResult = 'requested' | 'profile_required' | 'not_found';

export const normalizeHandle = (input: string) => input.trim().replace(/^@/, '').toLowerCase();

export const getMyProfile = async (userId: string): Promise<Profile | null> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name, discoverable')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
};

export const saveMyProfile = async (
  userId: string,
  fields: { handle: string; displayName: string; discoverable: boolean },
): Promise<Profile> => {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        handle: normalizeHandle(fields.handle),
        display_name: fields.displayName.trim(),
        discoverable: fields.discoverable,
      },
      { onConflict: 'user_id' },
    )
    .select('user_id, handle, display_name, discoverable')
    .single();
  if (error) throw error;
  return data as Profile;
};

export const followByHandle = async (handle: string): Promise<FollowResult> => {
  const { data, error } = await supabase.rpc('later_follow', { p_handle: normalizeHandle(handle) });
  if (error) throw error;
  return data as FollowResult;
};

const PERSON = 'user_id, handle, display_name';

/** People I follow with their consent (`mine`), or who follow me. */
export const listConnections = async (
  userId: string,
  status: 'accepted' | 'pending',
  side: 'following' | 'followers',
): Promise<Person[]> => {
  const mine = side === 'following' ? 'follower_id' : 'followee_id';
  const theirs = side === 'following' ? 'followee_id' : 'follower_id';
  const { data, error } = await supabase
    .from('follows')
    .select(`other:profiles!follows_${theirs.replace('_id', '')}_fkey(${PERSON})`)
    .eq(mine, userId)
    .eq('status', status);
  if (error) throw error;
  return ((data ?? []) as unknown as { other: Person | null }[])
    .map((row) => row.other)
    .filter((p): p is Person => p !== null)
    .sort((a, b) => a.handle.localeCompare(b.handle));
};

export const countFollowRequests = async (userId: string): Promise<number> => {
  const { count, error } = await supabase
    .from('follows')
    .select('follower_id', { count: 'exact', head: true })
    .eq('followee_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  // Articles sent to the caller wait for an answer just like follow requests.
  return (count ?? 0) + (await listIncomingShares()).length;
};

/** Answers a request or changes a follower's status; the caller is the followed person. */
export const answerFollower = async (
  userId: string,
  followerId: string,
  status: 'accepted' | 'blocked',
) => {
  const { error } = await supabase
    .from('follows')
    .update({ status })
    .eq('followee_id', userId)
    .eq('follower_id', followerId);
  if (error) throw error;
};

export const removeFollower = async (userId: string, followerId: string) => {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('followee_id', userId)
    .eq('follower_id', followerId);
  if (error) throw error;
};

export const unfollow = async (userId: string, followeeId: string) => {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', userId)
    .eq('followee_id', followeeId);
  if (error) throw error;
};

/** A person the caller follows, with how many articles they share. */
export interface FollowedPerson extends Person {
  shared_count: number;
}

export interface SharedItem {
  id: string;
  title: string;
  word_count: number;
  saved_at: string;
}

export interface SharedArticle {
  id: string;
  owner_id: string;
  title: string;
  content_html: string;
  saved_at: string;
}

export const listFollowing = async (): Promise<FollowedPerson[]> => {
  const { data, error } = await supabase.rpc('later_following_overview');
  if (error) throw error;
  return ((data ?? []) as (Person & { shared_count: number | string })[]).map((p) => ({
    ...p,
    shared_count: Number(p.shared_count),
  }));
};

export const listSharedItems = async (ownerId: string): Promise<SharedItem[]> => {
  const { data, error } = await supabase.rpc('later_shared_items', { p_owner: ownerId });
  if (error) throw error;
  return (data ?? []) as SharedItem[];
};

export const getSharedArticle = async (id: string): Promise<SharedArticle | null> => {
  const { data, error } = await supabase.rpc('later_shared_item', { p_id: id });
  if (error) throw error;
  return ((data ?? []) as SharedArticle[])[0] ?? null;
};

export type SendResult = 'sent' | 'profile_required' | 'not_found' | 'no_article';

/** Offers one of the caller's articles to the discoverable profile with this handle. */
export const sendArticle = async (itemId: string, handle: string): Promise<SendResult> => {
  const { data, error } = await supabase.rpc('later_send', {
    p_item: itemId,
    p_handle: normalizeHandle(handle),
  });
  if (error) throw error;
  return data as SendResult;
};

export interface IncomingShare {
  id: string;
  title: string;
  word_count: number;
  created_at: string;
  sender_handle: string;
  sender_name: string;
}

export const listIncomingShares = async (): Promise<IncomingShare[]> => {
  const { data, error } = await supabase.rpc('later_incoming_shares');
  if (error) throw error;
  return (data ?? []) as IncomingShare[];
};

/** Accepting copies the article into the library; declining just deletes the offer. */
export const answerShare = async (id: string, accept: boolean) => {
  const { error } = await supabase.rpc('later_answer_share', { p_id: id, p_accept: accept });
  if (error) throw error;
};
