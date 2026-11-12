import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import type { BookCandidate } from './bookLookup';

export class BookLookupError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'BookLookupError';
  }
}

const post = async (path: string, body: unknown): Promise<Response> => {
  const token = await getAccessToken();
  if (!token) throw new BookLookupError(401, 'unauthenticated', 'Not authenticated');
  const response = await fetch(`${getAPIBaseUrl()}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let code: string | undefined;
    let message = response.statusText || 'Request failed';
    try {
      const json = (await response.json()) as { error?: string; code?: string };
      if (json?.error) message = json.error;
      if (json?.code) code = json.code;
    } catch {
      // Not JSON; keep the default message.
    }
    throw new BookLookupError(response.status, code, message);
  }
  return response;
};

/** Candidates for an ISBN or a title, from public catalogues. */
export const searchBooks = async (query: string): Promise<BookCandidate[]> => {
  const response = await post('/metadata/book-search', { query });
  return ((await response.json()) as { books: BookCandidate[] }).books;
};

/** What a bookshop page says about one book. */
export const bookFromUrl = async (url: string): Promise<BookCandidate> => {
  const response = await post('/metadata/book-from-url', { url });
  return ((await response.json()) as { book: BookCandidate }).book;
};

/** A cover image from a public address, fetched by the server. */
export const fetchCover = async (url: string): Promise<Blob> => {
  const response = await post('/metadata/book-cover', { url });
  return response.blob();
};
