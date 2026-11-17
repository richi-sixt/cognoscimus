import { supabase } from '@/utils/supabase';

export const QUOTE_TEXT_MAX = 5000;
export const QUOTE_NOTE_MAX = 5000;
/** Above this similarity a new quote is offered as a merge, below it is just saved. */
export const SIMILAR_THRESHOLD = 0.6;

export type QuoteSourceKind = 'book' | 'later' | 'manual';

export interface QuoteSource {
  id: string;
  quote_id: string;
  kind: QuoteSourceKind;
  book_hash: string | null;
  later_item_id: string | null;
  title: string | null;
  author: string | null;
  cfi: string | null;
  prefix: string;
  suffix: string;
  url: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  text: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  quote_sources: QuoteSource[];
}

export type QuoteSourceInput = Partial<
  Pick<
    QuoteSource,
    'book_hash' | 'later_item_id' | 'title' | 'author' | 'cfi' | 'prefix' | 'suffix' | 'url'
  >
> & { kind: QuoteSourceKind };

export interface SimilarQuote {
  id: string;
  text: string;
  similarity: number;
}

export type SaveQuoteResult =
  | { status: 'created'; quoteId: string }
  | { status: 'merged'; quoteId: string }
  | { status: 'similar'; candidates: SimilarQuote[] };

const SOURCE_COLUMNS =
  'id, quote_id, kind, book_hash, later_item_id, title, author, cfi, prefix, suffix, url, created_at';
const COLUMNS = `id, text, note, created_at, updated_at, quote_sources(${SOURCE_COLUMNS})`;

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Collapses the whitespace of a selected passage, which often has line breaks. */
export const tidyQuoteText = (text: string) => text.replace(/\s+/g, ' ').trim();

const sourceRow = (userId: string, quoteId: string, source: QuoteSourceInput) => ({
  user_id: userId,
  quote_id: quoteId,
  kind: source.kind,
  book_hash: source.book_hash ?? null,
  later_item_id: source.later_item_id ?? null,
  title: clean(source.title),
  author: clean(source.author),
  cfi: source.cfi ?? null,
  prefix: source.prefix ?? '',
  suffix: source.suffix ?? '',
  url: clean(source.url),
});

/** Same place twice (same book position, same article, same title and author) is no new source. */
export const isSameSource = (a: QuoteSourceInput, b: QuoteSourceInput): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'book') return a.book_hash === b.book_hash && (a.cfi ?? '') === (b.cfi ?? '');
  if (a.kind === 'later') return a.later_item_id === b.later_item_id;
  return (
    (clean(a.title) ?? '').toLowerCase() === (clean(b.title) ?? '').toLowerCase() &&
    (clean(a.author) ?? '').toLowerCase() === (clean(b.author) ?? '').toLowerCase()
  );
};

/** The reader URL that opens the book at the quoted place. */
export const bookSourceHref = (source: Pick<QuoteSource, 'book_hash' | 'cfi'>): string | null => {
  if (!source.book_hash) return null;
  const params = new URLSearchParams({ ids: source.book_hash });
  if (source.cfi) params.set('cfi', source.cfi);
  return `/reader?${params.toString()}`;
};

export const sourceLabel = (source: QuoteSource): string => {
  const parts = [source.title, source.author].filter(Boolean);
  return parts.join(' · ');
};

export const findSimilarQuotes = async (
  text: string,
  threshold = SIMILAR_THRESHOLD,
): Promise<SimilarQuote[]> => {
  const { data, error } = await supabase.rpc('find_similar_quotes', {
    p_text: text,
    p_threshold: threshold,
  });
  if (error) throw error;
  return (data ?? []) as SimilarQuote[];
};

