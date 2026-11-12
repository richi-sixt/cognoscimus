import { describe, expect, it } from 'vitest';
import { pushBooksBatched, unpushedCursorCeiling } from '@/hooks/useSync';
import type { Book } from '@/types/book';

const book = (hash: string, over: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: hash,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

// A bulk regroup went out as one request that failed, the pull then advanced
// the cursor past the unpushed rows, and they never synced again. The push is
// now batched and the cursor is held below the oldest unpushed change.
describe('pushBooksBatched', () => {
  it('pushes in order in batches of the given size', async () => {
    const sizes: number[][] = [];
    const books = ['a', 'b', 'c', 'd', 'e'].map((h) => book(h));
    const unpushed = await pushBooksBatched(
      books,
      async (batch) => {
        sizes.push(batch.map((b) => b.hash.charCodeAt(0) - 96));
        return true;
      },
      2,
    );
    expect(unpushed).toEqual([]);
    expect(sizes).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('stops at the first failed batch and returns it plus the rest', async () => {
    let calls = 0;
    const books = ['a', 'b', 'c', 'd', 'e'].map((h) => book(h));
    const unpushed = await pushBooksBatched(books, async () => ++calls !== 2, 2);
    expect(calls).toBe(2);
    expect(unpushed.map((b) => b.hash)).toEqual(['c', 'd', 'e']);
  });

  it('does nothing for an empty list', async () => {
    let calls = 0;
    const unpushed = await pushBooksBatched([], async () => {
      calls++;
      return true;
    });
    expect(unpushed).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('unpushedCursorCeiling', () => {
  it('is undefined when nothing is unpushed', () => {
    expect(unpushedCursorCeiling([])).toBeUndefined();
  });

  it('sits just below the oldest unpushed change on any clock', () => {
    const out = unpushedCursorCeiling([
      book('a', { updatedAt: 5000 }),
      book('b', { updatedAt: 1000, groupUpdatedAt: 3000 }),
      book('c', { updatedAt: 1, groupUpdatedAt: 9000 }),
    ]);
    // b changed at max(1000, 3000) = 3000; a at 5000; c at 9000 → 2999
    expect(out).toBe(2999);
  });

  it('ignores books with no stamp', () => {
    expect(
      unpushedCursorCeiling([book('a', { updatedAt: 0 }), book('b', { updatedAt: 800 })]),
    ).toBe(799);
  });
});
