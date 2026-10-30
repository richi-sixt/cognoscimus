import { describe, expect, it } from 'vitest';
import { extractArticle, NoArticleError } from '@/libs/later/extract';
import { normalizeUrl } from '@/libs/later/fetchPage';

const page = (body: string) => `<!doctype html><html><head>
  <title>Fallback Title</title>
  <meta property="og:image" content="/cover.jpg">
  <meta property="og:site_name" content="Example Blog">
</head><body><nav>menu</nav><article><h1>Real Title</h1>${body}</article></body></html>`;

const longText = '<p>' + 'Reading takes a while and this sentence repeats. '.repeat(40) + '</p>';

describe('extractArticle', () => {
  it('extracts title, site, thumbnail and word count', () => {
    const a = extractArticle(page(longText), 'https://example.com/post');
    expect(a.title).toContain('Title');
    expect(a.siteName).toBe('Example Blog');
    expect(a.thumbnail).toBe('https://example.com/cover.jpg');
    expect(a.wordCount).toBeGreaterThan(100);
    expect(a.contentText).toContain('Reading takes a while');
  });

  it('strips scripts, handlers, styles and unsafe URLs', () => {
    const a = extractArticle(
      page(
        longText +
          '<script>alert(1)</script><p onclick="x()">hi</p>' +
          '<a href="javascript:alert(1)">bad</a><img src="data:image/png;base64,AAAA">' +
          '<iframe src="https://evil.example"></iframe><style>p{}</style>',
      ),
      'https://example.com/post',
    );
    expect(a.contentHtml).not.toMatch(/<script|onclick|javascript:|data:image|<iframe|<style/i);
  });

  it('makes links and lazy images absolute and hardens them', () => {
    const a = extractArticle(
      page(longText + '<a href="/other">link</a><img data-src="/pic.png" alt="x">'),
      'https://example.com/dir/post',
    );
    expect(a.contentHtml).toContain('href="https://example.com/other"');
    expect(a.contentHtml).toContain('src="https://example.com/pic.png"');
    expect(a.contentHtml).toContain('rel="noopener noreferrer nofollow"');
    expect(a.contentHtml).toContain('referrerpolicy="no-referrer"');
  });

  it('throws when there is no readable article', () => {
    expect(() => extractArticle('<html><body></body></html>', 'https://example.com/')).toThrow(
      NoArticleError,
    );
  });
});

describe('normalizeUrl', () => {
  it('drops fragments and tracking parameters but keeps real ones', () => {
    expect(normalizeUrl('https://example.com/a?id=1&utm_source=x&fbclid=y#top').toString()).toBe(
      'https://example.com/a?id=1',
    );
  });
  it('rejects non-http schemes and garbage', () => {
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow();
    expect(() => normalizeUrl('nope')).toThrow();
  });
});
