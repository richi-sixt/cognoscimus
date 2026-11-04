import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZipWriter } from '@zip.js/zip.js';
import { addBooksToZip, uniqueBookFilenames } from '@/services/exportBooksService';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

// Selected books go into one flat zip, named after their current titles. A book on
// this device is read from here, any other comes from the cloud; what neither can
// deliver is skipped and reported.

const batchGetDownloadUrlsMock = vi.fn();
vi.mock('@/libs/storage', () => ({
  batchGetDownloadUrls: (...a: unknown[]) => batchGetDownloadUrlsMock(...a),
}));

const LOCAL = '1111111111111111111111111111aaaa';
const CLOUD = '2222222222222222222222222222bbbb';
const GONE = '3333333333333333333333333333cccc';

const book = (hash: string, extra: Partial<Book> = {}): Book => ({
  hash,
  format: 'CBZ',
  title: `Title ${hash.slice(0, 4)}`,
  author: 'Author',
  createdAt: 1,
  updatedAt: 2,
  uploadedAt: 5,
  ...extra,
});

const appService = (localHashes: string[]) =>
  ({
    exists: async (path: string) => localHashes.some((h) => path.startsWith(h)),
    readFile: async () => new ArrayBuffer(8),
  }) as unknown as AppService;

const capture = () => {
  const names: string[] = [];
  const writer = {
    add: async (name: string) => {
      names.push(name);
    },
  } as unknown as ZipWriter<unknown>;
  return { writer, names };
};

beforeEach(() => {
  batchGetDownloadUrlsMock.mockReset().mockImplementation(async (list: { lfp: string }[]) =>
    list.map((f) => ({
      lfp: f.lfp,
      cfp: `cloud/${f.lfp}`,
      downloadUrl: f.lfp.startsWith(GONE) ? 'https://s3/gone' : `https://s3/${f.lfp}`,
    })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('gone')
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as Response),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('uniqueBookFilenames', () => {
  it('uses the current title, not the one from the import', () => {
    expect(uniqueBookFilenames([book(LOCAL, { title: 'New', sourceTitle: 'old' })])).toEqual([
      'New.cbz',
    ]);
  });

  it('numbers equal names and cleans characters a file name cannot hold', () => {
    const names = uniqueBookFilenames([
      book(LOCAL, { title: 'A/B' }),
      book(CLOUD, { title: 'a_b' }),
      book(GONE, { title: 'A_B', format: 'EPUB' }),
    ]);
    expect(names).toEqual(['A_B.cbz', 'a_b (2).cbz', 'A_B.epub']);
  });

  it('falls back to the import title, then the hash', () => {
    expect(
      uniqueBookFilenames([
        book(LOCAL, { title: '', sourceTitle: 'imported' }),
        book(CLOUD, { title: '' }),
      ]),
    ).toEqual(['imported.cbz', `${CLOUD}.cbz`]);
  });
});

describe('addBooksToZip', () => {
  it('writes local and cloud books flat and reports what it could not get', async () => {
    const { writer, names } = capture();

    const summary = await addBooksToZip(writer, appService([LOCAL]), [
      book(LOCAL),
      book(CLOUD),
      book(GONE),
    ]);

    expect(names).toEqual(['Title 1111.cbz', 'Title 2222.cbz']);
    expect(summary).toEqual({ saved: 2, skipped: ['Title 3333'] });
  });

  it('does not ask the cloud for a book that is on this device', async () => {
    const { writer } = capture();

    await addBooksToZip(writer, appService([LOCAL]), [book(LOCAL), book(CLOUD)]);

    const asked = batchGetDownloadUrlsMock.mock.calls.flatMap((call) =>
      (call[0] as { lfp: string }[]).map((f) => f.lfp),
    );
    expect(asked.some((lfp) => lfp.startsWith(LOCAL))).toBe(false);
  });

  it('leaves out books shared with this account', async () => {
    const { writer, names } = capture();

    await addBooksToZip(writer, appService([LOCAL, CLOUD]), [
      book(LOCAL),
      book(CLOUD, { grant: { id: 'g', expiresAt: 9 } }),
    ]);

    expect(names).toEqual(['Title 1111.cbz']);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { writer, names } = capture();

    await expect(
      addBooksToZip(writer, appService([LOCAL]), [book(LOCAL)], undefined, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(names).toEqual([]);
  });
});
