import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZipWriter } from '@zip.js/zip.js';
import { addBackupEntriesToZip } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService, FileItem } from '@/types/system';

// Books that live only in the cloud have no file on this device. A backup that asks
// for them fetches each one on its own, skips what cannot be fetched and says so.

const batchGetDownloadUrlsMock = vi.fn();
vi.mock('@/libs/storage', () => ({
  batchGetDownloadUrls: (...a: unknown[]) => batchGetDownloadUrlsMock(...a),
}));

const pullChangesMock = vi.fn();
vi.mock('@/libs/sync', () => ({
  SyncClient: class {
    pullChanges = (...a: unknown[]) => pullChangesMock(...a);
  },
}));

const LOCAL = '1111111111111111111111111111aaaa';
const CLOUD = '2222222222222222222222222222bbbb';
const GONE = '3333333333333333333333333333cccc';

const book = (hash: string, extra: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: `Title ${hash.slice(0, 4)}`,
  author: 'Author',
  createdAt: 1,
  updatedAt: 2,
  uploadedAt: 5,
  ...extra,
});

const appService = (books: Book[], files: FileItem[]) =>
  ({
    loadLibraryBooks: async () => books,
    loadSettings: async () => ({}) as never,
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => files,
    readFile: async () => new ArrayBuffer(8),
  }) as unknown as AppService;

const capture = () => {
  const names: string[] = [];
  const texts = new Map<string, string>();
  const writer = {
    add: async (name: string, reader?: { array?: Uint8Array }) => {
      names.push(name);
      const data = (reader as unknown as { array?: Uint8Array } | undefined)?.array;
      if (data) texts.set(name, new TextDecoder().decode(data));
    },
  } as unknown as ZipWriter<unknown>;
  return { writer, names, texts };
};

const files: FileItem[] = [
  { path: `${LOCAL}/book.epub`, size: 100 },
  { path: `${LOCAL}/cover.png`, size: 10 },
];
const library = [book(LOCAL), book(CLOUD), book(GONE)];

beforeEach(() => {
  pullChangesMock.mockReset().mockResolvedValue({ configs: [], notes: [] });
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

describe('addBackupEntriesToZip - books only in the cloud', () => {
  it('leaves them out unless asked', async () => {
    const { writer, names } = capture();

    const summary = await addBackupEntriesToZip(writer, appService(library, files), {});

    expect(names.some((n) => n.startsWith(CLOUD))).toBe(false);
    expect(batchGetDownloadUrlsMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ cloudBooks: 0, skipped: [] });
  });

  it('adds their file and cover, and reports the ones it could not fetch', async () => {
    const { writer, names } = capture();

    const summary = await addBackupEntriesToZip(writer, appService(library, files), {
      includeCloudBooks: true,
    });

    expect(names).toContain(`${CLOUD}/Title 2222.epub`);
    expect(names).toContain(`${CLOUD}/cover.png`);
    expect(names.some((n) => n.startsWith(GONE))).toBe(false);
    expect(summary.cloudBooks).toBe(1);
    expect(summary.skipped).toEqual(['Title 3333']);
  });

  it('does not fetch a book that is already on this device', async () => {
    const { writer } = capture();

    await addBackupEntriesToZip(writer, appService(library, files), { includeCloudBooks: true });

    const asked = batchGetDownloadUrlsMock.mock.calls.flatMap((call) =>
      (call[0] as { lfp: string }[]).map((f) => f.lfp),
    );
    expect(asked.some((lfp) => lfp.startsWith(LOCAL))).toBe(false);
  });

  it('asks again once when a signed address was refused', async () => {
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (first) {
          first = false;
          return { ok: false, status: 403 } as Response;
        }
        return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) } as Response;
      }),
    );
    const { writer, names } = capture();

    const summary = await addBackupEntriesToZip(writer, appService([book(CLOUD)], []), {
      includeCloudBooks: true,
    });

    expect(names).toContain(`${CLOUD}/Title 2222.epub`);
    expect(summary.skipped).toEqual([]);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { writer } = capture();

    await expect(
      addBackupEntriesToZip(
        writer,
        appService(library, files),
        { includeCloudBooks: true },
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('addBackupEntriesToZip - reading position and notes from the server', () => {
  const configRow = (hash: string, extra: Record<string, unknown> = {}) => ({
    book_hash: hash,
    meta_hash: `m-${hash}`,
    progress: JSON.stringify([12, 80]),
    location: 'epubcfi(/6/4)',
    updated_at: '2026-10-01T10:00:00.000Z',
    ...extra,
  });
  const noteRow = (hash: string, id: string, extra: Record<string, unknown> = {}) => ({
    book_hash: hash,
    id,
    type: 'annotation',
    cfi: 'epubcfi(/6/2)',
    note: `note ${id}`,
    updated_at: '2026-10-02T10:00:00.000Z',
    ...extra,
  });

  it('writes a config.json with position and live notes for a book that has none', async () => {
    pullChangesMock.mockImplementation(async (_since: number, type: string) =>
      type === 'configs'
        ? { configs: [configRow(CLOUD), configRow('9999')], notes: null }
        : {
            configs: null,
            notes: [
              noteRow(CLOUD, 'n1'),
              noteRow(CLOUD, 'n2', { deleted_at: '2026-10-03T10:00:00.000Z' }),
            ],
          },
    );
    const { writer, names, texts } = capture();

    const summary = await addBackupEntriesToZip(writer, appService(library, files), {
      includeCloudBooks: true,
    });

    expect(names).toContain(`${CLOUD}/config.json`);
    const config = JSON.parse(texts.get(`${CLOUD}/config.json`)!);
    expect(config).toMatchObject({
      bookHash: CLOUD,
      location: 'epubcfi(/6/4)',
      progress: [12, 80],
    });
    expect(config.booknotes.map((n: { id: string }) => n.id)).toEqual(['n1']);
    expect(names.some((n) => n.startsWith('9999'))).toBe(false);
    expect(summary).toMatchObject({ configs: 1, configsFailed: false });
  });

  it('keeps a config.json that is already on this device', async () => {
    pullChangesMock.mockResolvedValue({ configs: [configRow(LOCAL)], notes: [] });
    const withConfig: FileItem[] = [...files, { path: `${LOCAL}/config.json`, size: 20 }];
    const { writer, names } = capture();

    await addBackupEntriesToZip(writer, appService([book(LOCAL)], withConfig), {
      includeCloudBooks: true,
    });

    // The local file is written from disk; the server's copy is not added on top.
    expect(names.filter((n) => n === `${LOCAL}/config.json`)).toHaveLength(1);
    expect(pullChangesMock).not.toHaveBeenCalled();
  });

  it('does not ask the server unless cloud books are included', async () => {
    const { writer } = capture();

    await addBackupEntriesToZip(writer, appService(library, files), {});

    expect(pullChangesMock).not.toHaveBeenCalled();
  });

  it('still saves the books when the server cannot be read, and says so', async () => {
    pullChangesMock.mockRejectedValue(new Error('offline'));
    const { writer, names } = capture();

    const summary = await addBackupEntriesToZip(writer, appService(library, files), {
      includeCloudBooks: true,
    });

    expect(names).toContain(`${CLOUD}/Title 2222.epub`);
    expect(summary).toMatchObject({ configs: 0, configsFailed: true });
  });
});
