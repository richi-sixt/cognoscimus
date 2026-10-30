import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { normalizeUrl } from '@/libs/later/fetchPage';
import { FetchBlockedError } from '@/libs/later/ssrf';
import { IMPORT_MAX_ENTRIES } from '@/libs/later/constants';

const LABEL_MAX = 80;
const TAGS_MAX = 20;

interface RawEntry {
  url?: unknown;
  title?: unknown;
  tags?: unknown;
  folder?: unknown;
  addedAt?: unknown;
}

interface CleanEntry {
  url: string;
  title: string;
  labels: string[];
  savedAt: string | null;
}

const asLabel = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, LABEL_MAX) : null;

const clean = (raw: RawEntry, folderLabels: boolean): CleanEntry | null => {
  if (typeof raw.url !== 'string' || raw.url.length > 2048) return null;
  let url: URL;
  try {
    url = normalizeUrl(raw.url);
  } catch (error) {
    if (error instanceof FetchBlockedError) return null;
    throw error;
  }

  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 300)
      : url.hostname.replace(/^www\./, '');
  const tags = Array.isArray(raw.tags) ? raw.tags.slice(0, TAGS_MAX).map(asLabel) : [];
  const labels = [...tags, folderLabels ? asLabel(raw.folder) : null].filter(
    (l): l is string => l !== null,
  );
  const added = typeof raw.addedAt === 'string' ? new Date(raw.addedAt) : null;
  const savedAt =
    added && !Number.isNaN(added.getTime()) && added.getTime() <= Date.now()
      ? added.toISOString()
      : null;
  return { url: url.toString(), title, labels, savedAt };
};

// POST /api/later/import — stores a batch of links without fetching them. Their
// article text is loaded afterwards (/api/later/refetch). Links the user already
// has are left untouched. Tags, and optionally folders, become labels.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { entries?: unknown; folderLabels?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.entries) || body.entries.length > IMPORT_MAX_ENTRIES) {
    return NextResponse.json(
      { error: `entries must be a list of at most ${IMPORT_MAX_ENTRIES}`, code: 'invalid_entries' },
      { status: 400 },
    );
  }

  const byUrl = new Map<string, CleanEntry>();
  let invalid = 0;
  for (const raw of body.entries as RawEntry[]) {
    const entry = raw && typeof raw === 'object' ? clean(raw, body.folderLabels === true) : null;
    if (!entry) invalid++;
    else if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  }

  const supabase = createSupabaseAdminClient();
  try {
    const rows = [...byUrl.values()].map((e) => ({
      user_id: user.id,
      url: e.url,
      title: e.title,
      content_html: '',
      content_text: '',
      fetch_state: 'pending',
      // Every row carries the same columns: a bulk upsert cannot mix rows with and
      // without a column, and an absent one would be stored as NULL.
      saved_at: e.savedAt ?? new Date().toISOString(),
    }));
    const { data: inserted, error } = rows.length
      ? await supabase
          .from('later_items')
          .upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: true })
          .select('id, url')
      : { data: [], error: null };
    if (error) throw error;

    // Labels are only made for links that were actually added.
    const added = (inserted ?? []).map((row) => ({
      id: row.id as string,
      entry: byUrl.get(row.url as string)!,
    }));
    const wanted = new Map<string, string>(); // lower-case -> display name
    for (const { entry } of added)
      for (const name of entry.labels) wanted.set(name.toLowerCase(), name);

    if (wanted.size > 0) {
      const { data: existing, error: labelError } = await supabase
        .from('later_labels')
        .select('id, name')
        .eq('user_id', user.id);
      if (labelError) throw labelError;
      const ids = new Map(
        (existing ?? []).map((l) => [(l.name as string).toLowerCase(), l.id as string]),
      );

      const missing = [...wanted]
        .filter(([key]) => !ids.has(key))
        .map(([, name]) => ({ user_id: user.id, name }));
      if (missing.length > 0) {
        const { data: created, error: createError } = await supabase
          .from('later_labels')
          .insert(missing)
          .select('id, name');
        if (createError) throw createError;
        for (const l of created ?? []) ids.set((l.name as string).toLowerCase(), l.id as string);
      }

      const links = added.flatMap(({ id, entry }) =>
        [...new Set(entry.labels.map((n) => ids.get(n.toLowerCase())!))].map((label_id) => ({
          item_id: id,
          label_id,
        })),
      );
      if (links.length > 0) {
        const { error: linkError } = await supabase
          .from('later_item_labels')
          .upsert(links, { onConflict: 'item_id,label_id', ignoreDuplicates: true });
        if (linkError) throw linkError;
      }
    }

    return NextResponse.json({
      imported: added.length,
      existing: byUrl.size - added.length,
      invalid,
    });
  } catch (error) {
    console.error('later import failed:', (error as { message?: string })?.message ?? error);
    return NextResponse.json({ error: 'Could not import the links' }, { status: 500 });
  }
}
