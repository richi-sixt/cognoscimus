import { describe, expect, it } from 'vitest';
import { bookmarkFromUrl, ingestPage } from '@/libs/later/ingest';
import { kindFromOgType, kindFromUrl } from '@/libs/later/kind';

const longText = '<p>' + 'Reading takes a while and this sentence repeats. '.repeat(40) + '</p>';

const page = (body: string, head = '') => `<!doctype html><html><head>
  <title>Fallback Title</title>${head}
</head><body><article><h1>Real Title</h1>${body}</article></body></html>`;

describe('kindFromUrl', () => {
  it.each([
    ['https://example.com/files/report.PDF', 'document'],
    ['https://www.youtube.com/watch?v=abc', 'video'],
    ['https://youtu.be/abc', 'video'],
    ['https://github.com/owner/repo', 'link'],
    ['https://www.amazon.de/dp/B000', 'link'],
    ['https://example.com/blog/post', null],
    ['https://notgithub.com/x', null],
  ])('%s -> %s', (url, kind) => {
    expect(kindFromUrl(new URL(url))).toBe(kind);
  });
});

describe('kindFromOgType', () => {
  it('maps video and product types', () => {
    expect(kindFromOgType('video.other')).toBe('video');
    expect(kindFromOgType('product')).toBe('link');
    expect(kindFromOgType('article')).toBeNull();
    expect(kindFromOgType(null)).toBeNull();
  });
});

describe('ingestPage', () => {
  it('keeps a long page as an article', () => {
    const item = ingestPage(page(longText), 'https://example.com/post');
    expect(item.kind).toBe('article');
    expect(item.contentHtml).not.toBe('');
  });

  it('files a page with little text as a link', () => {
    const item = ingestPage(
      page('<p>Buy now for ten francs, free shipping on orders.</p>'),
      'https://example.com/shop',
    );
    expect(item.kind).toBe('link');
    expect(item.contentHtml).toBe('');
    expect(item.wordCount).toBe(0);
  });

  it('files a page without any readable text as a link', () => {
    expect(ingestPage('<html><body></body></html>', 'https://example.com/').kind).toBe('link');
  });

  it('follows og:type and keeps the description and image', () => {
    const item = ingestPage(
      page(
        longText,
        '<meta property="og:type" content="video.other">' +
          '<meta property="og:title" content="A Video">' +
          '<meta property="og:description" content="What it is about">' +
          '<meta property="og:image" content="/thumb.jpg">',
      ),
      'https://example.com/v/1',
    );
    expect(item.kind).toBe('video');
    expect(item.title).toBe('A Video');
    expect(item.excerpt).toBe('What it is about');
    expect(item.thumbnail).toBe('https://example.com/thumb.jpg');
  });

  it('uses the host rules before looking at the text', () => {
    expect(ingestPage(page(longText), 'https://github.com/owner/repo').kind).toBe('link');
  });

  it('keeps the text of a short page when asked for an article', () => {
    const item = ingestPage(
      page('<p>Buy now for ten francs, free shipping on orders.</p>'),
      'https://github.com/owner/repo',
      { asArticle: true },
    );
    expect(item.kind).toBe('article');
    expect(item.contentText).toContain('free shipping');
  });

  it('still throws for an empty page when an article was requested', () => {
    expect(() =>
      ingestPage('<html><body></body></html>', 'https://example.com/', { asArticle: true }),
    ).toThrow();
  });
});

describe('bookmarkFromUrl', () => {
  it('titles a file after its name', () => {
    const item = bookmarkFromUrl(new URL('https://example.com/a/My%20Report.pdf'), 'document');
    expect(item.title).toBe('My Report.pdf');
    expect(item.siteName).toBe('example.com');
    expect(item.kind).toBe('document');
  });
});
