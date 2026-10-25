import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SetStateAction } from 'react';

import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { INDETERMINATE_PROGRESS, type ProgressHandler } from '@/utils/transfer';

/**
 * Issue #5062 — cloud sync providers are independently selectable, so a
 * per-book Upload/Download must route to whichever of {Cognoscimus Cloud, a file
 * backend} the user has switched on, instead of assuming exactly one.
 *
 * `isCognoscimusCloudEnabled` and `getActiveFileSyncBackends` are settable per
 * test (same pattern as useBooksSync-routing.test.tsx) so every routing
 * branch can be exercised directly, without rendering the whole library page.
 */

const routing = vi.hoisted(() => ({
  cognoscimusEnabled: true,
  booksSyncEnabled: true,
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive')[],
}));

const runFileBookUpload = vi.hoisted(() => vi.fn(async () => true));
const runFileBookDownload = vi.hoisted(() =>
  vi.fn(
    async (
      _envConfig: EnvConfigType,
      _book: Book,
      _onProgress?: ProgressHandler,
    ): Promise<boolean> => true,
  ),
);
const queueUpload = vi.hoisted(() => vi.fn(() => 'transfer-1'));
const queueDownload = vi.hoisted(() => vi.fn(() => 'transfer-1'));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (text: string, params?: Record<string, string | number>): string => {
      if (!params) return text;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        text,
      );
    },
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  isCognoscimusCloudEnabled: () => routing.cognoscimusEnabled,
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: (id: string) => id !== 'book' || routing.booksSyncEnabled,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileBookUpload,
  runFileBookDownload,
}));

vi.mock('@/services/transferManager', () => ({
  transferManager: {
    queueUpload,
    queueDownload,
  },
}));

const { useBookTransferActions } = await import('@/app/library/hooks/useBookTransferActions');
const { eventDispatcher } = await import('@/utils/event');

const envConfig: EnvConfigType = { getAppService: async () => ({}) as AppService };

const makeBook = (over: Partial<Book> = {}): Book => ({
  hash: 'book-1',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

type ProgressState = { [key: string]: number };

const setup = (appService: AppService | null = null) => {
  const updateBook = vi.fn(async (_envConfig: EnvConfigType, _book: Book) => {});
  // Mimic React's functional state updates so tests can assert the actual
  // progress transitions (indeterminate start, percentage updates, cleanup).
  let progressState: ProgressState = {};
  const setBooksTransferProgress = vi.fn((updater: SetStateAction<ProgressState>) => {
    progressState = typeof updater === 'function' ? updater(progressState) : updater;
  });
  const { result } = renderHook(() =>
    useBookTransferActions(envConfig, appService, updateBook, setBooksTransferProgress),
  );
  return { result, updateBook, getProgress: () => progressState };
};

beforeEach(() => {
  vi.clearAllMocks();
  routing.cognoscimusEnabled = true;
  routing.booksSyncEnabled = true;
  routing.backends = [];
});

describe('useBookTransferActions upload with Books sync off', () => {
  it('does not queue a Cognoscimus Cloud upload and points the user to Manage Sync', async () => {
    routing.booksSyncEnabled = false;
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = setup();
    const ok = await result.current.handleBookUpload(makeBook());

    expect(queueUpload).not.toHaveBeenCalled();
    expect(ok).toBe(false);
    const toastCalls = dispatchSpy.mock.calls.filter(([event]) => event === 'toast');
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.[1]).toMatchObject({
      type: 'info',
      message: 'Turn on Books in Manage Sync to upload this book',
    });
  });
});

describe('useBookTransferActions download routing (issue #5062)', () => {
  it('queues a silent download in the background so it does not toast on completion (#6418)', async () => {
    routing.cognoscimusEnabled = true;

    const { result } = setup();
    const book = makeBook({ uploadedAt: 12345 });
    const ok = await result.current.handleBookDownload(book, { queued: true, silent: true });

    expect(queueDownload).toHaveBeenCalledWith(book, 1, true);
    expect(ok).toBe(true);
  });

  it('reports percentage progress from a direct download and clears it on completion', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      let emit!: ProgressHandler;
      const downloadBook = vi.fn(
        (_book: Book, _redownload: boolean, _reuse: boolean, onProgress?: ProgressHandler) => {
          emit = onProgress!;
          return new Promise<void>((res) => {
            release = res;
          });
        },
      );

      const { result, getProgress } = setup({ downloadBook } as unknown as AppService);
      const book = makeBook({ uploadedAt: 12345 });
      const promise = result.current.handleBookDownload(book, { queued: false });

      // The overlay is primed before the first byte — without this the cover
      // stays blank across the signed-URL round trip, auth and TLS handshake
      // for the queued:false callers (useOpenBook, the details modal's
      // Redownload), which is the "no visual feedback" symptom this exists to
      // remove. The kick takes the throttle's leading edge, so the first real
      // percentage lands on the trailing edge.
      expect(getProgress()).toEqual({ [book.hash]: INDETERMINATE_PROGRESS });

      emit({ progress: 50, total: 100, transferSpeed: 0 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(getProgress()).toEqual({ [book.hash]: 50 });

      release();
      await promise;
      expect(getProgress()).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });
});
