import { parseHTML } from 'linkedom';
import { extractArticle, NoArticleError } from './extract';
import { type ItemKind, kindFromOgType, kindFromUrl, MIN_ARTICLE_WORDS } from './kind';

/** What the server stores for a saved link, article or bookmark alike. */
export interface IngestedItem {
  kind: ItemKind;
  title: string;
  author: string | null;
  siteName: string | null;
  excerpt: string | null;
  contentHtml: string;
  contentText: string;
  thumbnail: string | null;
  wordCount: number;
}

const EXCERPT_MAX = 300;

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Column values for `later_items`; shared by saving and re-fetching. */
export const toRow = (item: IngestedItem) => ({
  kind: item.kind,
  title: item.title,
  author: item.author,
  site_name: item.siteName,
  excerpt: item.excerpt,
  content_html: item.contentHtml,
  content_text: item.contentText,
  thumbnail: item.thumbnail,
  word_count: item.wordCount,
});

const bookmark = (
  kind: ItemKind,
  fields: { title: string; siteName: string; description: string | null; thumbnail: string | null },
): IngestedItem => ({
  kind,
  title: fields.title.slice(0, 300),
  author: null,
  siteName: fields.siteName.slice(0, 200),
  excerpt: fields.description ? clip(fields.description, EXCERPT_MAX) : null,
  contentHtml: '',
  // The description stays searchable even though there is no article text.
  contentText: fields.description ?? '',
  thumbnail: fields.thumbnail,
  wordCount: 0,
});

/** A bookmark made from the address alone, for files that are not fetched. */
export const bookmarkFromUrl = (url: URL, kind: ItemKind): IngestedItem => {
  const file = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  return bookmark(kind, {
    title: file || hostOf(url.toString()),
    siteName: hostOf(url.toString()),
    description: null,
    thumbnail: null,
  });
};

const metaContent = (document: Document, selector: string): string | null =>
  document.querySelector(selector)?.getAttribute('content')?.trim() || null;

const absolute = (value: string | null, base: string): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const readMetadata = (html: string, pageUrl: string) => {
  const { document } = parseHTML(html);
  const host = hostOf(pageUrl);
  return {
    ogType: metaContent(document, 'meta[property="og:type"]'),
    fields: {
      title: metaContent(document, 'meta[property="og:title"]') || document.title?.trim() || host,
      siteName: metaContent(document, 'meta[property="og:site_name"]') || host,
      description:
        metaContent(document, 'meta[property="og:description"]') ||
        metaContent(document, 'meta[name="description"]'),
      thumbnail: absolute(
        metaContent(document, 'meta[property="og:image"]') ??
          metaContent(document, 'meta[name="twitter:image"]'),
        pageUrl,
      ),
    },
  };
};

/**
 * Turns a downloaded page into something to store. Pages that clearly are not
 * articles (a video, a shop, a repository, too little text) become bookmarks;
 * `asArticle` skips that judgement and keeps the readable text whenever there is
 * any.
 */
export const ingestPage = (
  html: string,
  pageUrl: string,
  options: { asArticle?: boolean } = {},
): IngestedItem => {
  const { asArticle = false } = options;
  const { ogType, fields } = readMetadata(html, pageUrl);

  if (!asArticle) {
    const declared = kindFromUrl(new URL(pageUrl)) ?? kindFromOgType(ogType);
    if (declared) return bookmark(declared, fields);
  }

  try {
    const article = extractArticle(html, pageUrl);
    if (!asArticle && article.wordCount < MIN_ARTICLE_WORDS) return bookmark('link', fields);
    return { kind: 'article', ...article };
  } catch (error) {
    if (error instanceof NoArticleError && !asArticle) return bookmark('link', fields);
    throw error;
  }
};
