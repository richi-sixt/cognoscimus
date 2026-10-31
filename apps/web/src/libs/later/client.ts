import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';
import { FETCH_CONCURRENCY, IMPORT_BATCH_SIZE, TRASH_RETENTION_DAYS } from './constants';
import { type LaterCollection, collectionWithDescendants } from './collections';
import type { ImportEntry } from './importRaindrop';
import type { ItemKind } from './kind';

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
  collection_id: string | null;
  kind: ItemKind;
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
  'id, url, title, author, site_name, excerpt, thumbnail, word_count, state, progress, saved_at, deleted_at, fetch_state, collection_id, kind';

export const saveArticle = async (url: string, collectionId?: string | null): Promise<string> => {
  const token = await getAccessToken();
  if (!token) throw new LaterApiError(401, undefined, 'Not authenticated');
  const response = await fetch(`${getAPIBaseUrl()}/later/save`, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, collectionId: collectionId ?? undefined }),
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

export type LaterScope =
  | { kind: 'inbox' | 'archive' | 'trash' | 'all' | 'unsorted' }
  | { kind: 'collection'; id: string };

export const listItems = async (options: {
  scope: LaterScope;
  /** Needed to include the sub-collections of a collection scope. */
  collections?: LaterCollection[];
  search?: string;
  labelId?: string | null;
  kind?: ItemKind | null;
  /** Housekeeping views: links that could not be loaded, or items without a label. */
  maintenance?: 'failed' | 'unlabeled' | null;
}): Promise<LaterItem[]> => {
  const { scope } = options;
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

  // An embedded join that must come back empty finds the items without a label.
  let query = supabase
    .from('later_items')
    .select(
      options.maintenance === 'unlabeled'
        ? `${SUMMARY_COLUMNS}, later_item_labels(label_id)`
        : SUMMARY_COLUMNS,
    );
  if (options.kind) query = query.eq('kind', options.kind);
  if (options.maintenance === 'failed') query = query.eq('fetch_state', 'failed');
  if (options.maintenance === 'unlabeled') query = query.is('later_item_labels', null);
  if (scope.kind === 'trash') {
    query = query.not('deleted_at', 'is', null);
  } else {
    query = query.is('deleted_at', null);
    if (scope.kind === 'archive') query = query.eq('state', 'archived');
    else if (scope.kind === 'inbox') query = query.in('state', ['unread', 'reading']);
    else if (scope.kind === 'unsorted') query = query.is('collection_id', null);
    else if (scope.kind === 'collection') {
      query = query.in(
        'collection_id',
        collectionWithDescendants(options.collections ?? [], scope.id),
      );
    }
  }
  if (ids) query = query.in('id', ids);
  const search = options.search?.trim();
  if (search) query = query.textSearch('tsv', search, { type: 'websearch', config: 'simple' });

  const { data, error } = await query
    .order(scope.kind === 'trash' ? 'deleted_at' : 'saved_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  // The select string varies, so the client cannot infer the row type.
  return (data ?? []) as unknown as LaterItem[];
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

/** `asArticle` keeps the readable text of a page that was filed as a bookmark. */
export const refetchItem = async (
  id: string,
  options: { asArticle?: boolean } = {},
): Promise<void> => {
  await postJson<{ id: string }>('/refetch', { id, asArticle: options.asArticle });
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

export interface SidebarCounts {
  all: number;
  inbox: number;
  archive: number;
  trash: number;
  unsorted: number;
  collections: Record<string, number>;
  labels: Record<string, number>;
}

export const getSidebarCounts = async (): Promise<SidebarCounts> => {
  const { data, error } = await supabase.rpc('later_sidebar_counts');
  if (error) throw error;
  return data as SidebarCounts;
};

export const listCollections = async (): Promise<LaterCollection[]> => {
  const { data, error } = await supabase.from('later_collections').select('id, name, parent_id');
  if (error) throw error;
  return (data ?? []) as LaterCollection[];
};

export const createCollection = async (
  userId: string,
  name: string,
  parentId: string | null,
): Promise<LaterCollection> => {
  const { data, error } = await supabase
    .from('later_collections')
    .insert({ user_id: userId, name: name.trim(), parent_id: parentId })
    .select('id, name, parent_id')
    .single();
  if (error) throw error;
  return data as LaterCollection;
};

export const renameCollection = async (id: string, name: string) => {
  const { error } = await supabase
    .from('later_collections')
    .update({ name: name.trim() })
    .eq('id', id);
  if (error) throw error;
};

/** Sub-collections move up one level and the articles become unsorted. */
export const deleteCollection = async (id: string) => {
  const { data, error: readError } = await supabase
    .from('later_collections')
    .select('parent_id')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  const { error: liftError } = await supabase
    .from('later_collections')
    .update({ parent_id: data?.parent_id ?? null })
    .eq('parent_id', id);
  if (liftError) throw liftError;
  const { error } = await supabase.from('later_collections').delete().eq('id', id);
  if (error) throw error;
};

export const setItemCollection = async (itemId: string, collectionId: string | null) => {
  const { error } = await supabase
    .from('later_items')
    .update({ collection_id: collectionId })
    .eq('id', itemId);
  if (error) throw error;
};
