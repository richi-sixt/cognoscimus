import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Book } from '@/types/book';

// The library is stored in the browser. A second account signing in there must
// not inherit it: the books would be pushed into that account on the next sync.

const setLibrary = vi.fn();
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ setLibrary }) },
}));

import { claimLocalLibrary } from '@/libs/localOwner';

const appService = {
  loadLibraryBooks: vi.fn(),
  deleteBook: vi.fn(),
  saveLibraryBooks: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
};

describe('claimLocalLibrary', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    appService.loadLibraryBooks.mockResolvedValue([{ hash: 'a' }, { hash: 'b' }] as Book[]);
    appService.loadSettings.mockResolvedValue({ lastSyncedAtBooks: 5, theme: 'x' });
  });

  it('adopts a browser with no recorded owner without touching its books', async () => {
    expect(await claimLocalLibrary(appService as never, 'user-a')).toBe(false);
    expect(appService.deleteBook).not.toHaveBeenCalled();
    expect(localStorage.getItem('cognoscimus-local-owner')).toBe('user-a');
  });

  it('keeps the library when the same account returns', async () => {
    await claimLocalLibrary(appService as never, 'user-a');
    expect(await claimLocalLibrary(appService as never, 'user-a')).toBe(false);
    expect(appService.deleteBook).not.toHaveBeenCalled();
  });

  it('clears the library and the sync marks when another account signs in', async () => {
    await claimLocalLibrary(appService as never, 'user-a');
    expect(await claimLocalLibrary(appService as never, 'user-b')).toBe(true);

    expect(appService.deleteBook.mock.calls.map(([b, action]) => [b.hash, action])).toEqual([
      ['a', 'purge'],
      ['b', 'purge'],
    ]);
    expect(appService.saveLibraryBooks).toHaveBeenCalledWith([]);
    expect(setLibrary).toHaveBeenCalledWith([]);
    expect(appService.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'x', lastSyncedAtBooks: 0, lastSyncedAtNotes: 0 }),
    );
    expect(localStorage.getItem('cognoscimus-local-owner')).toBe('user-b');
  });
});
