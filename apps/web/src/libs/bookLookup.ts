// Shared between the server routes under /api/metadata and the dialog that adds
// a printed book. Pure: the parsers take what a catalogue answered and return
// candidates to choose from. Nothing here is applied without the user's say.

export interface BookCandidate {
  title: string;
  author: string;
  publisher?: string;
  published?: string;
  language?: string;
  isbn?: string;
  description?: string;
  /** A public image address; the server fetches it, never the browser. */
  coverUrl?: string;
}

export const BOOK_SEARCH_QUERY_MAX = 200;
export const BOOK_SEARCH_LIMIT = 10;
export const BOOK_COVER_MAX_BYTES = 2 * 1024 * 1024;

const text = (value: unknown, max = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const compactIsbn = (value: string): string => {
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return /^(?:\d{13}|\d{9}[\dX])$/.test(compact) ? compact : '';
};

/** The query as an ISBN, or '' when it is a title. */
export const isbnOfQuery = (query: string): string => compactIsbn(query);

/** Prefers the ISBN that was asked for, then any ISBN-13, then the first one. */
const pickIsbn = (candidates: string[], wanted: string): string | undefined => {
  const valid = candidates.map(compactIsbn).filter(Boolean);
  if (wanted && valid.includes(wanted)) return wanted;
  return valid.find((isbn) => isbn.length === 13) ?? valid[0] ?? (wanted || undefined);
};

// Open Library names languages by their three-letter code.
const OPEN_LIBRARY_LANGUAGES: Record<string, string> = {
  ger: 'de',
  eng: 'en',
  fre: 'fr',
  ita: 'it',
  spa: 'es',
  por: 'pt',
  dut: 'nl',
  tur: 'tr',
  rus: 'ru',
  jpn: 'ja',
  chi: 'zh',
};

const without = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '')) as T;

/** Candidates from an Open Library `search.json` answer. */
export const fromOpenLibrary = (json: unknown, wantedIsbn = ''): BookCandidate[] => {
  const docs = (json as { docs?: unknown })?.docs;
  if (!Array.isArray(docs)) return [];
  const result: BookCandidate[] = [];
  for (const doc of docs as Record<string, unknown>[]) {
    const title = text(doc['title']);
    if (!title) continue;
    const languages = strings(doc['language']);
    const year = doc['first_publish_year'];
    const cover = doc['cover_i'];
    result.push(
      without({
        title,
        author: strings(doc['author_name']).slice(0, 3).join(', ').slice(0, 300),
        publisher: text(strings(doc['publisher'])[0]),
        published: typeof year === 'number' ? String(year) : undefined,
        language: languages.length === 1 ? OPEN_LIBRARY_LANGUAGES[languages[0]!] : undefined,
        isbn: pickIsbn(strings(doc['isbn']), wantedIsbn),
        coverUrl:
          typeof cover === 'number'
            ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false`
            : undefined,
      }),
    );
    if (result.length >= BOOK_SEARCH_LIMIT) break;
  }
  return result;
};

/** Candidates from a Google Books `volumes` answer. */
export const fromGoogleBooks = (json: unknown, wantedIsbn = ''): BookCandidate[] => {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const result: BookCandidate[] = [];
  for (const item of items as { volumeInfo?: Record<string, unknown> }[]) {
    const info = item?.volumeInfo;
    if (!info) continue;
    const main = text(info['title']);
    if (!main) continue;
    const subtitle = text(info['subtitle']);
    const identifiers = Array.isArray(info['industryIdentifiers'])
      ? (info['industryIdentifiers'] as { identifier?: unknown }[]).map((i) => text(i?.identifier))
      : [];
    const images = info['imageLinks'] as { thumbnail?: unknown } | undefined;
    const thumbnail = text(images?.thumbnail, 1000);
    result.push(
      without({
        title: subtitle ? `${main}: ${subtitle}`.slice(0, 300) : main,
        author: strings(info['authors']).slice(0, 3).join(', ').slice(0, 300),
        publisher: text(info['publisher']),
        published: text(info['publishedDate'], 20),
        language: text(info['language'], 20),
        isbn: pickIsbn(identifiers, wantedIsbn),
        description: text(info['description'], 4000),
        coverUrl: thumbnail ? thumbnail.replace(/^http:/, 'https:') : undefined,
      }),
    );
    if (result.length >= BOOK_SEARCH_LIMIT) break;
  }
  return result;
};
