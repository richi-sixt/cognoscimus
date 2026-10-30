import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';

export type LaterState = 'unread' | 'reading' | 'archived';

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
  'id, url, title, author, site_name, excerpt, thumbnail, word_count, state, progress, saved_at';

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

export const listItems = async (options: {
  view: 'inbox' | 'archive';
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
  query =
    options.view === 'archive'
      ? query.eq('state', 'archived')
      : query.in('state', ['unread', 'reading']);
  if (ids) query = query.in('id', ids);
  const search = options.search?.trim();
  if (search) query = query.textSearch('tsv', search, { type: 'websearch', config: 'simple' });

  const { data, error } = await query.order('saved_at', { ascending: false }).limit(200);
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
