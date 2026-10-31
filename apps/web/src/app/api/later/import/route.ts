import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { normalizeUrl } from '@/libs/later/fetchPage';
import { kindFromUrl } from '@/libs/later/kind';
import { FetchBlockedError } from '@/libs/later/ssrf';
import { IMPORT_MAX_ENTRIES } from '@/libs/later/constants';

const LABEL_MAX = 80;
const TAGS_MAX = 20;

interface RawEntry {
  url?: unknown;
  title?: unknown;
  tags?: unknown;
  folder?: unknown;
  folderPath?: unknown;
  addedAt?: unknown;
}

interface CleanEntry {
  url: string;
  title: string;
  labels: string[];
  /** Folder names from the top, for the collection the link belongs in. */
  folderPath: string[];
  savedAt: string | null;
}

type FolderMode = 'collections' | 'labels' | 'none';
const FOLDER_DEPTH_MAX = 8;

const asLabel = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, LABEL_MAX) : null;

const clean = (raw: RawEntry, folders: FolderMode): CleanEntry | null => {
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
  const labels = [...tags, folders === 'labels' ? asLabel(raw.folder) : null].filter(
    (l): l is string => l !== null,
  );
  const added = typeof raw.addedAt === 'string' ? new Date(raw.addedAt) : null;
  const savedAt =
    added && !Number.isNaN(added.getTime()) && added.getTime() <= Date.now()
      ? added.toISOString()
      : null;
  const folderPath =
    folders === 'collections' && Array.isArray(raw.folderPath)
      ? raw.folderPath
          .slice(0, FOLDER_DEPTH_MAX)
          .map(asLabel)
          .filter((n): n is string => n !== null)
      : [];
  return { url: url.toString(), title, labels, folderPath, savedAt };
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// Puts each added link into the collection its folder path names, creating the
// missing collections (nested, matched by name without regard to case).
const fileIntoCollections = async (
  supabase: AdminClient,
  userId: string,
  added: { id: string; entry: CleanEntry }[],
) => {
  if (!added.some(({ entry }) => entry.folderPath.length > 0)) return;

  const { data, error } = await supabase
    .from('later_collections')
    .select('id, name, parent_id')
    .eq('user_id', userId);
  if (error) throw error;
  const known = new Map<string, string>(); // "parentId|lower-case name" -> id
  for (const c of data ?? []) {
    known.set(`${c.parent_id ?? ''}|${(c.name as string).toLowerCase()}`, c.id as string);
  }

  const itemsByCollection = new Map<string, string[]>();
  for (const { id, entry } of added) {
    let parentId: string | null = null;
    for (const name of entry.folderPath) {
      const key = `${parentId ?? ''}|${name.toLowerCase()}`;
      let found = known.get(key);
      if (!found) {
        const { data: created, error: createError } = await supabase
          .from('later_collections')
          .insert({ user_id: userId, name, parent_id: parentId })
          .select('id')
          .single();
        if (createError) throw createError;
        found = created.id as string;
        known.set(key, found);
      }
      parentId = found;
    }
    if (parentId) itemsByCollection.set(parentId, [...(itemsByCollection.get(parentId) ?? []), id]);
  }

  for (const [collectionId, ids] of itemsByCollection) {
    const { error: moveError } = await supabase
      .from('later_items')
      .update({ collection_id: collectionId })
      .in('id', ids);
    if (moveError) throw moveError;
  }
};

// POST /api/later/import — stores a batch of links without fetching them. Their
// article text is loaded afterwards (/api/later/refetch). Links the user already
// has are left untouched. Tags become labels; folders become collections or labels.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { entries?: unknown; folders?: unknown };
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

  const folders: FolderMode =
    body.folders === 'collections' || body.folders === 'labels' ? body.folders : 'none';
  const byUrl = new Map<string, CleanEntry>();
  let invalid = 0;
  for (const raw of body.entries as RawEntry[]) {
    const entry = raw && typeof raw === 'object' ? clean(raw, folders) : null;
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
      // The address already gives some away (PDFs, videos, shops); the rest is
      // decided when the page is fetched.
      kind: kindFromUrl(new URL(e.url)) ?? 'article',
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

    // Labels and collections are only made for links that were actually added.
    const added = (inserted ?? []).map((row) => ({
      id: row.id as string,
      entry: byUrl.get(row.url as string)!,
    }));
    if (folders === 'collections') await fileIntoCollections(supabase, user.id, added);
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
