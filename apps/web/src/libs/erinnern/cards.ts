import { supabase } from '@/utils/supabase';
import { type QuoteSourceInput, tidyQuoteText } from './quotes';
import { type SrsFields, newCardFields, reviewCard } from './srs';
import type { Grade } from 'ts-fsrs';

export const CARD_TEXT_MAX = 5000;

export type CardKind = 'card' | 'word' | 'sentence' | 'quote';
export type CardSourceKind = 'book' | 'later' | 'manual' | 'quote';

export interface CardSource {
  id: string;
  card_id: string;
  kind: CardSourceKind;
  book_hash: string | null;
  later_item_id: string | null;
  title: string | null;
  author: string | null;
  cfi: string | null;
  url: string | null;
}

export interface CardGroup {
  id: string;
  kind: 'book' | 'custom';
  name: string;
  book_hash: string | null;
}

export interface Card extends SrsFields {
  id: string;
  kind: CardKind;
  front: string;
  back: string;
  quote_id: string | null;
  created_at: string;
  card_sources: CardSource[];
  card_group_members: { group_id: string }[];
}

export type CardSourceInput = Omit<QuoteSourceInput, 'kind' | 'prefix' | 'suffix'> & {
  kind: CardSourceKind;
};

const SOURCE_COLUMNS = 'id, card_id, kind, book_hash, later_item_id, title, author, cfi, url';
const SRS_COLUMNS =
  'due_at, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review_at';
const COLUMNS = `id, kind, front, back, quote_id, created_at, ${SRS_COLUMNS}, card_sources(${SOURCE_COLUMNS}), card_group_members(group_id)`;

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** One word is a "word", anything longer a "sentence". */
export const kindOfSelection = (text: string): CardKind =>
  /\s/.test(text.trim()) ? 'sentence' : 'word';

/** A card without an answer can't be learned yet: the user still has to write it. */
export const isLearnable = (card: Pick<Card, 'back'>) => card.back.trim().length > 0;

const sourceRow = (userId: string, cardId: string, source: CardSourceInput) => ({
  user_id: userId,
  card_id: cardId,
  kind: source.kind,
  book_hash: source.book_hash ?? null,
  later_item_id: source.later_item_id ?? null,
  title: clean(source.title),
  author: clean(source.author),
  cfi: source.cfi ?? null,
  url: clean(source.url),
});

const sameSource = (a: CardSourceInput, b: CardSourceInput): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'book') return a.book_hash === b.book_hash && (a.cfi ?? '') === (b.cfi ?? '');
  if (a.kind === 'later') return a.later_item_id === b.later_item_id;
  return (
    (clean(a.title) ?? '').toLowerCase() === (clean(b.title) ?? '').toLowerCase() &&
    (clean(a.author) ?? '').toLowerCase() === (clean(b.author) ?? '').toLowerCase()
  );
};

// ---- Groups ----

export const listGroups = async (): Promise<CardGroup[]> => {
  const { data, error } = await supabase
    .from('card_groups')
    .select('id, kind, name, book_hash')
    .order('name');
  if (error) throw error;
  return (data ?? []) as CardGroup[];
};

export const createGroup = async (userId: string, name: string): Promise<CardGroup> => {
  const { data, error } = await supabase
    .from('card_groups')
    .insert({ user_id: userId, kind: 'custom', name: name.trim() })
    .select('id, kind, name, book_hash')
    .single();
  if (error) throw error;
  return data as CardGroup;
};

export const renameGroup = async (id: string, name: string) => {
  const { error } = await supabase.from('card_groups').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
};

/** Deleting a group keeps its cards. */
export const deleteGroup = async (id: string) => {
  const { error } = await supabase.from('card_groups').delete().eq('id', id);
  if (error) throw error;
};

/** The group of a book: the book itself, made on first use. */
export const ensureBookGroup = async (
  userId: string,
  bookHash: string,
  title: string | null | undefined,
): Promise<string> => {
  const { data, error } = await supabase
    .from('card_groups')
    .select('id')
    .eq('book_hash', bookHash)
    .maybeSingle();
  if (error) throw error;
  if (data) return (data as { id: string }).id;
  const { data: created, error: createError } = await supabase
    .from('card_groups')
    .insert({
      user_id: userId,
      kind: 'book',
      book_hash: bookHash,
      name: clean(title)?.slice(0, 200) ?? bookHash,
    })
    .select('id')
    .single();
  if (createError) throw createError;
  return (created as { id: string }).id;
};

// ---- Cards ----

export const listCards = async (): Promise<Card[]> => {
  const { data, error } = await supabase
    .from('cards')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as unknown as Card[];
};

const addToGroups = async (userId: string, cardId: string, groupIds: string[]) => {
  if (groupIds.length === 0) return;
  const { error } = await supabase.from('card_group_members').upsert(
    groupIds.map((group_id) => ({ card_id: cardId, group_id, user_id: userId })),
    { onConflict: 'card_id,group_id', ignoreDuplicates: true },
  );
  if (error) throw error;
};

const sourcesOf = async (cardId: string): Promise<CardSourceInput[]> => {
  const { data, error } = await supabase
    .from('card_sources')
    .select(SOURCE_COLUMNS)
    .eq('card_id', cardId);
  if (error) throw error;
  return (data ?? []) as CardSourceInput[];
};

export type SaveCardResult = { status: 'created' | 'merged'; cardId: string };

/**
 * Saves a card. The same question (after normalisation) only gets the new
 * source and groups; if it had no answer yet and this one has, the answer is
 * filled in.
 */
