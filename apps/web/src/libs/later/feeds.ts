import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import { normalizeUrl } from './fetchPage';
import { safeFetch } from './safeFetch';
import { assertPublicHttpUrl, FetchBlockedError } from './ssrf';

export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Entries kept per fetch; a feed with more only contributes its newest ones. */
export const FEED_MAX_ENTRIES = 50;
/** What a new feed contributes at first, so subscribing does not bury the inbox. */
export const FEED_FIRST_ENTRIES = 20;
const EXCERPT_LENGTH = 300;

export interface FeedEntry {
  guid: string;
  url: string;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  entries: FeedEntry[];
}

export class FeedError extends Error {
  constructor(
    public readonly code: 'fetch_failed' | 'not_a_feed' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'FeedError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  trimValues: true,
});

type Node = Record<string, unknown> | string | number | undefined | null;

const list = (value: unknown): Node[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value as Node];

/** The text of an element that may carry attributes (`<title type="html">…`). */
const text = (value: Node): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return text(value['#text'] as Node);
  return String(value).trim();
};

const stripHtml = (html: string): string => {
  if (!html.includes('<') && !html.includes('&')) return html.replace(/\s+/g, ' ').trim();
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return (document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const excerptOf = (html: string): string | null => {
  const plain = stripHtml(html);
  if (!plain) return null;
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH).trimEnd()}…` : plain;
};

const dateOf = (raw: string): string | null => {
  if (!raw) return null;
  const date = new Date(raw);
  // A date in the far future is a feed bug; do not let it pin an entry to the top.
  return Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000
    ? null
    : date.toISOString();
};

const absolute = (href: string, base: string): string | null => {
  if (!href.trim()) return null;
  try {
    return normalizeUrl(new URL(href, base).toString()).toString();
  } catch {
    return null;
  }
};

/** The `<link>` of an Atom entry or feed: the alternate one, else the first. */
const atomLink = (links: Node[]): string => {
  const objects = links.filter((l): l is Record<string, unknown> => typeof l === 'object' && !!l);
  const alternate = objects.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? objects[0];
  return alternate ? String(alternate['@_href'] ?? '') : '';
};

/** Reads RSS 2.0, RSS 1.0 (RDF) and Atom. Entries without a usable link are dropped. */
export const parseFeed = (xml: string, feedUrl: string): ParsedFeed => {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new FeedError('not_a_feed', 'This is not a feed');
  }

  const rss = (doc['rss'] as Record<string, unknown> | undefined)?.['channel'] as
    | Record<string, unknown>
    | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const atom = doc['feed'] as Record<string, unknown> | undefined;

  const channel = rss ?? (rdf?.['channel'] as Record<string, unknown> | undefined) ?? atom;
  if (!channel) throw new FeedError('not_a_feed', 'This is not a feed');

  const items = list(rss ? rss['item'] : rdf ? rdf['item'] : atom?.['entry']) as Record<
    string,
    Node
  >[];

  const entries: FeedEntry[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || !item) continue;
    const link = atom ? atomLink(list(item['link'])) : text(item['link']) || text(item['guid']);
    const url = absolute(link, feedUrl);
    if (!url) continue;
    const title = stripHtml(text(item['title'])) || url;
    const body =
      text(item['content:encoded']) ||
      text(item['description']) ||
      text(item['summary']) ||
      text(item['content']);
    entries.push({
      guid: text(item['guid']) || text(item['id']) || url,
      url,
      title: title.slice(0, 300),
      excerpt: excerptOf(body),
      publishedAt: dateOf(
        text(item['pubDate']) ||
          text(item['dc:date']) ||
          text(item['published']) ||
          text(item['updated']),
      ),
    });
    if (entries.length >= FEED_MAX_ENTRIES) break;
  }

  const siteLink = atom ? atomLink(list(atom['link'])) : text(channel['link'] as Node);
  return {
    title: stripHtml(text(channel['title'] as Node)).slice(0, 200),
    siteUrl: siteLink ? absolute(siteLink, feedUrl) : null,
    entries,
  };
};

/** The address of the first feed a web page advertises, or null. */
export const discoverFeedUrl = (html: string, pageUrl: string): string | null => {
  const { document } = parseHTML(html);
  for (const link of document.querySelectorAll('link[rel~="alternate"]')) {
    const type = (link.getAttribute('type') ?? '').toLowerCase();
    const href = link.getAttribute('href');
    if (href && /(rss|atom)\+xml/.test(type)) return absolute(href, pageUrl);
  }
  return null;
};

export interface FetchedFeed {
  /** True when the server said nothing changed (HTTP 304). */
  notModified: boolean;
  body: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
}

const readLimited = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > FEED_MAX_BYTES) {
      await reader.cancel();
      throw new FeedError('too_large', 'This feed is too large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
};

/**
 * Downloads a feed (or the page that points to one). Redirects are followed by hand
 * so every hop passes the public-address check; the validators of the last fetch make
 * the request conditional.
 */
export const fetchFeed = async (
  start: URL,
  validators: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchedFeed> => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(url);
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; CognoscimusLater/1.0)',
      Accept:
        'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5',
    };
    if (validators.etag) headers['If-None-Match'] = validators.etag;
    if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;

    let response: Response;
    try {
      response = await safeFetch(url, {
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        headers,
      });
    } catch (error) {
      if (error instanceof FetchBlockedError) throw error;
      throw new FeedError('fetch_failed', 'The feed could not be loaded');
    }

    if (response.status === 304) {
      return {
        notModified: true,
        body: '',
        contentType: '',
        etag: validators.etag ?? null,
        lastModified: validators.lastModified ?? null,
        finalUrl: url.toString(),
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new FeedError('fetch_failed', 'The feed could not be loaded');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      throw new FeedError('fetch_failed', `The feed answered with status ${response.status}`);
    }
    return {
      notModified: false,
      body: await readLimited(response),
      contentType: response.headers.get('content-type') ?? '',
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      finalUrl: url.toString(),
    };
  }
  throw new FeedError('fetch_failed', 'Too many redirects');
};

/**
 * Loads what a user typed: a feed address, or a page that advertises one. Returns the
 * parsed feed and the address it really lives at.
 */
export const loadFeed = async (
  input: string,
): Promise<{ feed: ParsedFeed; url: string; fetched: FetchedFeed }> => {
  let fetched = await fetchFeed(normalizeUrl(input));
  let url = fetched.finalUrl;
  if (/html/i.test(fetched.contentType) || /^\s*<!doctype html|^\s*<html/i.test(fetched.body)) {
    const found = discoverFeedUrl(fetched.body, url);
    if (!found) throw new FeedError('not_a_feed', 'No feed was found at this address');
    fetched = await fetchFeed(new URL(found));
    url = fetched.finalUrl;
  }
  return { feed: parseFeed(fetched.body, url), url, fetched };
};

export { FetchBlockedError };
