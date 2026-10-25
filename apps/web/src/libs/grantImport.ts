import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getGrantDownload, listGrants, type BookGrant } from './grants';

// The library as the store holds it, or fresh from disk when no page has
// hydrated the store yet. Only a hydrated store is written back: setting
// `libraryLoaded` early would make useLibrary skip loading the settings.
const loadLibrary = async (appService: AppService) => {
  const state = useLibraryStore.getState();
  const hydrated = state.libraryLoaded;
  const library = hydrated ? [...state.library] : await appService.loadLibraryBooks();
  const persist = async () => {
    await appService.saveLibraryBooks(library);
    if (hydrated) state.setLibrary(library);
  };
  return { library, persist };
};

/**
 * Make a granted book available in the local library and return it. The file
 * is fetched from the owner's copy with a short-lived URL and imported like any
 * local file, then tagged with the grant so it is never synced or uploaded and
 * can be removed when the grant ends.
 *
 * A book the user already owns (same content hash) is returned as is: the
 * grant tag would otherwise hide their own copy from sync.
 */
export const importGrantedBook = async (
  grant: BookGrant,
  appService: AppService,
): Promise<Book> => {
  const { library, persist } = await loadLibrary(appService);
  const expiresAt = new Date(grant.expires_at).getTime();
  const existing = library.find((b) => b.hash === grant.book_hash && !b.deletedAt);

  if (existing && !existing.grant) return existing;

  if (existing) {
    // Already here from an earlier grant: renew it, and keep the local copy.
    existing.grant = { id: grant.id, expiresAt };
    if (await appService.isBookAvailable(existing)) {
      await persist();
      return existing;
    }
    // The files are gone; drop the stale record and import afresh below.
    library.splice(library.indexOf(existing), 1);
  }

  const download = await getGrantDownload(grant.id);
  const response = await fetch(download.url);
  if (!response.ok) throw new Error('Could not download the shared book');
  const blob = await response.blob();
  const file = new File([blob], `${download.title}.${download.format.toLowerCase()}`, {
    type: blob.type || 'application/octet-stream',
  });

  const imported = await appService.importBook(file, library);
  if (!imported) throw new Error('Could not import the shared book');
  imported.grant = { id: grant.id, expiresAt };
  // Nothing of it is in this account's cloud storage, whatever the import recorded.
  imported.uploadedAt = null;
  await persist();
  return imported;
};

/**
 * Remove books whose grant has ended. The expiry date is checked locally, so it
 * works offline; when the server can be reached, grants that were revoked
 * before their date are dropped as well.
 */
export const purgeInactiveGrantBooks = async (appService: AppService): Promise<number> => {
  const { library, persist } = await loadLibrary(appService);
  const granted = library.filter((b) => b.grant && !b.deletedAt);
  if (granted.length === 0) return 0;

  let activeIds: Set<string> | null = null;
  try {
    activeIds = new Set((await listGrants('grantee')).map((g) => g.id));
  } catch {
    // Offline or signed out: fall back to the stored expiry date.
  }

  const now = Date.now();
  const ended = granted.filter(
    (b) => b.grant!.expiresAt <= now || (activeIds !== null && !activeIds.has(b.grant!.id)),
  );
  if (ended.length === 0) return 0;

  for (const book of ended) {
    try {
      await appService.deleteBook(book, 'purge');
    } catch (error) {
      console.warn('Failed to delete the files of an ended grant', error);
    }
  }
  const endedHashes = new Set(ended.map((b) => b.hash));
  const remaining = library.filter((b) => !(b.grant && endedHashes.has(b.hash)));
  library.splice(0, library.length, ...remaining);
  await persist();
  return ended.length;
};
