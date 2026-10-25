import { describe, it, expect } from 'vitest';
import { canPairAudiobook } from '@/utils/audiobook';

describe('canPairAudiobook', () => {
  const toc = [{ id: 0, label: 'Chapter 1', href: 'ch1.xhtml' }];
  const epubDoc = { toc, rendition: { layout: 'reflowable' } };

  it('allows a reflowable EPUB with a table of contents', () => {
    expect(
      canPairAudiobook({ book: { format: 'EPUB' }, docFormat: 'EPUB', bookDoc: epubDoc }),
    ).toBe(true);
    expect(canPairAudiobook({ book: { format: 'EPUB' }, bookDoc: { toc } })).toBe(true);
  });

  it('rejects fixed-layout EPUBs, books without a table of contents, and unloaded books', () => {
    expect(
      canPairAudiobook({
        book: { format: 'EPUB' },
        docFormat: 'EPUB',
        bookDoc: { toc, rendition: { layout: 'pre-paginated' } },
      }),
    ).toBe(false);
    expect(
      canPairAudiobook({ book: { format: 'EPUB' }, docFormat: 'EPUB', bookDoc: { toc: [] } }),
    ).toBe(false);
    expect(canPairAudiobook({ book: { format: 'EPUB' }, docFormat: 'EPUB', bookDoc: null })).toBe(
      false,
    );
    expect(canPairAudiobook(null)).toBe(false);
  });
});
