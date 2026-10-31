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
  return count ?? 0;
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
