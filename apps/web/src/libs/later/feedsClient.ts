import { supabase } from '@/utils/supabase';
import { postJson, saveArticle } from './client';

export interface Feed {
  id: string;
  url: string;
  title: string;
  site_url: string | null;
  active: boolean;
  error_count: number;
  last_error: string | null;
  last_checked_at: string | null;
}

export interface FeedEntryRow {
  id: string;
  feed_id: string;
  url: string;
  title: string;
  excerpt: string | null;
  published_at: string | null;
  created_at: string;
  later_feeds: { title: string } | null;
}

const FEED_COLUMNS = 'id, url, title, site_url, active, error_count, last_error, last_checked_at';
export const FEED_ENTRY_LIMIT = 200;

export const listFeeds = async (): Promise<Feed[]> => {
  const { data, error } = await supabase
    .from('later_feeds')
    .select(FEED_COLUMNS)
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Feed[];
};

/** The entries still waiting for an answer, newest first; `feedId` narrows to one feed. */
export const listFeedEntries = async (feedId?: string): Promise<FeedEntryRow[]> => {
  let query = supabase
    .from('later_feed_entries')
    .select('id, feed_id, url, title, excerpt, published_at, created_at, later_feeds(title)')
    .eq('state', 'new')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(FEED_ENTRY_LIMIT);
  if (feedId) query = query.eq('feed_id', feedId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as FeedEntryRow[];
};

/** Number of entries waiting, per feed. */
export const countNewEntries = async (): Promise<Record<string, number>> => {
  const { data, error } = await supabase
    .from('later_feed_entries')
    .select('feed_id')
    .eq('state', 'new')
    .limit(5000);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? [])
    counts[row.feed_id as string] = (counts[row.feed_id as string] ?? 0) + 1;
  return counts;
};

export const addFeed = (url: string) => postJson<{ id: string; title: string }>('/feeds', { url });

export interface FeedImportResult {
  imported: number;
  existing: number;
  skipped: number;
  invalid: number;
}

export const importFeeds = (feeds: { url: string; title: string }[]) =>
  postJson<FeedImportResult>('/feeds/import', { feeds });

/** Saves the entry's page as an article, then takes the entry off the list. */
export const saveFeedEntry = async (entry: FeedEntryRow) => {
  await saveArticle(entry.url);
  await setEntryState([entry.id], 'saved');
};

export const setEntryState = async (ids: string[], state: 'saved' | 'dismissed') => {
  const { error } = await supabase.from('later_feed_entries').update({ state }).in('id', ids);
  if (error) throw error;
};

export const dismissAll = async (feedId?: string) => {
  let query = supabase.from('later_feed_entries').update({ state: 'dismissed' }).eq('state', 'new');
  if (feedId) query = query.eq('feed_id', feedId);
  const { error } = await query;
  if (error) throw error;
};

export const setFeedActive = async (id: string, active: boolean) => {
  const { error } = await supabase.from('later_feeds').update({ active }).eq('id', id);
  if (error) throw error;
};

export const deleteFeed = async (id: string) => {
  const { error } = await supabase.from('later_feeds').delete().eq('id', id);
  if (error) throw error;
};

/** The feed addresses (xmlUrl) of an OPML file, with their names. */
export const parseOpml = (xml: string): { url: string; title: string }[] => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const feeds: { url: string; title: string }[] = [];
  for (const outline of doc.querySelectorAll('outline[xmlUrl]')) {
    const url = outline.getAttribute('xmlUrl');
    if (url) {
      feeds.push({
        url,
        title: outline.getAttribute('title') || outline.getAttribute('text') || '',
      });
    }
  }
  return feeds;
};
