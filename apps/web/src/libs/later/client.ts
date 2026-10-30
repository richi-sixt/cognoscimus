import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';
import { FETCH_CONCURRENCY, IMPORT_BATCH_SIZE, TRASH_RETENTION_DAYS } from './constants';
import type { ImportEntry } from './importRaindrop';

export type LaterState = 'unread' | 'reading' | 'archived';
export type FetchState = 'ready' | 'pending' | 'failed';

export interface LaterItem {
  id: string;
  url: string;
  title: string;
  author: string | null;
  site_name: string | null;
  excerpt: string | null;
  thumbnail: string | null;
  word_count: number;
  state: LaterState;
  progress: number;
  saved_at: string;
  deleted_at: string | null;
  fetch_state: FetchState;
}

export interface LaterItemFull extends LaterItem {
  content_html: string;
}

export interface LaterLabel {
  id: string;
  name: string;
}

export class LaterApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'LaterApiError';
  }
}

const SUMMARY_COLUMNS =
  'id, url, title, author, site_name, excerpt, thumbnail, word_count, state, progress, saved_at, deleted_at, fetch_state';

export const saveArticle = async (url: string): Promise<string> => {
  const token = await getAccessToken();
  if (!token) throw new LaterApiError(401, undefined, 'Not authenticated');
  const response = await fetch(`${getAPIBaseUrl()}/later/save`, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.id) {
    throw new LaterApiError(response.status, body.code, body.error || 'Could not save the article');
  }
  return body.id;
};

export type LaterView = 'inbox' | 'archive' | 'trash';

export const listItems = async (options: {
  view: LaterView;
  search?: string;
  labelId?: string | null;
}): Promise<LaterItem[]> => {
  let ids: string[] | null = null;
  if (options.labelId) {
    const { data, error } = await supabase
      .from('later_item_labels')
      .select('item_id')
      .eq('label_id', options.labelId);
    if (error) throw error;
    ids = (data ?? []).map((r) => r.item_id as string);
    if (ids.length === 0) return [];
  }

  let query = supabase.from('later_items').select(SUMMARY_COLUMNS);
  if (options.view === 'trash') {
    query = query.not('deleted_at', 'is', null);
  } else {
    query = query.is('deleted_at', null);
    query =
      options.view === 'archive'
        ? query.eq('state', 'archived')
        : query.in('state', ['unread', 'reading']);
  }
  if (ids) query = query.in('id', ids);
  const search = options.search?.trim();
  if (search) query = query.textSearch('tsv', search, { type: 'websearch', config: 'simple' });

  const { data, error } = await query
    .order(options.view === 'trash' ? 'deleted_at' : 'saved_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as LaterItem[];
};

export const getItem = async (id: string): Promise<LaterItemFull | null> => {
  const { data, error } = await supabase
    .from('later_items')
    .select(`${SUMMARY_COLUMNS}, content_html`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as LaterItemFull | null) ?? null;
};

export const setItemState = async (id: string, state: LaterState) => {
  const { error } = await supabase
    .from('later_items')
    .update({ state, archived_at: state === 'archived' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
};

export const setItemProgress = async (id: string, progress: number, state: LaterState) => {
  const { error } = await supabase
    .from('later_items')
    .update({ progress: Math.min(1, Math.max(0, progress)), state })
    .eq('id', id);
  if (error) throw error;
};

export const trashItem = async (id: string) => {
  const { error } = await supabase
    .from('later_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
};

export const restoreItem = async (id: string) => {
  const { error } = await supabase.from('later_items').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
};

/** Removes everything in the trash for good, or only what is past its retention. */
export const purgeTrash = async (options: { expiredOnly?: boolean } = {}) => {
  let query = supabase.from('later_items').delete().not('deleted_at', 'is', null);
  if (options.expiredOnly) {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    query = query.lt('deleted_at', cutoff.toISOString());
  }
  const { error } = await query;
  if (error) throw error;
};

/** Deletes one article for good, skipping the trash. */
export const deleteItem = async (id: string) => {
  const { error } = await supabase.from('later_items').delete().eq('id', id);
  if (error) throw error;
};

export const listLabels = async (): Promise<LaterLabel[]> => {
  const { data, error } = await supabase.from('later_labels').select('id, name').order('name');
  if (error) throw error;
  return (data ?? []) as LaterLabel[];
};

export const createLabel = async (userId: string, name: string): Promise<LaterLabel> => {
  const { data, error } = await supabase
    .from('later_labels')
    .insert({ user_id: userId, name: name.trim() })
    .select('id, name')
    .single();
  if (error) throw error;
  return data as LaterLabel;
};

export const listItemLabelIds = async (itemId: string): Promise<string[]> => {
  const { data, error } = await supabase
    .from('later_item_labels')
    .select('label_id')
    .eq('item_id', itemId);
  if (error) throw error;
  return (data ?? []).map((r) => r.label_id as string);
};

export const setItemLabel = async (itemId: string, labelId: string, on: boolean) => {
  const { error } = on
    ? await supabase.from('later_item_labels').insert({ item_id: itemId, label_id: labelId })
    : await supabase
        .from('later_item_labels')
        .delete()
        .eq('item_id', itemId)
        .eq('label_id', labelId);
  if (error) throw error;
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const token = await getAccessToken();
  if (!token) throw new LaterApiError(401, undefined, 'Not authenticated');
  const response = await fetch(`${getAPIBaseUrl()}/later${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new LaterApiError(response.status, data.code, data.error || 'Request failed');
  }
  return data;
};

export interface ImportResult {
  imported: number;
  existing: number;
  invalid: number;
}

/** Stores the links in batches; their article text is loaded afterwards. */
export const importEntries = async (
  entries: ImportEntry[],
  options: { folderLabels: boolean; onProgress?: (done: number) => void },
): Promise<ImportResult> => {
  const total: ImportResult = { imported: 0, existing: 0, invalid: 0 };
  for (let i = 0; i < entries.length; i += IMPORT_BATCH_SIZE) {
    const batch = entries.slice(i, i + IMPORT_BATCH_SIZE);
    const part = await postJson<ImportResult>('/import', {
      entries: batch,
      folderLabels: options.folderLabels,
    });
    total.imported += part.imported;
    total.existing += part.existing;
    total.invalid += part.invalid;
    options.onProgress?.(Math.min(i + batch.length, entries.length));
  }
  return total;
};

export const refetchItem = async (id: string): Promise<void> => {
  await postJson<{ id: string }>('/refetch', { id });
};

export const countPending = async (): Promise<number> => {
  const { count, error } = await supabase
    .from('later_items')
    .select('id', { count: 'exact', head: true })
    .eq('fetch_state', 'pending')
    .is('deleted_at', null);
  if (error) throw error;
  return count ?? 0;
};

/** Fetches the text of every link still waiting for it, a few at a time. */
export const loadPending = async (onProgress: (done: number, total: number) => void) => {
  const { data, error } = await supabase
    .from('later_items')
    .select('id')
    .eq('fetch_state', 'pending')
    .is('deleted_at', null)
    .order('saved_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.id as string);

  let next = 0;
  let done = 0;
  onProgress(0, ids.length);
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]!;
      // A failure is recorded on the item by the server; the batch goes on.
      await refetchItem(id).catch(() => undefined);
      onProgress(++done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, worker));
};
