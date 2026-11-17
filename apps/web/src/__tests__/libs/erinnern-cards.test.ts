import { Rating } from 'ts-fsrs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/supabase', () => ({ supabase: {} }));

import { type Card, kindOfSelection, selectForStudy } from '@/libs/erinnern/cards';
import { formatInterval, newCardFields, previewIntervals, reviewCard } from '@/libs/erinnern/srs';

const NOW = new Date('2026-03-01T10:00:00Z');

const card = (id: string, patch: Partial<Card> = {}): Card => ({
  id,
  kind: 'card',
  front: `front ${id}`,
  back: `back ${id}`,
  quote_id: null,
  created_at: NOW.toISOString(),
  card_sources: [],
  card_group_members: [],
  ...newCardFields(NOW),
  ...patch,
});

describe('scheduling (FSRS)', () => {
  it('a new card is due right away', () => {
    expect(new Date(newCardFields(NOW).due_at).getTime()).toBe(NOW.getTime());
  });

  it('pushes the due date further the better the answer', () => {
    const fresh = newCardFields(NOW);
    const due = (grade: Rating.Again | Rating.Hard | Rating.Good | Rating.Easy) =>
      new Date(reviewCard(fresh, grade, NOW).due_at).getTime();
    expect(due(Rating.Again)).toBeGreaterThan(NOW.getTime());
    expect(due(Rating.Easy)).toBeGreaterThan(due(Rating.Good));
    expect(due(Rating.Good)).toBeGreaterThanOrEqual(due(Rating.Hard));
    expect(due(Rating.Hard)).toBeGreaterThanOrEqual(due(Rating.Again));
  });

  it('counts the review and survives a round trip through the stored fields', () => {
    const first = reviewCard(newCardFields(NOW), Rating.Good, NOW);
    expect(first.reps).toBe(1);
    const later = new Date(first.due_at);
    const second = reviewCard(first, Rating.Good, later);
    expect(second.reps).toBe(2);
    expect(new Date(second.due_at).getTime()).toBeGreaterThan(later.getTime());
  });

  it('previews all four answers and formats the interval', () => {
    const preview = previewIntervals(newCardFields(NOW), NOW);
    expect(Object.keys(preview)).toHaveLength(4);
    expect(formatInterval(new Date(NOW.getTime() + 10 * 60000), NOW)).toBe('10 min');
    expect(formatInterval(new Date(NOW.getTime() + 3 * 86400000), NOW)).toBe('3 d');
  });
});

describe('choosing cards to study', () => {
  const past = new Date(NOW.getTime() - 86400000).toISOString();
  const future = new Date(NOW.getTime() + 86400000).toISOString();
  const cards = [
    card('due-old', { due_at: past, card_group_members: [{ group_id: 'g1' }] }),
    card('due-new', { card_group_members: [{ group_id: 'g2' }] }),
    card('later', { due_at: future, card_group_members: [{ group_id: 'g1' }] }),
    card('no-answer', { back: '', card_group_members: [{ group_id: 'g1' }] }),
  ];

  it('takes due cards, oldest first, and skips cards without an answer', () => {
    const ids = selectForStudy(cards, { groupId: null, mode: 'due', now: NOW }).map((c) => c.id);
    expect(ids).toEqual(['due-old', 'due-new']);
  });

  it('limits to a group', () => {
    const ids = selectForStudy(cards, { groupId: 'g1', mode: 'due', now: NOW }).map((c) => c.id);
    expect(ids).toEqual(['due-old']);
  });

  it('random mode includes cards that are not due yet', () => {
    const ids = selectForStudy(cards, { groupId: null, mode: 'random', now: NOW }, () => 0).map(
      (c) => c.id,
    );
    expect(ids.sort()).toEqual(['due-new', 'due-old', 'later']);
  });

  it('respects the limit', () => {
    expect(selectForStudy(cards, { groupId: null, mode: 'random', limit: 1 })).toHaveLength(1);
  });
});

describe('kindOfSelection', () => {
  it('tells a word from a sentence', () => {
    expect(kindOfSelection('Fernweh')).toBe('word');
    expect(kindOfSelection('  Fernweh ')).toBe('word');
    expect(kindOfSelection('Der Weg ist das Ziel')).toBe('sentence');
  });
});
