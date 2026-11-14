import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book } from '@/types/book';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());

vi.mock('@/utils/md5', async () => {
  const actual = await vi.importActual<typeof import('@/utils/md5')>('@/utils/md5');
  return { ...actual, partialMD5: mockPartialMD5 };
});

vi.mock('@/libs/document', async () => {
  const actual = await vi.importActual<typeof import('@/libs/document')>('@/libs/document');
  class MockDocumentLoader {
    constructor(private file: File) {}
    open() {
      return mockOpen(this.file);
    }
  }
  return { ...actual, DocumentLoader: MockDocumentLoader };
});

vi.mock('@/utils/txt', () => ({ TxtToEpubConverter: vi.fn() }));
vi.mock('@/utils/svg', () => ({ svg2png: vi.fn() }));
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  createProgressHandler: vi.fn(),
  batchGetDownloadUrls: vi.fn(),
}));

import { BaseAppService } from '@/services/appService';
import { buildBookLookupIndex } from '@/services/bookService';

class TestAppService extends BaseAppService {
  protected fs = {
    openFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn(),
    createDir: vi.fn(),
    removeDir: vi.fn(),
    exists: vi.fn(),
    stats: vi.fn(),
    resolvePath: vi.fn(),
    getURL: vi.fn(),
    getBlobURL: vi.fn().mockResolvedValue(''),
    getImageURL: vi.fn(),
    getPrefix: vi.fn(),
  };

  protected resolvePath() {
    return { baseDir: 0, basePrefix: async () => '', fp: '', base: 'Books' as const };
  }

  override osPlatform = 'linux' as BaseAppService['osPlatform'];

  async init() {}
  async setCustomRootDir() {}
  async selectDirectory() {
    return '';
  }
  async selectFiles() {
    return [];
  }
  async saveFile() {
    return false;
  }
  async saveImageToGallery() {
    return false;
  }
  async ask() {
    return false;
  }
  async openDatabase() {
    return {} as ReturnType<BaseAppService['openDatabase']>;
  }
  async createWindow() {}
  async getCacheDir() {
    return '';
  }
  async clearWebviewCache() {}
  async showNotification() {}

  getFs() {
    return this.fs;
  }
}

const bytes = (size: number, fill: string) => fill.repeat(size);

/**
 * partialMD5 samples ~12 KB, so two different PDFs printed from one template
 * (identical fonts and header image up front) can collide. The importer used to
 * treat the second as a re-import of the first and overwrite it. A different
 * byte size under the same partialMD5 must become a separate book keyed by the
 * full MD5.
 */
describe('importBook partialMD5 collision between different files', () => {
  let service: TestAppService;
  let sources: Map<string, File>;
  let stored: Map<string, File>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    sources = new Map([
      ['/in/20 Lebens.pdf', new File([bytes(600, 'a')], '20 Lebens.pdf')],
      ['/in/22 Privat.pdf', new File([bytes(650, 'b')], '22 Privat.pdf')],
    ]);
    stored = new Map();
    fs.openFile.mockImplementation(async (path: string) => {
      const f = sources.get(path) ?? stored.get(path);
      if (!f) throw new Error(`no file ${path}`);
      return f;
    });
    fs.exists.mockImplementation(async (path: string) => stored.has(path));
    fs.copyFile.mockImplementation(async (from: string, _b: string, to: string) => {
      stored.set(to, sources.get(from)!);
    });
    fs.writeFile.mockResolvedValue(undefined);
    fs.createDir.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
    mockPartialMD5.mockResolvedValue('shared-partial-md5');
    mockOpen.mockImplementation(async () => ({
      book: {
        // Same generic title for every file, like the real "myVBV Lernmedien" export.
        metadata: { title: 'Lernmedien', author: 'VBV', language: 'de' },
        getCover: vi.fn().mockResolvedValue(null),
        destroy: vi.fn(),
      },
      format: 'PDF',
    }));
  });

  it('keeps both books when two different files share a partialMD5', async () => {
    const books: Book[] = [];
    const first = await service.importBook('/in/20 Lebens.pdf', books);
    const second = await service.importBook('/in/22 Privat.pdf', books);

    expect(books).toHaveLength(2);
    expect(first).not.toBe(second);
    expect(first!.hash).toBe('shared-partial-md5');
    expect(second!.hash).not.toBe('shared-partial-md5');
    expect(second!.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not depend on the import order', async () => {
    const books: Book[] = [];
    await service.importBook('/in/22 Privat.pdf', books);
    await service.importBook('/in/20 Lebens.pdf', books);
    expect(books).toHaveLength(2);
    expect(new Set(books.map((b) => b.hash)).size).toBe(2);
  });

  it('still treats a re-import of either file as the same book', async () => {
    const books: Book[] = [];
    const lookupIndex = buildBookLookupIndex(books, 'linux');
    await service.importBook('/in/20 Lebens.pdf', books, { lookupIndex });
    await service.importBook('/in/22 Privat.pdf', books, { lookupIndex });
    const again22 = await service.importBook('/in/22 Privat.pdf', books, { lookupIndex });
    const again20 = await service.importBook('/in/20 Lebens.pdf', books, { lookupIndex });

    expect(books).toHaveLength(2);
    expect(again22).toBe(books.find((b) => b.hash !== 'shared-partial-md5'));
    expect(again20).toBe(books.find((b) => b.hash === 'shared-partial-md5'));
    expect(new Set(books.map((b) => b.hash)).size).toBe(2);
  });

  it('keeps both books when the colliding files import concurrently', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = 0;
    mockPartialMD5.mockImplementation(async () => {
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      return 'shared-partial-md5';
    });
    const books: Book[] = [];
    const lookupIndex = buildBookLookupIndex(books, 'linux');

    await Promise.all([
      service.importBook('/in/20 Lebens.pdf', books, { lookupIndex }),
      service.importBook('/in/22 Privat.pdf', books, { lookupIndex }),
    ]);

    expect(books).toHaveLength(2);
    expect(new Set(books.map((b) => b.hash)).size).toBe(2);
  });

  it('does not split identical files that share a partialMD5', async () => {
    sources.set('/in/copy.pdf', new File([bytes(600, 'a')], '20 Lebens.pdf'));
    const books: Book[] = [];
    await service.importBook('/in/20 Lebens.pdf', books);
    await service.importBook('/in/copy.pdf', books);
    expect(books).toHaveLength(1);
  });
});