export const saveCard = async (
  userId: string,
  input: {
    front: string;
    back?: string;
    kind?: CardKind;
    quoteId?: string | null;
    groupIds?: string[];
    source?: CardSourceInput;
  },
): Promise<SaveCardResult> => {
  const front = input.kind === 'quote' ? input.front.trim() : tidyQuoteText(input.front);
  const back = (input.back ?? '').trim();
  if (!front) throw new Error('empty card');
  if (front.length > CARD_TEXT_MAX || back.length > CARD_TEXT_MAX) throw new Error('card too long');
  const groupIds = input.groupIds ?? [];

  const { data: existingId, error: findError } = await supabase.rpc('find_card_by_front', {
    p_front: front,
  });
  if (findError) throw findError;

  if (existingId) {
    const cardId = existingId as string;
    if (input.source) {
      const have = await sourcesOf(cardId);
      if (!have.some((s) => sameSource(s, input.source!))) {
        const { error } = await supabase
          .from('card_sources')
          .insert(sourceRow(userId, cardId, input.source));
        if (error) throw error;
      }
    }
    await addToGroups(userId, cardId, groupIds);
    if (back) {
      // Only fills an empty answer; never overwrites what the user wrote.
      await supabase.from('cards').update({ back }).eq('id', cardId).eq('back', '');
    }
    return { status: 'merged', cardId };
  }

  const { data, error } = await supabase
    .from('cards')
    .insert({
      user_id: userId,
      kind: input.kind ?? 'card',
      front,
      back,
      quote_id: input.quoteId ?? null,
      ...newCardFields(),
    })
    .select('id')
    .single();
  if (error) throw error;
  const cardId = (data as { id: string }).id;
  if (input.source) {
    const { error: sourceError } = await supabase
      .from('card_sources')
      .insert(sourceRow(userId, cardId, input.source));
    if (sourceError) throw sourceError;
  }
  await addToGroups(userId, cardId, groupIds);
  return { status: 'created', cardId };
};

/** "Send to Learn" from a book selection: the book becomes the card's group. */
export const sendSelectionAsCard = async (
  userId: string,
  input: { text: string; source: CardSourceInput },
): Promise<SaveCardResult> => {
  const groupIds =
    input.source.kind === 'book' && input.source.book_hash
      ? [await ensureBookGroup(userId, input.source.book_hash, input.source.title)]
      : [];
  return saveCard(userId, {
    front: input.text,
    kind: kindOfSelection(input.text),
    groupIds,
    source: input.source,
  });
};

export const updateCard = async (id: string, patch: { front?: string; back?: string }) => {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.front !== undefined) row['front'] = patch.front.trim();
  if (patch.back !== undefined) row['back'] = patch.back.trim();
  const { error } = await supabase.from('cards').update(row).eq('id', id);
  if (error) throw error;
};

export const deleteCard = async (id: string) => {
  const { error } = await supabase.from('cards').delete().eq('id', id);
  if (error) throw error;
};

export const setCardGroups = async (userId: string, cardId: string, groupIds: string[]) => {
  const { error } = await supabase.from('card_group_members').delete().eq('card_id', cardId);
  if (error) throw error;
  await addToGroups(userId, cardId, groupIds);
};

/** Stores the answer: the new schedule and a line in the review log. */
export const answerCard = async (userId: string, card: Card, grade: Grade): Promise<SrsFields> => {
  const next = reviewCard(card, grade);
  const { error } = await supabase.from('cards').update(next).eq('id', card.id);
  if (error) throw error;
  const { error: logError } = await supabase
    .from('card_reviews')
    .insert({ user_id: userId, card_id: card.id, rating: grade, state: card.state });
  if (logError) throw logError;
  return next;
};

/** A quote as a card: the quote is the question, who said it the answer. */
export const cardFromQuote = async (
  userId: string,
  quote: {
    id: string;
    text: string;
    quote_sources: Array<{
      kind: string;
      book_hash: string | null;
      title: string | null;
      author: string | null;
      cfi: string | null;
    }>;
  },
): Promise<SaveCardResult> => {
  const first = quote.quote_sources[0];
  const back = quote.quote_sources
    .map((s) => [s.author, s.title].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('\n');
  const bookSource = quote.quote_sources.find((s) => s.kind === 'book' && s.book_hash);
  const groupIds = bookSource
    ? [await ensureBookGroup(userId, bookSource.book_hash!, bookSource.title)]
    : [];
  return saveCard(userId, {
    front: quote.text,
    back,
    kind: 'quote',
    quoteId: quote.id,
    groupIds,
    source: first
      ? {
          kind: first.kind === 'book' ? 'book' : 'quote',
          book_hash: first.book_hash,
          title: first.title,
          author: first.author,
          cfi: first.cfi,
        }
      : { kind: 'quote' },
  });
};

// ---- Choosing what to learn ----

export type StudyMode = 'due' | 'random';

/** The cards to go through: the learnable ones of a group (or all), due or shuffled. */
export const selectForStudy = (
  cards: Card[],
  options: { groupId: string | null; mode: StudyMode; limit?: number; now?: Date },
  random: () => number = Math.random,
): Card[] => {
  const now = options.now ?? new Date();
  let pool = cards.filter(isLearnable);
  if (options.groupId) {
    pool = pool.filter((c) => c.card_group_members.some((m) => m.group_id === options.groupId));
  }
  if (options.mode === 'due') {
    pool = pool
      .filter((c) => new Date(c.due_at).getTime() <= now.getTime())
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  } else {
    pool = [...pool];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
  }
  return pool.slice(0, options.limit ?? 50);
};
