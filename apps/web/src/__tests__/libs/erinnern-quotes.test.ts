import { beforeEach, describe, expect, it, vi } from 'vitest';

// Saving a quote: the same text only gets the new source, a similar text is
// reported for the caller to decide, anything else becomes a new quote. The
// tests replace Supabase with a stand-in whose similarity search is scripted.

const similar = vi.fn();
const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];

vi.mock('@/utils/supabase', () => ({
  supabase: {
    rpc: (_fn: string, args: unknown) => Promise.resolve({ data: similar(args), error: null }),
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, row });
        const result = { data: { id: 'new-quote' }, error: null };
        return Object.assign(Promise.resolve({ error: null }), {
          select: () => ({ single: () => Promise.resolve(result) }),
        });
      },
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
  },
}));

import { bookSourceHref, isSameSource, saveQuote, tidyQuoteText } from '@/libs/erinnern/quotes';
import { sendQuote } from '@/libs/erinnern/send';

const source = { kind: 'book' as const, book_hash: 'abc', title: 'Book', cfi: 'epubcfi(/6/2)' };

beforeEach(() => {
  similar.mockReset();
  inserted.length = 0;
});

describe('helpers', () => {
  it('tidies whitespace of a selected passage', () => {
    expect(tidyQuoteText('  a\n  b\t c ')).toBe('a b c');
  });

  it('knows the same source twice', () => {
    expect(isSameSource(source, { ...source })).toBe(true);
    expect(isSameSource(source, { ...source, cfi: 'epubcfi(/6/4)' })).toBe(false);
    expect(
      isSameSource(
        { kind: 'manual', title: 'A ', author: 'x' },
        { kind: 'manual', title: 'a', author: 'X' },
      ),
    ).toBe(true);
    expect(isSameSource(source, { kind: 'later', later_item_id: 'i' })).toBe(false);
  });

  it('links a book source back to the place in the book', () => {
    expect(bookSourceHref({ book_hash: 'abc', cfi: 'epubcfi(/6/2)' })).toBe(
      '/reader?ids=abc&cfi=epubcfi%28%2F6%2F2%29',
    );
    expect(bookSourceHref({ book_hash: null, cfi: null })).toBeNull();
  });
});

describe('saveQuote', () => {
  it('creates a quote with its source when nothing similar exists', async () => {
    similar.mockReturnValue([]);
    const result = await saveQuote('u1', { text: 'Hello  world', source });
    expect(result).toEqual({ status: 'created', quoteId: 'new-quote' });
    expect(inserted[0]).toMatchObject({ table: 'quotes', row: { text: 'Hello world' } });
    expect(inserted[1]).toMatchObject({
      table: 'quote_sources',
      row: { quote_id: 'new-quote', book_hash: 'abc', cfi: 'epubcfi(/6/2)' },
    });
  });

  it('adds only a source to an identical quote', async () => {
    similar.mockReturnValue([{ id: 'q1', text: 'Hello world', similarity: 1 }]);
    const result = await saveQuote('u1', { text: 'hello, world!', source });
    expect(result).toEqual({ status: 'merged', quoteId: 'q1' });
    expect(inserted.map((i) => i.table)).toEqual(['quote_sources']);
  });

  it('reports a similar quote instead of saving, unless forced', async () => {
    similar.mockReturnValue([{ id: 'q1', text: 'Hello world', similarity: 0.8 }]);
    const result = await saveQuote('u1', { text: 'Hello wide world', source });
    expect(result.status).toBe('similar');
    expect(inserted).toHaveLength(0);
    const forced = await saveQuote('u1', { text: 'Hello wide world', source }, { force: true });
    expect(forced.status).toBe('created');
  });

  it('rejects an empty quote', async () => {
    await expect(saveQuote('u1', { text: '  \n ', source })).rejects.toThrow();
  });
});

describe('sendQuote', () => {
  it('merges into the best match only when confirmed', async () => {
    similar.mockReturnValue([{ id: 'q1', text: 'Hello world', similarity: 0.8 }]);
    expect(await sendQuote('u1', { text: 'Hello wide world', source }, () => false)).toBe(
      'cancelled',
    );
    expect(inserted).toHaveLength(0);
    expect(await sendQuote('u1', { text: 'Hello wide world', source }, () => true)).toBe('merged');
    expect(inserted[0]).toMatchObject({ table: 'quote_sources', row: { quote_id: 'q1' } });
  });
});
