import { parseHTML } from 'linkedom';
import type { BookCandidate } from './bookLookup';

// Reads what a bookshop page says about one book: the schema.org data most
// shops embed, then the Open Graph tags, then an ISBN in the address.

type Node = Record<string, unknown>;

const text = (value: unknown, max = 300): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const isbnOf = (value: unknown): string => {
  const compact = text(value, 40).replace(/[\s-]/g, '').toUpperCase();
  return /^(?:97[89]\d{10}|\d{9}[\dX])$/.test(compact) ? compact : '';
};

const typesOf = (node: Node): string[] => {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string');
};

/** Every object in a JSON-LD document, including `@graph` and nested entries. */
const flatten = (value: unknown, out: Node[], depth = 0): void => {
  if (!value || depth > 6) return;
  if (Array.isArray(value)) {
    for (const entry of value) flatten(entry, out, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const node = value as Node;
  out.push(node);
  for (const key of ['@graph', 'mainEntity', 'workExample', 'itemListElement', 'item']) {
    flatten(node[key], out, depth + 1);
  }
};

const nameOf = (value: unknown): string => {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) {
    return value.map(nameOf).filter(Boolean).slice(0, 3).join(', ').slice(0, 300);
  }
  if (value && typeof value === 'object') return text((value as Node)['name']);
  return '';
};

const imageOf = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return imageOf(value[0]);
  if (value && typeof value === 'object') return imageOf((value as Node)['url']);
  return '';
};

const absoluteHttp = (value: string, base: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const extractBookFromPage = (html: string, pageUrl: string): BookCandidate | null => {
  const { document } = parseHTML(html);

  const nodes: Node[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      flatten(JSON.parse(script.textContent ?? ''), nodes);
    } catch {
      // A shop with broken JSON-LD still has Open Graph tags.
    }
  }
  const book =
    nodes.find((n) => typesOf(n).includes('Book')) ??
    nodes.find((n) => typesOf(n).includes('Product') && (isbnOf(n['isbn']) || isbnOf(n['gtin13'])));

  const meta = (selector: string): string =>
    text(document.querySelector(selector)?.getAttribute('content'), 4000);

  const title =
    text(book?.['name']) ||
    meta('meta[property="og:title"]') ||
    text(document.querySelector('title')?.textContent);
  if (!title) return null;

  const isbn =
    isbnOf(book?.['isbn']) ||
    isbnOf(book?.['gtin13']) ||
    isbnOf(meta('meta[property="books:isbn"]')) ||
    isbnOf(meta('meta[property="book:isbn"]')) ||
    isbnOf(/(?:^|\D)(97[89]\d{10})(?:\D|$)/.exec(pageUrl)?.[1]);

  const candidate: BookCandidate = {
    title: title.slice(0, 300),
    author: nameOf(book?.['author']) || meta('meta[property="book:author"]').slice(0, 300),
  };
  const publisher = nameOf(book?.['publisher']);
  const published = text(book?.['datePublished'], 20);
  const language = nameOf(book?.['inLanguage']).slice(0, 20);
  const description = text(book?.['description'], 4000) || meta('meta[property="og:description"]');
  const coverUrl = absoluteHttp(
    imageOf(book?.['image']) || meta('meta[property="og:image"]'),
    pageUrl,
  );
  if (publisher) candidate.publisher = publisher;
  if (published) candidate.published = published;
  if (language) candidate.language = language;
  if (isbn) candidate.isbn = isbn;
  if (description) candidate.description = description;
  if (coverUrl) candidate.coverUrl = coverUrl;
  return candidate;
};
