import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { FEEDS_MAX, IMPORT_MAX_ENTRIES } from '@/libs/later/constants';
import { normalizeUrl } from '@/libs/later/fetchPage';

// POST /api/later/feeds/import — follows the feeds of an OPML file. Nothing is fetched
// here: the scheduled job picks the new feeds up on its next run.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { feeds?: unknown };
  try {
    body = (await request.json()) as { feeds?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.feeds) || body.feeds.length > IMPORT_MAX_ENTRIES) {
    return NextResponse.json(
      { error: `feeds must be a list of at most ${IMPORT_MAX_ENTRIES}`, code: 'invalid_feeds' },
      { status: 400 },
    );
  }

  const byUrl = new Map<string, string>();
  let invalid = 0;
  for (const raw of body.feeds as { url?: unknown; title?: unknown }[]) {
    try {
      if (!raw || typeof raw.url !== 'string' || raw.url.length > 2048) throw new Error();
      const url = normalizeUrl(raw.url).toString();
      const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '';
      if (!byUrl.has(url)) byUrl.set(url, title);
    } catch {
      invalid++;
    }
  }

  const supabase = createSupabaseAdminClient();
  try {
    const { count, error: countError } = await supabase
      .from('later_feeds')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if (countError) throw countError;
    const room = Math.max(0, FEEDS_MAX - (count ?? 0));
    const wanted = [...byUrl].slice(0, room);

    const { data: inserted, error } = wanted.length
      ? await supabase
          .from('later_feeds')
          .upsert(
            wanted.map(([url, title]) => ({ user_id: user.id, url, title })),
            { onConflict: 'user_id,url', ignoreDuplicates: true },
          )
          .select('id')
      : { data: [], error: null };
    if (error) throw error;

    const imported = inserted?.length ?? 0;
    return NextResponse.json({
      imported,
      existing: wanted.length - imported,
      skipped: byUrl.size - wanted.length,
      invalid,
    });
  } catch (error) {
    console.error('later feed import failed:', (error as { message?: string })?.message ?? error);
    return NextResponse.json({ error: 'Could not import the feeds' }, { status: 500 });
  }
}
