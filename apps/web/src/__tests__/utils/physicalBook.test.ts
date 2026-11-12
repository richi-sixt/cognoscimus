import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  isFilelessBook,
  isPhysicalBook,
  newPhysicalBook,
  normalizeIsbn,
  ownershipOf,
} from '@/utils/physicalBook';

const fileBook = (physical?: { owned: boolean }): Pick<Book, 'format' | 'metadata'> => ({
  format: 'EPUB',
  metadata: { title: 'T', author: 'A', language: 'en', ...(physical ? { physical } : {}) },
});

describe('ownershipOf', () => {
  it('is digital for a book with a file', () => {
    expect(ownershipOf(fileBook())).toBe('digital');
    expect(ownershipOf({ format: 'PDF' })).toBe('digital');
  });

  it('is both when a book with a file is also on the shelf', () => {
    expect(ownershipOf(fileBook({ owned: true }))).toBe('both');
    expect(ownershipOf(fileBook({ owned: false }))).toBe('digital');
  });

  it('tells a printed book from a wish', () => {
    const owned = newPhysicalBook({ title: 'Momo', owned: true });
    const wish = newPhysicalBook({ title: 'Momo', owned: false });
    expect(ownershipOf(owned)).toBe('physical');
    expect(ownershipOf(wish)).toBe('wishlist');
    expect(ownershipOf({ format: 'PHYSICAL' })).toBe('physical');
  });
});

describe('newPhysicalBook', () => {
  it('builds a fileless entry with a hash like any other', () => {
    const book = newPhysicalBook(
      { title: '  Momo ', author: 'Michael Ende', isbn: '978-3-522-20255-8', owned: true },
      1000,
      'seed',
    );
    expect(book.format).toBe('PHYSICAL');
    expect(book.hash).toMatch(/^[0-9a-f]{32}$/);
    expect(book.title).toBe('Momo');
    expect(book.metadata?.isbn).toBe('9783522202558');
    expect(book.metadata?.physical).toEqual({ owned: true });
    expect(book.uploadedAt).toBeUndefined();
    expect(book.downloadedAt).toBeUndefined();
    expect(book.createdAt).toBe(1000);
    expect(isPhysicalBook(book)).toBe(true);
    expect(isFilelessBook(book)).toBe(true);
  });

  it('gives two copies of one title different hashes and the same metaHash', () => {
    const a = newPhysicalBook({ title: 'Momo', author: 'Ende', owned: true });
    const b = newPhysicalBook({ title: 'Momo', author: 'Ende', owned: true });
    expect(a.hash).not.toBe(b.hash);
    expect(a.metaHash).toBe(b.metaHash);
  });

  it('keeps the location and drops an invalid ISBN', () => {
    const book = newPhysicalBook({ title: 'X', isbn: '12345', location: ' Keller ', owned: true });
    expect(book.metadata?.physical).toEqual({ owned: true, location: 'Keller' });
    expect(book.metadata?.isbn).toBeUndefined();
  });
});

describe('normalizeIsbn', () => {
  it('accepts ISBN-10 and ISBN-13 with separators', () => {
    expect(normalizeIsbn('3-522-20255-x')).toBe('352220255X');
    expect(normalizeIsbn('978 3 522 20255 8')).toBe('9783522202558');
    expect(normalizeIsbn('Momo')).toBe('');
  });
});

describe('isFilelessBook', () => {
  it('covers feed subscriptions and leaves ordinary books alone', () => {
    expect(isFilelessBook({ format: 'EPUB', url: 'feed://x' })).toBe(true);
    expect(isFilelessBook({ format: 'EPUB' })).toBe(false);
  });
});