export const listQuotes = async (search = ''): Promise<Quote[]> => {
  const q = search.trim();
  if (!q) {
    const { data, error } = await supabase
      .from('quotes')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as unknown as Quote[];
  }
  // Text and note by full-text search, source by title or author; merged.
  const escaped = q.replace(/[%_,()\\]/g, ' ');
  const [byText, bySource] = await Promise.all([
    supabase
      .from('quotes')
      .select(COLUMNS)
      .textSearch('tsv', q, { type: 'websearch', config: 'simple' })
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('quote_sources')
      .select('quote_id')
      .or(`title.ilike.%${escaped}%,author.ilike.%${escaped}%`)
      .limit(200),
  ]);
  if (byText.error) throw byText.error;
  if (bySource.error) throw bySource.error;
  const found = (byText.data ?? []) as unknown as Quote[];
  const have = new Set(found.map((quote) => quote.id));
  const extraIds = [...new Set((bySource.data ?? []).map((r) => r.quote_id as string))].filter(
    (id) => !have.has(id),
  );
  if (extraIds.length === 0) return found;
  const { data, error } = await supabase.from('quotes').select(COLUMNS).in('id', extraIds);
  if (error) throw error;
  return [...found, ...((data ?? []) as unknown as Quote[])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
};

export const addSource = async (
  userId: string,
  quoteId: string,
  source: QuoteSourceInput,
  existing: QuoteSourceInput[] = [],
) => {
  if (existing.some((s) => isSameSource(s, source))) return;
  const { error } = await supabase.from('quote_sources').insert(sourceRow(userId, quoteId, source));
  if (error) throw error;
};

const sourcesOf = async (quoteId: string): Promise<QuoteSource[]> => {
  const { data, error } = await supabase
    .from('quote_sources')
    .select(SOURCE_COLUMNS)
    .eq('quote_id', quoteId);
  if (error) throw error;
  return (data ?? []) as QuoteSource[];
};

/**
 * Saves a quote. The same text (after normalisation) only gets the new source;
 * a similar one is reported back so the caller can ask whether to merge
 * (`mergeInto`) or save anyway (`force`).
 */
export const saveQuote = async (
  userId: string,
  input: { text: string; note?: string | null; source: QuoteSourceInput },
  options: { force?: boolean } = {},
): Promise<SaveQuoteResult> => {
  const text = tidyQuoteText(input.text);
  if (!text) throw new Error('empty quote');
  if (text.length > QUOTE_TEXT_MAX) throw new Error('quote too long');

  const similar = await findSimilarQuotes(text);
  const exact = similar.find((s) => s.similarity >= 0.999);
  if (exact) {
    await addSource(userId, exact.id, input.source, await sourcesOf(exact.id));
    return { status: 'merged', quoteId: exact.id };
  }
  if (similar.length > 0 && !options.force) return { status: 'similar', candidates: similar };

  const { data, error } = await supabase
    .from('quotes')
    .insert({ user_id: userId, text, note: clean(input.note) })
    .select('id')
    .single();
  if (error) throw error;
  const quoteId = (data as { id: string }).id;
  await addSource(userId, quoteId, input.source);
  return { status: 'created', quoteId };
};

/** Adds a source to an existing quote, the answer to "similar quote exists". */
export const mergeInto = async (userId: string, quoteId: string, source: QuoteSourceInput) => {
  await addSource(userId, quoteId, source, await sourcesOf(quoteId));
};

export const updateQuote = async (id: string, patch: { text?: string; note?: string | null }) => {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.text !== undefined) row['text'] = tidyQuoteText(patch.text);
  if (patch.note !== undefined) row['note'] = clean(patch.note);
  const { error } = await supabase.from('quotes').update(row).eq('id', id);
  if (error) throw error;
};

export const deleteQuote = async (id: string) => {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) throw error;
};

export const deleteSource = async (id: string) => {
  const { error } = await supabase.from('quote_sources').delete().eq('id', id);
  if (error) throw error;
};

/** Merges `drop` into `keep`: moves the sources over, joins the notes, deletes `drop`. */
export const mergeQuotes = async (userId: string, keep: Quote, drop: Quote) => {
  for (const source of drop.quote_sources) {
    await addSource(userId, keep.id, source, keep.quote_sources);
  }
  const notes = [keep.note, drop.note].filter((n): n is string => !!n?.trim());
  const joined = [...new Set(notes)].join('\n\n');
  if (joined !== (keep.note ?? '')) {
    await updateQuote(keep.id, { note: joined.slice(0, QUOTE_NOTE_MAX) });
  }
  await deleteQuote(drop.id);
};

export interface QuoteDuplicatePair {
  a_id: string;
  b_id: string;
  similarity: number;
}

export const listDuplicatePairs = async (): Promise<QuoteDuplicatePair[]> => {
  const { data, error } = await supabase.rpc('quote_duplicate_pairs', {
    p_threshold: SIMILAR_THRESHOLD,
  });
  if (error) throw error;
  return (data ?? []) as QuoteDuplicatePair[];
};
