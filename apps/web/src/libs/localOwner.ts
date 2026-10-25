import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';

// The library lives in the browser, not in the account. This records whose it
// is, so that a different account signing in on the same browser starts clean
// instead of inheriting, and then syncing, the previous account's books.
const LOCAL_OWNER_KEY = 'cognoscimus-local-owner';

const readOwner = (): string | null => {
  try {
    return localStorage.getItem(LOCAL_OWNER_KEY);
  } catch {
    return null;
  }
};

const writeOwner = (userId: string) => {
  try {
    localStorage.setItem(LOCAL_OWNER_KEY, userId);
  } catch {
    // Without storage the check simply cannot remember anyone.
  }
};

/** Remove every book from this browser, and forget how far sync had come. */
export const clearLocalLibrary = async (appService: AppService): Promise<void> => {
  const books = await appService.loadLibraryBooks();
  for (const book of books) {
    try {
      await appService.deleteBook(book, 'purge');
    } catch (error) {
      console.warn('Failed to delete the files of a book', error);
    }
  }
  await appService.saveLibraryBooks([]);
  useLibraryStore.getState().setLibrary([]);

  // Start the next account's pull from the beginning.
  const settings = await appService.loadSettings();
  await appService.saveSettings({
    ...settings,
    lastSyncedAtBooks: 0,
    lastSyncedAtConfigs: 0,
    lastSyncedAtNotes: 0,
  });
};

/**
 * Make the local library belong to `userId`. If it belonged to someone else it
 * is cleared first. A browser with no recorded owner is adopted as it is.
 * Returns whether anything was cleared.
 */
export const claimLocalLibrary = async (
  appService: AppService,
  userId: string,
): Promise<boolean> => {
  const owner = readOwner();
  let cleared = false;
  if (owner && owner !== userId) {
    await clearLocalLibrary(appService);
    cleared = true;
  }
  writeOwner(userId);
  return cleared;
};
