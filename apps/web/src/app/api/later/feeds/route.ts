import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { FEEDS_MAX } from '@/libs/later/constants';
import { FeedError, loadFeed } from '@/libs/later/feeds';
import { storeEntries } from '@/libs/later/feedStore';
import { FetchBlockedError } from '@/libs/later/ssrf';

const URL_MAX_LENGTH = 2048;
const CHECK_EVERY_MINUTES = 60;

// POST /api/later/feeds — follows a feed. The address may also be a web page that
// advertises one. The feed is fetched once now; later fetches are done by the
// scheduled job (/api/later/feeds/poll).
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.url !== 'string' || !body.url.trim() || body.url.length > URL_MAX_LENGTH) {
    return NextResponse.json(
      { error: 'Missing or invalid url', code: 'invalid_url' },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  try {
    const { count, error: countError } = await supabase
      .from('later_feeds')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if (countError) throw countError;
    if ((count ?? 0) >= FEEDS_MAX) {
      return NextResponse.json(
        { error: `You can follow at most ${FEEDS_MAX} feeds`, code: 'too_many_feeds' },
        { status: 409 },
      );
    }

    const { feed, url, fetched } = await loadFeed(body.url);
    const now = new Date();
    const { data: created, error } = await supabase
      .from('later_feeds')
      .insert({
        user_id: user.id,
        url,
        title: feed.title || new URL(url).hostname,
        site_url: feed.siteUrl,
        etag: fetched.etag,
        last_modified: fetched.lastModified,
        check_every_minutes: CHECK_EVERY_MINUTES,
        last_checked_at: now.toISOString(),
        next_check_at: new Date(now.getTime() + CHECK_EVERY_MINUTES * 60_000).toISOString(),
      })
      .select('id, user_id, title')
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'You already follow this feed', code: 'already_followed' },
          { status: 409 },
        );
      }
      throw error;
    }
    await storeEntries(supabase, created, feed.entries, true);
    return NextResponse.json({ id: created.id, title: created.title });
  } catch (error) {
    if (error instanceof FetchBlockedError) {
      return NextResponse.json({ error: error.message, code: 'blocked' }, { status: 400 });
    }
    if (error instanceof FeedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }
    console.error('later feed add failed:', (error as { message?: string })?.message ?? error);
    return NextResponse.json({ error: 'Could not add the feed' }, { status: 500 });
  }
}
