import type { Book } from '@/types/book';
import type { BookMetadata } from '@/libs/document';
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { getMetadataHash } from '@/utils/book';
import { md5 } from '@/utils/md5';

export type Ownership = 'digital' | 'physical' | 'both' | 'wishlist';

export const PHYSICAL_TEXT_MAX = 300;
export const PHYSICAL_LOCATION_MAX = 120;

/** A printed book: a library entry that never has a file. */
export const isPhysicalBook = (book: { format?: string | null }): boolean =>
  book.format === 'PHYSICAL';

/**
 * Entries without a file to open, upload, download or share: printed books and
 * feed subscriptions. Everything that reasons about a book's FILE asks this.
 */
export const isFilelessBook = (book: { format?: string | null; url?: string }): boolean =>
  isPhysicalBook(book) || isFeedBook(book);

export const ownershipOf = (book: Pick<Book, 'format' | 'metadata'>): Ownership => {
  const physical = book.metadata?.physical;
  if (isPhysicalBook(book)) return physical?.owned === false ? 'wishlist' : 'physical';
  return physical?.owned ? 'both' : 'digital';
};

/** ISBN-10 or ISBN-13 without separators, or '' when the text is neither. */
export const normalizeIsbn = (value: string): string => {
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return /^(?:\d{13}|\d{9}[\dX])$/.test(compact) ? compact : '';
};

export interface PhysicalBookInput {
  title: string;
  author?: string;
  isbn?: string;
  publisher?: string;
  published?: string;
  language?: string;
  description?: string;
  owned: boolean;
  location?: string;
}

const clean = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max);

/**
 * A new printed book. Its hash is random: there is no file to derive it from,
 * and two copies of one title are two entries. `metaHash` still comes from the
 * metadata, so a later file of the same book groups with it.
 */
export const newPhysicalBook = (
  input: PhysicalBookInput,
  now: number = Date.now(),
  seed: string = crypto.randomUUID(),
): Book => {
  const title = clean(input.title, PHYSICAL_TEXT_MAX);
  const author = clean(input.author, PHYSICAL_TEXT_MAX);
  const isbn = normalizeIsbn(input.isbn ?? '');
  const location = clean(input.location, PHYSICAL_LOCATION_MAX);
  const publisher = clean(input.publisher, PHYSICAL_TEXT_MAX);
  const published = clean(input.published, 20);
  const language = clean(input.language, 20);
  const description = clean(input.description, 4000);
  const metadata: BookMetadata = {
    title,
    author,
    language,
    ...(publisher ? { publisher } : {}),
    ...(published ? { published } : {}),
    ...(description ? { description } : {}),
    ...(isbn ? { isbn, identifier: `urn:isbn:${isbn}` } : {}),
    physical: { owned: input.owned, ...(location ? { location } : {}) },
  };
  return {
    hash: md5(`physical:${seed}`),
    metaHash: getMetadataHash(metadata),
    format: 'PHYSICAL',
    title,
    sourceTitle: title,
    author,
    metadata,
    createdAt: now,
    updatedAt: now,
    metadataUpdatedAt: now,
  };
};
