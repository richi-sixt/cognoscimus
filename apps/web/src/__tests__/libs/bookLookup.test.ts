import { describe, expect, it } from 'vitest';
import { fromGoogleBooks, fromOpenLibrary, isbnOfQuery } from '@/libs/bookLookup';
import { extractBookFromPage } from '@/libs/bookPage';

describe('isbnOfQuery', () => {
  it('tells an ISBN from a title', () => {
    expect(isbnOfQuery('978-3-522-20255-8')).toBe('9783522202558');
    expect(isbnOfQuery('Momo')).toBe('');
  });
});

describe('fromOpenLibrary', () => {
  it('maps a search answer and prefers the ISBN that was asked for', () => {
    const books = fromOpenLibrary(
      {
        docs: [
          {
            title: 'Momo',
            author_name: ['Michael Ende'],
            publisher: ['Thienemann'],
            first_publish_year: 1973,
            language: ['ger'],
            isbn: ['3522202554', '9783522202558'],
            cover_i: 42,
          },
          { author_name: ['No title'] },
        ],
      },
      '9783522202558',
    );
    expect(books).toEqual([
      {
        title: 'Momo',
        author: 'Michael Ende',
        publisher: 'Thienemann',
        published: '1973',
        language: 'de',
        isbn: '9783522202558',
        coverUrl: 'https://covers.openlibrary.org/b/id/42-L.jpg?default=false',
      },
    ]);
  });

  it('answers an empty list for anything else', () => {
    expect(fromOpenLibrary(null)).toEqual([]);
    expect(fromOpenLibrary({ docs: 'x' })).toEqual([]);
  });
});

describe('fromGoogleBooks', () => {
  it('maps volumes, joins the subtitle and upgrades the cover to https', () => {
    const books = fromGoogleBooks({
      items: [
        {
          volumeInfo: {
            title: 'Momo',
            subtitle: 'Ein Märchen-Roman',
            authors: ['Michael Ende'],
            publishedDate: '2005-08',
            language: 'de',
            industryIdentifiers: [
              { type: 'ISBN_10', identifier: '3522202554' },
              { type: 'ISBN_13', identifier: '9783522202558' },
            ],
            imageLinks: { thumbnail: 'http://books.google.com/x.jpg' },
          },
        },
        {},
      ],
    });
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      title: 'Momo: Ein Märchen-Roman',
      author: 'Michael Ende',
      isbn: '9783522202558',
      coverUrl: 'https://books.google.com/x.jpg',
    });
  });
});

describe('extractBookFromPage', () => {
  it('reads schema.org Book data, also inside @graph', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite', name: 'Shop' },
        {
          '@type': ['Product', 'Book'],
          name: 'Momo',
          author: [{ '@type': 'Person', name: 'Michael Ende' }],
          isbn: '978-3-522-20255-8',
          publisher: { name: 'Thienemann' },
          datePublished: '2005',
          inLanguage: 'de',
          image: ['/img/momo.jpg'],
        },
      ],
    })}</script></head><body></body></html>`;
    expect(extractBookFromPage(html, 'https://shop.example/buch/momo')).toEqual({
      title: 'Momo',
      author: 'Michael Ende',
      publisher: 'Thienemann',
      published: '2005',
      language: 'de',
      isbn: '9783522202558',
      coverUrl: 'https://shop.example/img/momo.jpg',
    });
  });

  it('falls back to Open Graph tags and an ISBN in the address', () => {
    const html = `<html><head><title>Ignored</title>
      <meta property="og:title" content="Momo">
      <meta property="og:image" content="https://cdn.example/momo.jpg">
      <script type="application/ld+json">{ broken</script></head></html>`;
    expect(extractBookFromPage(html, 'https://shop.example/p/9783522202558-momo')).toEqual({
      title: 'Momo',
      author: '',
      isbn: '9783522202558',
      coverUrl: 'https://cdn.example/momo.jpg',
    });
  });

  it('drops a cover that is not a web address and a page without a title', () => {
    const html = `<html><head><meta property="og:title" content="X">
      <meta property="og:image" content="javascript:alert(1)"></head></html>`;
    expect(extractBookFromPage(html, 'https://shop.example/x')?.coverUrl).toBeUndefined();
    expect(extractBookFromPage('<html><head></head></html>', 'https://shop.example/x')).toBeNull();
  });
});
