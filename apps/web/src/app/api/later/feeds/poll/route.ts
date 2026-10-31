import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import {
  FEED_ENTRY_RETENTION_DAYS,
  FEED_MAX_ERRORS,
  FEED_POLL_BATCH,
  FEED_POLL_CONCURRENCY,
} from '@/libs/later/constants';
import { fetchFeed, parseFeed } from '@/libs/later/feeds';
import { storeEntries } from '@/libs/later/feedStore';

interface DueFeed {
  id: string;
  user_id: string;
  url: string;
  title: string;
  etag: string | null;
  last_modified: string | null;
  check_every_minutes: number;
  last_checked_at: string | null;
  error_count: number;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

// POST /api/later/feeds/poll — run by a scheduled job, not by people. Fetches the
// feeds that are due and files their new entries. Protected by the CRON_SECRET
// environment variable, sent as a bearer token.
export async function POST(request: Request) {
  const secret = process.env['CRON_SECRET'];
  if (!secret) {
    return NextResponse.json({ error: 'Feed polling is not configured' }, { status: 503 });
  }
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!timingSafeEqual(digest(given), digest(secret))) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('later_feeds')
    .select(
      'id, user_id, url, title, etag, last_modified, check_every_minutes, last_checked_at, error_count',
    )
    .eq('active', true)
    .lte('next_check_at', new Date().toISOString())
    .order('next_check_at')
    .limit(FEED_POLL_BATCH);
  if (error) {
    console.error('later feed poll failed:', error.message);
    return NextResponse.json({ error: 'Could not read the feeds' }, { status: 500 });
  }

  const due = (data ?? []) as DueFeed[];
  const result = { checked: due.length, updated: 0, failed: 0 };

  const check = async (feed: DueFeed) => {
    try {
      const fetched = await fetchFeed(new URL(feed.url), {
        etag: feed.etag,
        lastModified: feed.last_modified,
      });
      const update: Record<string, unknown> = {
        last_checked_at: new Date().toISOString(),
        next_check_at: minutes(feed.check_every_minutes),
        error_count: 0,
        last_error: null,
      };
      if (!fetched.notModified) {
        const parsed = parseFeed(fetched.body, fetched.finalUrl);
        await storeEntries(supabase, feed, parsed.entries, feed.last_checked_at === null);
        update['etag'] = fetched.etag;
        update['last_modified'] = fetched.lastModified;
        if (!feed.title && parsed.title) update['title'] = parsed.title;
        result.updated++;
      }
      await supabase.from('later_feeds').update(update).eq('id', feed.id);
    } catch (err) {
      result.failed++;
      const errors = feed.error_count + 1;
      await supabase
        .from('later_feeds')
        .update({
          error_count: errors,
          last_error: (err instanceof Error ? err.message : 'Unknown error').slice(0, 300),
          last_checked_at: new Date().toISOString(),
          // Waits twice as long after each failure, at most a day; gives up after many.
          next_check_at: minutes(Math.min(feed.check_every_minutes * 2 ** errors, 1440)),
          active: errors < FEED_MAX_ERRORS,
        })
        .eq('id', feed.id);
    }
  };

  const queue = [...due];
  await Promise.all(
    Array.from({ length: Math.min(FEED_POLL_CONCURRENCY, queue.length) }, async () => {
      for (let feed = queue.shift(); feed; feed = queue.shift()) await check(feed);
    }),
  );

  const cutoff = new Date(Date.now() - FEED_ENTRY_RETENTION_DAYS * 86_400_000).toISOString();
  await supabase.from('later_feed_entries').delete().neq('state', 'new').lt('created_at', cutoff);

  return NextResponse.json(result);
}
