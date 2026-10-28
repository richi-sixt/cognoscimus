import { describe, expect, it } from 'vitest';
import { Book } from '@/types/book';
import { applyBookSeriesEdits, parseIndexFromTitle } from '@/app/library/utils/libraryUtils';

const book = (hash: string, title: string, metadata: Record<string, unknown> = {}) =>
  ({ hash, title, author: 'A', format: 'EPUB', metadata }) as unknown as Book;

describe('parseIndexFromTitle', () => {
  it.each([
    ['Asterix Band 12', undefined, 12],
    ['Hellboy Vol. 3 - Titel', undefined, 3],
    ['Saga #2.5', undefined, 2.5],
    ['Die Drei ??? Nr. 7', undefined, 7],
    ['Perry Rhodan 2500', 'Perry Rhodan', 2500],
    ['One Piece 104', 'One Piece', 104],
    ['Dune 4', undefined, 4],
    ['Hellboy 1994', undefined, undefined],
    ['Ohne Nummer', undefined, undefined],
  ])('%s -> %s', (title, series, expected) => {
    expect(parseIndexFromTitle(title, series)).toBe(expected);
  });
});

describe('applyBookSeriesEdits', () => {
  const books = [
    book('a', 'Reihe 1'),
    book('b', 'Reihe Band 2'),
    book('c', 'Other', { seriesIndex: 9 }),
  ];

  it('sets series and index from title for selected books only', () => {
    const out = applyBookSeriesEdits(
      books,
      ['a', 'b'],
      { series: 'Reihe', indexMode: 'fromTitle' },
      5,
    );
    expect(out[0]!.metadata).toMatchObject({ series: 'Reihe', seriesIndex: 1 });
    expect(out[1]!.metadata).toMatchObject({ series: 'Reihe', seriesIndex: 2 });
    expect(out[0]!.metadataUpdatedAt).toBe(5);
    expect(out[2]).toBe(books[2]);
  });

  it('numbers sequentially', () => {
    const out = applyBookSeriesEdits(books, ['b', 'c'], { series: 'S', indexMode: 'sequential' });
    expect(out[1]!.metadata?.seriesIndex).toBe(1);
    expect(out[2]!.metadata?.seriesIndex).toBe(2);
  });

  it('keeps the old index when the title has no number', () => {
    const out = applyBookSeriesEdits(books, ['c'], { series: 'S', indexMode: 'fromTitle' });
    expect(out[2]!.metadata?.seriesIndex).toBe(9);
  });

  it('returns the same book when nothing changes', () => {
    const out = applyBookSeriesEdits(books, ['a'], { indexMode: 'keep' });
    expect(out[0]).toBe(books[0]);
  });
});
