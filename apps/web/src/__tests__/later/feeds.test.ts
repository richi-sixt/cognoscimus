import { describe, expect, it } from 'vitest';
import { discoverFeedUrl, FeedError, parseFeed } from '@/libs/later/feeds';

const base = 'https://example.com/feed.xml';

describe('parseFeed', () => {
  it('reads RSS 2.0 with a plain-text excerpt and dates', () => {
    const feed = parseFeed(
      `<rss version="2.0"><channel><title>Blog</title><link>https://example.com/</link>
        <item><title>One</title><link>https://example.com/one?utm_source=x</link><guid>g1</guid>
          <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description>
          <pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>
      </channel></rss>`,
      base,
    );
    expect(feed.title).toBe('Blog');
    expect(feed.siteUrl).toBe('https://example.com/');
    expect(feed.entries).toEqual([
      {
        guid: 'g1',
        url: 'https://example.com/one',
        title: 'One',
        excerpt: 'Hello world',
        publishedAt: '2026-10-05T10:00:00.000Z',
      },
    ]);
  });

  it('reads Atom, taking the alternate link and resolving relative ones', () => {
    const feed = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom blog</title>
        <link rel="self" href="https://example.com/atom"/><link href="https://example.com/"/>
        <entry><id>tag:1</id><title type="html">Two &amp;amp; more</title>
          <link rel="alternate" href="/two"/><summary>Short</summary>
          <updated>2026-10-06T08:00:00Z</updated></entry></feed>`,
      base,
    );
    expect(feed.siteUrl).toBe('https://example.com/');
    expect(feed.entries[0]).toMatchObject({
      guid: 'tag:1',
      url: 'https://example.com/two',
      excerpt: 'Short',
    });
  });

  it('reads RSS 1.0 (RDF) and falls back to the link as guid', () => {
    const feed = parseFeed(
      `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Old</title></channel>
        <item><title>Three</title><link>https://example.com/three</link>
          <dc:date>2026-10-07T00:00:00Z</dc:date></item></rdf:RDF>`,
      base,
    );
    expect(feed.entries[0]).toMatchObject({ guid: 'https://example.com/three', title: 'Three' });
  });

  it('drops entries without a usable link and ignores far-future dates', () => {
    const feed = parseFeed(
      `<rss><channel><title>t</title>
        <item><title>No link</title></item>
        <item><title>Bad</title><link>javascript:alert(1)</link></item>
        <item><title>Future</title><link>https://example.com/f</link><pubDate>Mon, 01 Jan 2999 00:00:00 GMT</pubDate></item>
      </channel></rss>`,
      base,
    );
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]?.publishedAt).toBeNull();
  });

  it('rejects documents that are not feeds', () => {
    expect(() => parseFeed('<html><body>hi</body></html>', base)).toThrow(FeedError);
  });
});

describe('discoverFeedUrl', () => {
  it('finds the advertised feed and resolves it', () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="/rss"></head>`;
    expect(discoverFeedUrl(html, 'https://example.com/blog/')).toBe('https://example.com/rss');
  });

  it('returns null when none is advertised', () => {
    expect(discoverFeedUrl('<head></head>', 'https://example.com/')).toBeNull();
  });
});
