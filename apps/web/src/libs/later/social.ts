import { supabase } from '@/utils/supabase';
import { normalizeHandle, type Person } from '../social';
import type { ItemKind } from './kind';

export * from '../social';

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

/** A person the caller follows, with how many articles they share. */
export interface FollowedPerson extends Person {
  shared_count: number;
}

export const listFollowing = async (): Promise<FollowedPerson[]> => {
  const { data, error } = await supabase.rpc('later_following_overview');
  if (error) throw error;
  return ((data ?? []) as (Person & { shared_count: number | string })[]).map((p) => ({
    ...p,
    shared_count: Number(p.shared_count),
  }));
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

/** One entry of what someone shares, without its text. */
export interface SharedEntry {
  id: string;
  owner_id: string;
  owner_handle: string;
  owner_name: string;
  title: string;
  kind: ItemKind;
  site_name: string | null;
  excerpt: string | null;
  word_count: number;
  note: string | null;
  collection_name: string | null;
  saved_at: string;
}

/** A shared item or an offer, opened for reading. */
export interface SharedArticle {
  id: string;
  /** Who it comes from. */
  from_handle: string;
  from_name: string;
  title: string;
  kind: ItemKind;
  url: string;
  author: string | null;
  site_name: string | null;
  content_html: string;
  note: string | null;
  saved_at: string;
}

export interface IncomingShare {
  id: string;
  title: string;
  kind: ItemKind;
  site_name: string | null;
  excerpt: string | null;
  word_count: number;
  note: string | null;
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

/** What the people the caller follows share; `ownerId` narrows it to one person. */
export const listSharedFeed = async (ownerId?: string): Promise<SharedEntry[]> => {
  const { data, error } = await supabase.rpc('later_shared_feed', { p_owner: ownerId ?? null });
  if (error) throw error;
  return (data ?? []) as SharedEntry[];
};

export const getSharedArticle = async (id: string): Promise<SharedArticle | null> => {
  const { data, error } = await supabase.rpc('later_shared_item', { p_id: id });
  if (error) throw error;
  const row = (
    (data ?? []) as (Omit<SharedArticle, 'from_handle' | 'from_name'> & {
      owner_handle: string;
      owner_name: string;
    })[]
  )[0];
  return row ? { ...row, from_handle: row.owner_handle, from_name: row.owner_name } : null;
};

export const getIncomingShare = async (id: string): Promise<SharedArticle | null> => {
  const { data, error } = await supabase.rpc('later_incoming_share', { p_id: id });
  if (error) throw error;
  const row = (
    (data ?? []) as (Omit<SharedArticle, 'from_handle' | 'from_name' | 'saved_at'> & {
      created_at: string;
      sender_handle: string;
      sender_name: string;
    })[]
  )[0];
  return row
    ? {
        ...row,
        from_handle: row.sender_handle,
        from_name: row.sender_name,
        saved_at: row.created_at,
      }
    : null;
};

/** Copies a followed person's shared item into the library; false when already there. */
export const saveShared = async (id: string): Promise<boolean> => {
  const { data, error } = await supabase.rpc('later_save_shared', { p_id: id });
  if (error) throw error;
  return data !== null;
};
