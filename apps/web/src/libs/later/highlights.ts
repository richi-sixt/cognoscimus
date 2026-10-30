import { supabase } from '@/utils/supabase';
import type { Anchor } from './anchor';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

// Written out in full so Tailwind sees every class.
export const HIGHLIGHT_MARK_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300/40 text-inherit rounded-sm cursor-pointer',
  green: 'bg-green-400/40 text-inherit rounded-sm cursor-pointer',
  blue: 'bg-sky-400/40 text-inherit rounded-sm cursor-pointer',
  pink: 'bg-pink-400/40 text-inherit rounded-sm cursor-pointer',
};

export const HIGHLIGHT_DOT_CLASS: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300',
  green: 'bg-green-400',
  blue: 'bg-sky-400',
  pink: 'bg-pink-400',
};

export const HIGHLIGHT_QUOTE_MAX = 2000;

export interface Highlight extends Anchor {
  id: string;
  item_id: string;
  annotation: string | null;
  color: HighlightColor;
  created_at: string;
}

const COLUMNS = 'id, item_id, quote, prefix, suffix, annotation, color, created_at';

export const listHighlights = async (itemId: string): Promise<Highlight[]> => {
  const { data, error } = await supabase
    .from('later_highlights')
    .select(COLUMNS)
    .eq('item_id', itemId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Highlight[];
};

export const createHighlight = async (
  userId: string,
  itemId: string,
  anchor: Anchor,
  color: HighlightColor,
): Promise<Highlight> => {
  const { data, error } = await supabase
    .from('later_highlights')
    .insert({ user_id: userId, item_id: itemId, color, ...anchor })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as Highlight;
};

/** Puts a deleted highlight back with its old id, for "Undo". */
export const restoreHighlight = async (userId: string, highlight: Highlight) => {
  const { error } = await supabase
    .from('later_highlights')
    .insert({ user_id: userId, ...highlight });
  if (error) throw error;
};

export const updateHighlight = async (
  id: string,
  patch: { annotation?: string | null; color?: HighlightColor },
) => {
  const { error } = await supabase.from('later_highlights').update(patch).eq('id', id);
  if (error) throw error;
};

export const deleteHighlight = async (id: string) => {
  const { error } = await supabase.from('later_highlights').delete().eq('id', id);
  if (error) throw error;
};
