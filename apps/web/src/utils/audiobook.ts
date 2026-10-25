import type { Book } from '@/types/book';

/**
 * True when a separate audiobook can be paired with the open book: a
 * reflowable EPUB with a table of contents. Reads the format the document
 * parsed as.
 */
export const canPairAudiobook = (
  bookData:
    | {
        book?: Pick<Book, 'format'> | null;
        docFormat?: Book['format'];
        bookDoc?: { rendition?: { layout?: string }; toc?: unknown[] } | null;
      }
    | null
    | undefined,
): boolean =>
  (bookData?.docFormat ?? bookData?.book?.format) === 'EPUB' &&
  bookData?.bookDoc?.rendition?.layout !== 'pre-paginated' &&
  !!bookData?.bookDoc?.toc?.length;
