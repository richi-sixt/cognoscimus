import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { createBackupZip, restoreFromBackupZip } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

// The title edited in the app is the master, so a backup names a book's file after it.
// The app finds the file by the title it was imported with, so a restore puts it back there.

vi.mock('@/utils/zip', async () => {
  const { configure } = await import('@zip.js/zip.js');
  return {
    configureZip: async () => configure({ useWebWorkers: false, useCompressionStream: false }),
  };
});

const HASH = '1111111111111111111111111111aaaa';
const book: Book = {
  hash: HASH,
  format: 'CBZ',
  title: 'Asterix / Der Gallier',
  sourceTitle: 'asterix-01',
  author: 'Goscinny',
  createdAt: 1,
  updatedAt: 2,
};

afterEach(() => vi.restoreAllMocks());

const source = () =>
  ({
    loadLibraryBooks: async () => [book],
    loadSettings: async () => ({}),
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => [{ path: `${HASH}/asterix-01.cbz`, size: 4 }],
    readFile: async () => new ArrayBuffer(4),
  }) as unknown as AppService;

const target = (library: Book[]) => {
  const written: string[] = [];
  const appService = {
    loadLibraryBooks: async () => library,
    saveLibraryBooks: async () => {},
    loadSettings: async () => ({}),
    saveSettings: async () => {},
    exists: async () => false,
    createDir: async () => {},
    writeFile: async (path: string) => {
      written.push(path);
    },
  } as unknown as AppService;
  return { appService, written };
};

describe('backup file names', () => {
  it('names the book after its current title and puts it back under its stored name', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no statistics.db'));
    const zip = await createBackupZip(source());

    const { ZipReader, BlobReader } = await import('@zip.js/zip.js');
    const entries = await new ZipReader(new BlobReader(new Blob([zip]))).getEntries();
    expect(entries.map((e) => e.filename)).toContain(`${HASH}/Asterix _ Der Gallier.cbz`);

    const { appService, written } = target([]);
    await restoreFromBackupZip(appService, new Blob([zip]));
    expect(written).toEqual([`${HASH}/asterix-01.cbz`]);
  });
});
