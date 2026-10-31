export const ITEM_KINDS = ['article', 'link', 'video', 'document'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Below this many words a page is a bookmark rather than something to read. */
export const MIN_ARTICLE_WORDS = 120;

const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'dailymotion.com'];
const LINK_HOSTS = [
  'github.com',
  'gitlab.com',
  'aliexpress.com',
  'etsy.com',
  'digitec.ch',
  'galaxus.ch',
];
// Shops with one site per country: amazon.de, ebay.co.uk, zalando.ch, ...
const LINK_HOST_PATTERNS = [
  /(^|\.)amazon\.[a-z.]+$/,
  /(^|\.)ebay\.[a-z.]+$/,
  /(^|\.)zalando\.[a-z.]+$/,
];
const DOCUMENT_PATH = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp)$/i;

const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The kind a link's address gives away, or null when only the page can tell. */
export const kindFromUrl = (url: URL): ItemKind | null => {
  if (DOCUMENT_PATH.test(url.pathname)) return 'document';
  const host = url.hostname.toLowerCase();
  if (VIDEO_HOSTS.some((d) => onHost(host, d))) return 'video';
  if (LINK_HOSTS.some((d) => onHost(host, d)) || LINK_HOST_PATTERNS.some((p) => p.test(host))) {
    return 'link';
  }
  return null;
};

/** The kind an Open Graph `og:type` declares, or null for ordinary pages. */
export const kindFromOgType = (ogType: string | null): ItemKind | null => {
  const type = ogType?.trim().toLowerCase();
  if (!type) return null;
  if (type.startsWith('video')) return 'video';
  if (type.startsWith('product')) return 'link';
  return null;
};
