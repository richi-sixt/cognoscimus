import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book } from '@/types/book';

// A book shared with the account must disappear when its grant ends, whether
// the date has passed (works offline) or the owner revoked it early.

const listGrantsMock = vi.fn();
vi.mock('@/libs/grants', () => ({
  listGrants: (...a: unknown[]) => listGrantsMock(...a),
  getGrantDownload: vi.fn(),
}));

const setLibrary = vi.fn();
let storeLibrary: Book[] = [];
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ libraryLoaded: true, library: storeLibrary, setLibrary }) },
}));

import { purgeInactiveGrantBooks } from '@/libs/grantImport';

const book = (hash: string, grant?: { id: string; expiresAt: number }): Book =>
  ({ hash, title: hash, author: '', format: 'EPUB', createdAt: 0, updatedAt: 0, grant }) as Book;

const appService = {
  deleteBook: vi.fn(),
  saveLibraryBooks: vi.fn(),
  loadLibraryBooks: vi.fn(),
};

const HOUR = 3_600_000;

describe('purgeInactiveGrantBooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeLibrary = [
      book('own'),
      book('live', { id: 'g-live', expiresAt: Date.now() + HOUR }),
      book('expired', { id: 'g-expired', expiresAt: Date.now() - HOUR }),
      book('revoked', { id: 'g-revoked', expiresAt: Date.now() + HOUR }),
    ];
    listGrantsMock.mockResolvedValue([{ id: 'g-live' }, { id: 'g-expired' }]);
  });

  it('removes expired and revoked grant books, keeps the rest', async () => {
    const n = await purgeInactiveGrantBooks(appService as never);
    expect(n).toBe(2);
    const deleted = appService.deleteBook.mock.calls.map(([b, action]) => [b.hash, action]);
    expect(deleted).toEqual([
      ['expired', 'purge'],
      ['revoked', 'purge'],
    ]);
    const saved = appService.saveLibraryBooks.mock.calls[0]![0] as Book[];
    expect(saved.map((b) => b.hash)).toEqual(['own', 'live']);
  });

  it('falls back to the expiry date when the server cannot be reached', async () => {
    listGrantsMock.mockRejectedValue(new Error('offline'));
    const n = await purgeInactiveGrantBooks(appService as never);
    expect(n).toBe(1);
    expect(appService.deleteBook.mock.calls[0]![0].hash).toBe('expired');
  });

  it('never touches a library without grant books', async () => {
    storeLibrary = [book('own')];
    expect(await purgeInactiveGrantBooks(appService as never)).toBe(0);
    expect(listGrantsMock).not.toHaveBeenCalled();
    expect(appService.saveLibraryBooks).not.toHaveBeenCalled();
  });
});
