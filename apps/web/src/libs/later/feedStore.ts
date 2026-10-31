import type { createSupabaseAdminClient } from '@/utils/supabase';
import { FEED_FIRST_ENTRIES, type FeedEntry } from './feeds';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Files a feed's entries for its owner. Entries seen before are left alone, so a
 * dismissed one does not come back. The first fetch of a feed only offers its newest
 * entries; the older ones are filed as dismissed.
 */
export const storeEntries = async (
  supabase: AdminClient,
  feed: { id: string; user_id: string },
  entries: FeedEntry[],
  firstFetch: boolean,
) => {
  if (entries.length === 0) return;
  const rows = entries.map((entry, index) => ({
    feed_id: feed.id,
    user_id: feed.user_id,
    guid: entry.guid.slice(0, 500),
    url: entry.url,
    title: entry.title,
    excerpt: entry.excerpt,
    published_at: entry.publishedAt,
    state: firstFetch && index >= FEED_FIRST_ENTRIES ? 'dismissed' : 'new',
  }));
  const { error } = await supabase
    .from('later_feed_entries')
    .upsert(rows, { onConflict: 'feed_id,guid', ignoreDuplicates: true });
  if (error) throw error;
};
