import { Book } from '@/types/book';

/**
 * True when the URL is fetchable by external services (Readwise, markdown
 * readers), i.e. not a local dev server or the Tauri asset protocol.
 */
export const isPublicImageUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

/**
 * Resolve a publicly accessible cover image URL for the book, or undefined
 * when the book has none. Covers are never published to a public bucket.
 */
export const getPublicCoverUrl = async (book: Book): Promise<string | undefined> =>
  isPublicImageUrl(book.coverImageUrl) ? book.coverImageUrl : undefined;
