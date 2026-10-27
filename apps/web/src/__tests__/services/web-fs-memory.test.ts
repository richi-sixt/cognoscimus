import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getOSPlatform before importing the service
vi.mock('@/utils/misc', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getOSPlatform: vi.fn().mockReturnValue('macos'),
    isValidURL: (url: string) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },
  };
});

vi.mock('@/services/environment', () => ({
  isPWA: vi.fn().mockReturnValue(false),
}));

// Mock settingsService, bookService, etc. to avoid deep deps
vi.mock('@/services/settingsService', () => ({
  getDefaultViewSettings: vi.fn().mockReturnValue({}),
  loadSettings: vi.fn().mockResolvedValue({
    localBooksDir: '',
    migrationVersion: 99999999,
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/libraryService', () => ({
  loadLibraryBooks: vi.fn().mockResolvedValue([]),
  saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/bookService', () => ({
  getCoverImageUrl: vi.fn().mockReturnValue(''),
  getCoverImageBlobUrl: vi.fn().mockResolvedValue(''),
  getCachedImageUrl: vi.fn().mockResolvedValue(''),
  generateCoverImageUrl: vi.fn().mockResolvedValue(''),
  updateCoverImage: vi.fn().mockResolvedValue(undefined),
  importBook: vi.fn().mockResolvedValue(null),
  exportBook: vi.fn().mockResolvedValue(false),
  refreshBookMetadata: vi.fn().mockResolvedValue(false),
  isBookAvailable: vi.fn().mockResolvedValue(false),
  getBookFileSize: vi.fn().mockResolvedValue(null),
  loadBookContent: vi.fn().mockResolvedValue({}),
  loadBookConfig: vi.fn().mockResolvedValue({}),
  fetchBookDetails: vi.fn().mockResolvedValue({}),
  saveBookConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/cloudService', () => ({
  deleteBook: vi.fn().mockResolvedValue(undefined),
  uploadFileToCloud: vi.fn().mockResolvedValue(undefined),
  uploadBook: vi.fn().mockResolvedValue(undefined),
  downloadCloudFile: vi.fn().mockResolvedValue(undefined),
  downloadBookCovers: vi.fn().mockResolvedValue(undefined),
  downloadBook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/fontService', () => ({
  importFont: vi.fn().mockResolvedValue(null),
  deleteFont: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/imageService', () => ({
  importImage: vi.fn().mockResolvedValue(null),
  deleteImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/book', () => ({
  getLibraryFilename: vi.fn().mockReturnValue('library.json'),
  getLibraryBackupFilename: vi.fn().mockReturnValue('library_backup.json'),
}));

import { WebAppService } from '@/services/webAppService';
import { LOCAL_BOOKS_SUBDIR } from '@/services/constants';

// A removal or a listing must only touch the keys it needs. `getAll()` loads every
// stored value at once: with a library of local books that is gigabytes, and it
// crashed the tab whenever the reader tidied a cache folder. The fake below
// fails the test if anything asks for the whole store.

type Range = { lower: string; upper: string; lowerOpen: boolean; upperOpen: boolean };

const makeFakeIndexedDB = (initial: Record<string, unknown>) => {
  const store = new Map<string, { path: string; content: unknown }>(
    Object.entries(initial).map(([path, content]) => [path, { path, content }]),
  );
  const inRange = (key: string, r: Range) =>
    (r.lowerOpen ? key > r.lower : key >= r.lower) &&
    (r.upperOpen ? key < r.upper : key <= r.upper);

  const objectStore = {
    getAll: () => {
      throw new Error('getAll() loads the whole store');
    },
    get: (key: string) => {
      const request: { result?: unknown; onsuccess?: () => void } = {};
      setTimeout(() => {
        request.result = store.get(key);
        request.onsuccess?.();
      }, 0);
      return request;
    },
    delete: (key: string | Range) => {
      for (const k of [...store.keys()]) {
        if (typeof key === 'string' ? k === key : inRange(k, key)) store.delete(k);
      }
    },
    openCursor: (range: Range) => {
      const keys = [...store.keys()].filter((k) => inRange(k, range)).sort();
      let i = 0;
      const request: { result: unknown; onsuccess?: () => void } = { result: null };
      const step = () => {
        const key = keys[i++];
        request.result = key === undefined ? null : { value: store.get(key), continue: step_async };
        request.onsuccess?.();
      };
      const step_async = () => setTimeout(step, 0);
      step_async();
      return request;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: { oncomplete?: () => void; objectStore: () => typeof objectStore } = {
        objectStore: () => objectStore,
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  const indexedDB = {
    open: () => {
      const request: { result: unknown; onsuccess?: () => void } = { result: db };
      setTimeout(() => request.onsuccess?.(), 0);
      return request;
    },
  };
  return { indexedDB, store };
};

describe('web file system keeps memory flat', () => {
  let fake: ReturnType<typeof makeFakeIndexedDB>;

  beforeEach(() => {
    fake = makeFakeIndexedDB({
      'Cache/search/a.json': 'x',
      'Cache/search/sub/b.json': 'x',
      'Cache/search': '',
      'Cache/search-other/keep.json': 'x',
      [`${LOCAL_BOOKS_SUBDIR}/h1/book.cbz`]: new ArrayBuffer(8),
      [`${LOCAL_BOOKS_SUBDIR}/h1/cover.png`]: new ArrayBuffer(4),
      [`${LOCAL_BOOKS_SUBDIR}/h2/book.cbz`]: new ArrayBuffer(16),
    });
    vi.stubGlobal('indexedDB', fake.indexedDB);
    vi.stubGlobal('IDBKeyRange', {
      bound: (lower: string, upper: string, lowerOpen = false, upperOpen = false) => ({
        lower,
        upper,
        lowerOpen,
        upperOpen,
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('removeDir deletes a folder by key range without reading the store', async () => {
    const service = new WebAppService();
    await service.fs.removeDir('search', 'Cache', true);

    const left = [...fake.store.keys()].sort();
    expect(left).toEqual(
      [
        `${LOCAL_BOOKS_SUBDIR}/h1/book.cbz`,
        `${LOCAL_BOOKS_SUBDIR}/h1/cover.png`,
        `${LOCAL_BOOKS_SUBDIR}/h2/book.cbz`,
        'Cache/search-other/keep.json',
      ].sort(),
    );
  });

  test('readDir lists a folder with sizes and leaves other folders alone', async () => {
    const service = new WebAppService();
    const items = await service.fs.readDir('h1', 'Books');
    expect(items.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'book.cbz', size: 8 },
      { path: 'cover.png', size: 4 },
    ]);
  });
});
