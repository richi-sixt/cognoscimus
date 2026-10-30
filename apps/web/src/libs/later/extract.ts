import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';

export interface ExtractedArticle {
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  contentHtml: string;
  contentText: string;
  thumbnail: string | null;
  wordCount: number;
}

export class NoArticleError extends Error {
  constructor() {
    super('No readable article found on this page');
    this.name = 'NoArticleError';
  }
}

const EXCERPT_MAX = 300;

const resolveUrl = (value: string | undefined, base: string): string | undefined => {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
};

// The saved HTML is rendered in the reader, so it is reduced to a fixed set of
// reading tags. Scripts, styles, forms, inline handlers and data: URLs never
// get through; links open in a new tab and images send no referrer.
const sanitizeArticle = (html: string, baseUrl: string): string =>
  sanitizeHtml(html, {
    allowedTags: [
      'a',
      'p',
      'br',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'em',
      'strong',
      'i',
      'b',
      'u',
      's',
      'del',
      'ins',
      'sub',
      'sup',
      'img',
      'figure',
      'figcaption',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'span',
      'div',
      'section',
      'article',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel', 'target'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'referrerpolicy'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(resolveUrl(attribs['href'], baseUrl) && {
            href: resolveUrl(attribs['href'], baseUrl)!,
          }),
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      img: (tagName, attribs) => {
        // Lazy-loading pages keep the real source in data-src.
        const src = resolveUrl(attribs['data-src'] || attribs['src'], baseUrl);
        return {
          tagName,
          attribs: {
            ...(src && { src }),
            ...(attribs['alt'] && { alt: attribs['alt'] }),
            ...(attribs['title'] && { title: attribs['title'] }),
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
          },
        };
      },
    },
  });

const meta = (document: Document, selector: string): string | null =>
  document.querySelector(selector)?.getAttribute('content')?.trim() || null;

export const extractArticle = (html: string, pageUrl: string): ExtractedArticle => {
  const { document } = parseHTML(html);

  // Readability resolves relative links against the document's base URI, which
  // a parsed string does not have.
  const base = document.createElement('base');
  base.setAttribute('href', pageUrl);
  document.head.prepend(base);

  // Read the metadata first: Readability edits the document it is given.
  const ogImage =
    meta(document, 'meta[property="og:image"]') ?? meta(document, 'meta[name="twitter:image"]');
  const ogSite = meta(document, 'meta[property="og:site_name"]');
  const docTitle = document.title?.trim() || null;

  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed || !parsed.content || !parsed.textContent?.trim()) throw new NoArticleError();

  const contentHtml = sanitizeArticle(parsed.content, pageUrl);
  const contentText = sanitizeHtml(contentHtml, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
  if (!contentText) throw new NoArticleError();

  const thumbnail = resolveUrl(ogImage ?? undefined, pageUrl);
  const hostname = new URL(pageUrl).hostname.replace(/^www\./, '');
  const excerpt = (parsed.excerpt || contentText).trim();

  return {
    title: (parsed.title || docTitle || hostname).slice(0, 300),
    author: parsed.byline?.trim().slice(0, 200) || null,
    siteName: (parsed.siteName || ogSite || hostname).slice(0, 200),
    excerpt: excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX - 1)}…` : excerpt,
    contentHtml,
    contentText,
    thumbnail: thumbnail?.startsWith('http') ? thumbnail : null,
    wordCount: contentText.split(' ').length,
  };
};
