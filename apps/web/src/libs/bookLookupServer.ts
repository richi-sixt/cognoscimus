import { safeFetch } from '@/libs/later/safeFetch';
import {
  BOOK_COVER_MAX_BYTES,
  fromGoogleBooks,
  fromOpenLibrary,
  isbnOfQuery,
  type BookCandidate,
} from './bookLookup';

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;
const IMAGE_TYPE = /^image\/(?:jpeg|png|webp|gif|avif)\b/i;

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json', 'User-Agent': 'Cognoscimus/1.0 (book lookup)' },
  });
  if (!response.ok) throw new Error(`lookup answered ${response.status}`);
  return response.json();
};

/**
 * Looks a book up by ISBN or title in Open Library. When that finds nothing and
 * GOOGLE_BOOKS_API_KEY is set, Google Books is asked as well (it no longer
 * answers without a key). Both are public catalogues; only the query leaves
 * the server.
 */
export const searchBookCatalogues = async (query: string): Promise<BookCandidate[]> => {
  const isbn = isbnOfQuery(query);
  const googleKey = process.env['GOOGLE_BOOKS_API_KEY'];
  let failure: unknown = null;

  const openLibrary = new URL('https://openlibrary.org/search.json');
  openLibrary.searchParams.set('q', isbn ? `isbn:${isbn}` : query);
  openLibrary.searchParams.set(
    'fields',
    'title,author_name,publisher,first_publish_year,language,isbn,cover_i',
  );
  openLibrary.searchParams.set('limit', '10');
  try {
    const found = fromOpenLibrary(await getJson(openLibrary.toString()), isbn);
    if (found.length > 0) return found;
  } catch (error) {
    console.error('Open Library lookup failed:', error);
    failure = error;
  }

  if (googleKey) {
    const google = new URL('https://www.googleapis.com/books/v1/volumes');
    google.searchParams.set('q', isbn ? `isbn:${isbn}` : query);
    google.searchParams.set('maxResults', '10');
    google.searchParams.set('printType', 'books');
    google.searchParams.set('key', googleKey);
    try {
      return fromGoogleBooks(await getJson(google.toString()), isbn);
    } catch (error) {
      // The key is part of the address: log the status only, never the error.
      console.error('Google Books lookup failed');
      failure = failure ?? error;
    }
  }
  // "Nothing found" is an answer; an error is one only when no catalogue replied.
  if (failure) throw new Error('No catalogue answered');
  return [];
};

export class CoverFetchError extends Error {
  constructor(
    public readonly code: 'fetch_failed' | 'not_an_image' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'CoverFetchError';
  }
}

/**
 * Downloads a cover image from a public address. Redirects are followed by
 * hand so every hop passes the public-address check of `safeFetch`.
 */
export const fetchCoverImage = async (start: URL): Promise<{ bytes: Uint8Array; type: string }> => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cognoscimus/1.0)', Accept: 'image/*' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new CoverFetchError('fetch_failed', 'The image could not be loaded');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new CoverFetchError('fetch_failed', 'The image could not be loaded');
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!IMAGE_TYPE.test(type)) throw new CoverFetchError('not_an_image', 'This is not an image');

    const reader = response.body?.getReader();
    if (!reader) throw new CoverFetchError('fetch_failed', 'The image could not be loaded');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BOOK_COVER_MAX_BYTES) {
        await reader.cancel();
        throw new CoverFetchError('too_large', 'The image is too large');
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), type };
  }
  throw new CoverFetchError('fetch_failed', 'Too many redirects');
};
