'use client';

import { purgeInactiveGrantBooks } from '@/libs/grantImport';
import BookshelvesDialog from './components/BookshelvesDialog';

import clsx from 'clsx';
import * as React from 'react';
import { MdChevronRight, MdClose } from 'react-icons/md';
import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { ReadonlyURLSearchParams, useSearchParams } from 'next/navigation';

import { Book, BooksGroup, type LibrarySearchConfig } from '@/types/book';
import { DeleteAction } from '@/types/system';
import { buildBookLookupIndex } from '@/services/bookService';
import { debounce } from '@/utils/debounce';
import { createSerialRunner, runWithConcurrency } from '@/utils/concurrency';
import { createThrottledCheckpoint } from '@/utils/checkpoint';
import { DEFAULT_NEARBY_WORDS } from '@/utils/searchConfig';
import { clearLibrarySearchHistory, loadLibrarySearchHistory } from './utils/searchHistory';
import type { LibrarySearchTarget } from '@/types/book';
import { navigateToLibrary, navigateToLogin, navigateToReader } from '@/utils/nav';
import { listFormater, markBookDeleted } from '@/utils/book';
import { getImportErrorMessage } from '@/services/errors';
import { ingestFile } from '@/services/ingestService';
import { saveBookMetadataEdit } from '@/services/bookMetadataEdit';
import { eventDispatcher } from '@/utils/event';
import { transferManager } from '@/services/transferManager';
import { purgeCloudBookData } from '@/services/purgeCloudBookData';
import { isCognoscimusCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { getFilename, getFolderImportGroupName } from '@/utils/path';
import {
  extractCollectionPack,
  isCognoscimusPackFile,
  resolveImportGroup,
} from '@/services/pack/packService';
import { getInitializedAppService } from '@/services/environment';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTheme } from '@/hooks/useTheme';
import { useUICSS } from '@/hooks/useUICSS';
import { useBooksSync } from './hooks/useBooksSync';
import { useBookTransferActions } from './hooks/useBookTransferActions';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTransferStore } from '@/store/transferStore';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { getLibraryViewSettings } from '@/helpers/settings';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { SelectedFile, useFileSelector } from '@/hooks/useFileSelector';

import { getActiveBookshelfGroupBy } from '@/services/bookshelves/grouping';
import { LibraryGroupByType } from '@/types/settings';
import { BookMetadata } from '@/libs/document';
import { AboutWindow } from '@/components/AboutWindow';
import ReadingStatsDialog from '@/components/stats/ReadingStatsDialog';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { BookDetailModal } from '@/components/metadata';
import { FeedsView } from './components/feeds/FeedsView';
import AddFeedModal from './components/feeds/AddFeedModal';
import { fetchAndParseFeed } from '@/services/rss/feedClient';
import { createFeedBook, ensureFeedBookCover } from '@/services/rss/feedBook';
import { BackupWindow } from './components/BackupWindow';
import { useDragDropImport } from './hooks/useDragDropImport';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useAppRouter } from '@/hooks/useAppRouter';
import { Toast } from '@/components/Toast';
import { createBookGroups, findGroupById, getBreadcrumbs } from './utils/libraryUtils';
import Spinner from '@/components/Spinner';
import LibraryHeader from './components/LibraryHeader';
import Bookshelf from './components/Bookshelf';
import ImportMenuPopup from './components/ImportMenuPopup';
import GroupHeader from './components/GroupHeader';
import FailedImportsDialog, { FailedImport } from './components/FailedImportsDialog';
import ImportPastedTextDialog from './components/ImportPastedTextDialog';
import NowPlayingBar from './components/NowPlayingBar';
import useShortcuts from '@/hooks/useShortcuts';
import { useReplicaPull } from '@/hooks/useReplicaPull';
import { useCustomFonts } from '@/hooks/useCustomFonts';
import DropIndicator from '@/components/DropIndicator';
import SettingsDialog from '@/components/settings/SettingsDialog';
import ModalPortal from '@/components/ModalPortal';
import TransferQueuePanel from './components/TransferQueuePanel';

const IMPORT_CONCURRENCY = 4;
// How often the library index is persisted during a long import (#5601). A
// crash/kill mid-run loses at most this much work instead of the entire run;
// keep it long enough that the full-library serialization stays a rounding
// error next to the per-file parse/copy work.
const IMPORT_CHECKPOINT_INTERVAL_MS = 15 * 1000;
// One import run at a time, app-wide: each run builds a lookup index over the
// same live library array, so overlapping runs re-import the same files as
// duplicate rows (#5601).
const enqueueImportRun = createSerialRunner();
const LIBRARY_SEARCH_MODES: LibrarySearchConfig['mode'][] = [
  'contains',
  'whole-words',
  'regex',
  'nearby-words',
  'fuzzy',
];

const getLibrarySearchConfig = (
  searchParams: ReadonlyURLSearchParams | null,
): LibrarySearchConfig => {
  const modeParam = searchParams?.get('mode') as LibrarySearchConfig['mode'] | null;
  const nearbyParam = Number(searchParams?.get('nearby'));
  return {
    scope: 'book',
    mode: modeParam && LIBRARY_SEARCH_MODES.includes(modeParam) ? modeParam : 'contains',
    matchCase: searchParams?.get('matchCase') === 'true',
    matchDiacritics: searchParams?.get('matchDiacritics') === 'true',
    nearbyWords:
      Number.isFinite(nearbyParam) && nearbyParam > 0 ? nearbyParam : DEFAULT_NEARBY_WORDS,
  };
};

const LibraryPageWithSearchParams = () => {
  const searchParams = useSearchParams();
  return <LibraryPageContent searchParams={searchParams} />;
};

const LibraryPageContent = ({ searchParams }: { searchParams: ReadonlyURLSearchParams | null }) => {
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const {
    library: libraryBooks,
    libraryLoaded: libraryLoadedFromDisk,
    isSyncing,
    syncProgress,
    updateBook,
    updateBooks,
    setLibrary,
    getGroupId,
    getGroupName,
  } = useLibraryStore();
  const _ = useTranslation();
  const { selectFiles } = useFileSelector(appService, _);
  const { safeAreaInsets: insets, isRoundedWindow } = useThemeStore();
  const { clearBookData } = useBookDataStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { isSettingsDialogOpen, setSettingsDialogOpen } = useSettingsStore();
  // Field selector, not `const { isTransferQueueOpen } = useTransferStore()`:
  // a whole-store subscription re-renders the entire library tree on every
  // transfer progress tick (~10/sec per active upload), freezing the app
  // during a bulk cloud upload (issue #5047).
  const isTransferQueueOpen = useTransferStore((state) => state.isTransferQueueOpen);

  // Library page pulls user replicas (dictionaries, custom fonts,
  // background textures, custom
  // translators + prompts, custom TTS services, bundled settings). Deferred 10s; module-scoped
  // dedup means a later navigation to the reader won't re-pull the same kind.
  useReplicaPull({
    kinds: [
      'dictionary',
      'font',
      'texture',
      'custom_translator',
      'translation_prompt',
      'custom_tts',
      'settings',
      'bookshelf',
    ],
  });
  // Hydrate the custom-font store from persisted settings so the Font
  // panel sees imported fonts even when opened straight from the
  // library — the replica pull above is auth-gated and the reader's
  // FoliateViewer hydration never runs without a book open.
  useCustomFonts();
  const [showFeeds, setShowFeeds] = useState(false);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [showImportPastedText, setShowImportPastedText] = useState(false);
  const [importMenuAnchor, setImportMenuAnchor] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  // Seed from the library store: if we already have books in memory (the
  // common reader → library return path), treat the page as loaded
  // immediately. This prevents `showBookshelf` from briefly being false on
  // remount, which used to flash a placeholder before `initLibrary` finished.
  const [libraryLoaded, setLibraryLoaded] = useState(() => libraryBooks.length > 0);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [isSelectNone, setIsSelectNone] = useState(false);
  const [librarySearchQuery, setLibrarySearchQuery] = useState(searchParams?.get('q') ?? '');
  const pendingLibrarySearchQueryRef = useRef<string | null>(null);
  const [librarySearchProgress, setLibrarySearchProgress] = useState<number | null>(null);
  const [librarySearchHistory, setLibrarySearchHistory] = useState<string[]>([]);
  const [librarySearchTarget, setLibrarySearchTarget] = useState<LibrarySearchTarget>(() =>
    ['contents', 'text'].includes(searchParams?.get('search') ?? '') ? 'text' : 'books',
  );
  const [librarySearchConfig, setLibrarySearchConfig] = useState<LibrarySearchConfig>(() =>
    getLibrarySearchConfig(searchParams),
  );
  useEffect(() => {
    if (librarySearchTarget === 'text' && !librarySearchQuery.trim()) {
      setLibrarySearchHistory(loadLibrarySearchHistory());
    }
  }, [librarySearchTarget, librarySearchQuery]);
  const librarySearchTargetRef = useRef(librarySearchTarget);
  const librarySearchConfigRef = useRef(librarySearchConfig);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [failedImportsModal, setFailedImportsModal] = useState<FailedImport[] | null>(null);
  const [currentGroupPath, setCurrentGroupPath] = useState<string | undefined>(undefined);
  const [currentVirtualGroup, setCurrentVirtualGroup] = useState<{
    groupBy:
      | typeof LibraryGroupByType.Series
      | typeof LibraryGroupByType.Author
      | typeof LibraryGroupByType.Tag
      | typeof LibraryGroupByType.Subject
      | typeof LibraryGroupByType.Status;
    groupName: string;
    localized?: boolean;
  } | null>(null);
  // Direct (non-queued) download progress, keyed by book hash. Entries are
  // added and removed by useBookTransferActions, its only writer.
  const [booksTransferProgress, setBooksTransferProgress] = useState<{
    [key: string]: number;
  }>({});
  const [pendingNavigationBookIds, setPendingNavigationBookIds] = useState<string[] | null>(null);
  const isInitiating = useRef(false);

  const iconSize = useResponsiveSize(18);
  const viewSettings = settings.globalViewSettings;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
  }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const getScrollKey = (group: string) => `library-scroll-${group || 'all'}`;

  const saveScrollPosition = (group: string) => {
    if (scrollRef.current) {
      sessionStorage.setItem(getScrollKey(group), scrollRef.current.scrollTop.toString());
    }
  };

  const restoreScrollPosition = useCallback((group: string) => {
    const savedPosition = sessionStorage.getItem(getScrollKey(group));
    if (savedPosition && scrollRef.current) {
      scrollRef.current.scrollTop = parseInt(savedPosition, 10);
    }
  }, []);

  useTheme({ appThemeColor: 'base-200' });
  useUICSS();

  // Apply the library's own background texture (separate from the reader's,
  // issue #4743). Re-applies on mount so returning from a textured book
  // restores the library background, and whenever the library texture — or the
  // reader/global texture it inherits when unset — changes from the Color panel.
  const { applyBackgroundTexture } = useBackgroundTexture();
  useEffect(() => {
    applyBackgroundTexture(envConfig, getLibraryViewSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    envConfig,
    applyBackgroundTexture,
    settings.libraryBackgroundTextureId,
    settings.libraryBackgroundOpacity,
    settings.libraryBackgroundSize,
    settings.globalViewSettings?.backgroundTextureId,
    settings.globalViewSettings?.backgroundOpacity,
    settings.globalViewSettings?.backgroundSize,
  ]);

  useTransferQueue(libraryLoaded);

  // Books shared with this account leave the library when their grant ends.
  useEffect(() => {
    if (!libraryLoaded || !appService) return;
    purgeInactiveGrantBooks(appService).catch((error) =>
      console.warn('Could not check shared books', error),
    );
  }, [libraryLoaded, appService]);

  const { pullLibrary, pushLibrary } = useBooksSync();
  // Library-scoped auto-sync for the active third-party cloud provider (WebDAV /
  // Google Drive): keeps library.json current on import / delete / book-close,
  // parity with useBooksSync. No-op when no provider is enabled.
  const { isDragging } = useDragDropImport();

  usePullToRefresh(
    scrollRef,
    async () => {
      if (!user) {
        navigateToLogin(router);
        return;
      }
      await pullLibrary(false, true);
    },
    async () => {
      if (!user) {
        navigateToLogin(router);
        return;
      }
      await pullLibrary(true, true);
    },
  );
  useShortcuts({
    onOpenFontLayoutSettings: () => {
      setSettingsDialogOpen(true);
    },
    onOpenBooks: () => {
      handleImportBooksFromFiles();
    },
  });

  useEffect(() => {
    const snapshot = searchParams?.toString() || '';
    if (snapshot !== new URLSearchParams(window.location.search).toString()) return;
    sessionStorage.setItem('lastLibraryParams', snapshot);
  }, [searchParams]);

  // Strip the empty `group=` param that `handleLibraryNavigation` sets as a
  // workaround for a Next.js 16.2 static-export regression (see the NOTE
  // above `handleLibraryNavigation` for full context). This effect runs
  // after the router.replace() has committed, so React has already
  // re-rendered with the new (empty) group state; we're only rewriting the
  // URL cosmetically via window.history.replaceState — Next.js' patched
  // replaceState will pick up the new canonical URL without triggering
  // another navigation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams?.get('group') !== '') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('group');
    const cleanHref = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, '', cleanHref);
  }, [searchParams]);

  // Unified navigation function that handles scroll position and direction.
  // Workaround for a Next.js 16.2 static-export regression: navigating to a
  // same-pathname URL with an empty search string causes `router.replace()`
  // to silently no-op (e.g. `/library?group=foo` -> `/library`), which broke
  // the breadcrumb "All" button. By always calling `params.set('group',
  // targetGroup)` — including when `targetGroup` is an empty string — the
  // resulting URL becomes `/library?group=` instead of `/library`, which
  // Next.js does commit. The trailing empty `group=` is stripped via a
  // cleanup effect below (purely cosmetic URL rewrite). See
  // https://github.com/readest/readest/issues/3782.
  const handleLibraryNavigation = useCallback(
    (targetGroup: string, shelfId?: string) => {
      const params = new URLSearchParams(window.location.search);
      const currentGroup = params.get('group') || '';

      // Save current scroll position BEFORE navigation
      saveScrollPosition(currentGroup);

      // Detect and set navigation direction
      const direction = currentGroup && !targetGroup ? 'back' : 'forward';
      document.documentElement.setAttribute('data-nav-direction', direction);

      // Build query params — always `set` so the search string is non-empty
      // even when targetGroup is '' (the Next.js 16.2 workaround).
      params.set('group', targetGroup);
      if (!targetGroup) params.delete('shelf');
      else if (shelfId) params.set('shelf', shelfId);

      navigateToLibrary(router, `${params.toString()}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );

  const handleBackUpOneGroupLevel = () => {
    if (!currentGroupPath) return;
    const segments = currentGroupPath.split('/');
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
    const parentGroupId = parentPath ? getGroupId(parentPath) || '' : '';
    setIsSelectAll(false);
    setIsSelectNone(false);
    handleLibraryNavigation(parentGroupId);
  };

  const handleBackUpOneGroupLevelRef = useRef(handleBackUpOneGroupLevel);
  handleBackUpOneGroupLevelRef.current = handleBackUpOneGroupLevel;
  const triggerBackUpOneGroupLevel = useCallback(() => handleBackUpOneGroupLevelRef.current(), []);

  useKeyDownActions({
    onCancel: triggerBackUpOneGroupLevel,
    enabled: !!appService?.isAndroidApp && !!currentGroupPath,
  });

  const handleImportBookFiles = useCallback(async (event: CustomEvent) => {
    const selectedFiles: SelectedFile[] = event.detail.files;
    const groupId: string = event.detail.groupId || '';
    if (selectedFiles.length === 0) return;
    await importBooks(selectedFiles, groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    eventDispatcher.on('import-book-files', handleImportBookFiles);
    return () => {
      eventDispatcher.off('import-book-files', handleImportBookFiles);
    };
  }, [handleImportBookFiles]);

  useEffect(() => {
    if (!libraryBooks.some((book) => !book.deletedAt)) {
      handleSetSelectMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryBooks]);

  const handleShowFeeds = () => {
    setShowAddFeed(true);
  };

  const handleAddFeedSubmit = async (url: string) => {
    const parsed = await fetchAndParseFeed(url);
    const book = createFeedBook(url, parsed);
    if (appService) {
      book.coverImageUrl = await ensureFeedBookCover(appService, book);
    }
    await useLibraryStore.getState().updateBooks(envConfig, [book]);
    eventDispatcher.dispatch('toast', {
      type: 'success',
      message: _('Subscribed to "{{title}}"', { title: book.title }),
      timeout: 3000,
    });
  };

  const libraryInitKey = (() => {
    const params = new URLSearchParams(searchParams?.toString());
    for (const key of ['q', 'search', 'mode', 'matchCase', 'matchDiacritics', 'nearby']) {
      params.delete(key);
    }
    return params.toString();
  })();

  useEffect(() => {
    if (pendingNavigationBookIds) {
      const bookIds = pendingNavigationBookIds;
      setPendingNavigationBookIds(null);
      if (bookIds.length > 0) {
        navigateToReader(router, bookIds);
      }
    }
  }, [pendingNavigationBookIds, appService, router]);

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const initLogin = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      if (token && user) {
        if (!settings.keepLogin) {
          settings.keepLogin = true;
          setSettings(settings);
          saveSettings(envConfig, settings);
        }
      } else if (settings.keepLogin) {
        router.push('/auth');
      }
    };

    // Reuse the in-store library only when it was actually loaded from disk.
    // Gating on `length > 0` was unsafe: a transient "Open with" entry made the
    // store non-empty before any disk load, so this skipped loadLibraryBooks and
    // a later save persisted the partial library (wiping library.json).
    const hasCachedLibrary = libraryLoadedFromDisk;
    const loadingTimeout = hasCachedLibrary ? null : setTimeout(() => setLoading(true), 500);
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      setSettings(settings);

      // Reuse the library from the store when we return from the reader
      const library = hasCachedLibrary ? libraryBooks : await appService.loadLibraryBooks();
      // Skip the redundant setLibrary on the cached path: the store already
      // contains the same array reference, and a no-op set would still
      // trigger refreshGroups (O(n) MD5) and a full Bookshelf re-render.
      // The cold path may have produced a different `library` reference —
      // only then do we commit it.
      if (!hasCachedLibrary || library !== libraryBooks) {
        setLibrary(library);
      }
      setLibraryLoaded(true);
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoading(false);
    };

    // Both inits are fire-and-forget: an escaping throw must release the
    // loading state and say what actually broke.
    const recoverFromInitFailure = (error: unknown) => {
      console.error('Failed to initialize library:', error);
      setLibraryLoaded(true);
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoading(false);
      const unavailableRootDir = getInitializedAppService()?.unavailableRootDir;
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: unavailableRootDir
          ? _(
              'Cannot open the library folder "{{path}}". Reconnect it, or choose another folder in Settings.',
              { path: unavailableRootDir },
            )
          : _('Failed to load your library.'),
        timeout: 10000,
      });
    };

    initLogin().catch((error) => console.error('Failed to initialize login:', error));
    initLibrary().catch(recoverFromInitFailure);
    return () => {
      isInitiating.current = false;
    };
    // Non-search URL changes must not reinitialize on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryInitKey]);

  useEffect(() => {
    const group = searchParams?.get('group') || '';
    const groupName = getGroupName(group);
    setCurrentGroupPath(groupName);
  }, [libraryBooks, searchParams, getGroupName]);

  useEffect(() => {
    if (
      (searchParams?.toString() || '') !== new URLSearchParams(window.location.search).toString()
    ) {
      return;
    }
    const urlQuery = searchParams?.get('q') ?? '';
    if (pendingLibrarySearchQueryRef.current === urlQuery) {
      pendingLibrarySearchQueryRef.current = null;
    }
    if (pendingLibrarySearchQueryRef.current === null) setLibrarySearchQuery(urlQuery);
    const target = ['contents', 'text'].includes(searchParams?.get('search') ?? '')
      ? 'text'
      : 'books';
    const config = getLibrarySearchConfig(searchParams);
    librarySearchTargetRef.current = target;
    librarySearchConfigRef.current = config;
    setLibrarySearchTarget(target);
    setLibrarySearchConfig(config);
  }, [searchParams]);

  useEffect(() => {
    const group = searchParams?.get('group') || '';
    restoreScrollPosition(group);
  }, [searchParams, restoreScrollPosition]);

  // Track the current virtual group for the navigation header.
  useEffect(() => {
    const groupId = searchParams?.get('group') || '';
    const groupBy = getActiveBookshelfGroupBy(settings, searchParams);

    if (
      groupId &&
      (groupBy === LibraryGroupByType.Series ||
        groupBy === LibraryGroupByType.Author ||
        groupBy === LibraryGroupByType.Tag ||
        groupBy === LibraryGroupByType.Subject ||
        groupBy === LibraryGroupByType.Status)
    ) {
      // Find the group to get its name
      const allGroups = createBookGroups(
        libraryBooks.filter((b) => !b.deletedAt),
        groupBy,
      );
      const targetGroup = findGroupById(allGroups, groupId);

      if (targetGroup) {
        setCurrentVirtualGroup({
          groupBy,
          groupName: targetGroup.displayName || targetGroup.name,
          localized: targetGroup.localized,
        });
      } else {
        setCurrentVirtualGroup(null);
      }
    } else {
      setCurrentVirtualGroup(null);
    }
  }, [libraryBooks, searchParams, settings.libraryGroupBy, settings.bookshelves]);

  const importBooks = (
    files: SelectedFile[],
    groupId?: string,
    options: { silent?: boolean } = {},
  ): Promise<{ failedPaths: string[]; importedCount: number }> =>
    // Whole runs are serialized (see enqueueImportRun); the lookup index is
    // built inside the run so a queued run sees everything the previous one
    // imported.
    enqueueImportRun(() => importBooksRun(files, groupId, options));

  const importBooksRun = async (
    files: SelectedFile[],
    groupId?: string,
    options: { silent?: boolean } = {},
  ): Promise<{ failedPaths: string[]; importedCount: number }> => {
    setLoading(true);
    const { library } = useLibraryStore.getState();
    // Build the lookup index ONCE per import batch so each book lookup is
    // O(1) instead of O(n) over the existing library. importBook also keeps
    // the index updated as new books are appended, so subsequent files in
    // the same batch see the additions.
    //
    // `osPlatform` is required for the `byFilePath` arm: on case-insensitive
    // filesystems (macOS / iOS / Windows) two paths that differ only in
    // casing must hash to the same key, so the in-place fast path in
    // importBook can recognize a re-import of the same file.
    const lookupIndex = buildBookLookupIndex(library, appService?.osPlatform);
    const failedImports: Array<{ filename: string; errorMessage: string }> = [];
    const failedPaths: string[] = [];
    const successfulImports: string[] = [];

    // Cognoscimus's own Books/ prefix is resolved once at app init and persisted
    // in `settings.localBooksDir`. We hand it to `ingestFile` so the in-place
    // decision can exclude files that already live inside our managed hash
    // store WITHOUT misclassifying user-owned folders that happen to be
    // named "Books" (e.g. Baidu Netdisk's default `Books/` directory
    // directly under the user's library root).
    const appBooksPrefix: string | null =
      useSettingsStore.getState().settings.localBooksDir || null;

    // A pack expands into its books, which land in their own groups unless the
    // import already targets a group.
    const effectiveFiles: (SelectedFile & { packGroupName?: string })[] = [];
    for (const selectedFile of files) {
      const fileName = selectedFile.name || selectedFile.file?.name || selectedFile.path || '';
      if (appService && isCognoscimusPackFile(fileName)) {
        try {
          const data = selectedFile.file
            ? await selectedFile.file.arrayBuffer()
            : await appService.readFile(selectedFile.path!, 'None', 'binary');
          const pack = typeof data === 'string' ? null : await extractCollectionPack(data);
          if (pack) {
            for (const { file, groupName } of pack.books) {
              effectiveFiles.push({
                file,
                name: file.name,
                packGroupName: groupId ? undefined : groupName,
              });
            }
            continue;
          }
        } catch (err) {
          console.warn('Failed to unpack archive during import:', err);
        }
      }
      effectiveFiles.push(selectedFile);
    }

    const processFile = async (
      selectedFile: (typeof effectiveFiles)[number],
    ): Promise<Book | null> => {
      const file = selectedFile.file || selectedFile.path;
      if (!file) return null;
      if (!appService) return null;
      try {
        const { path, basePath } = selectedFile;
        // `groupId` is treated as a tri-state:
        //   - undefined  → caller didn't specify; derive grouping from
        //                  basePath (Import-from-Folder "keep" mode).
        //   - '' (empty) → caller explicitly wants the library root.
        //   - any string → caller explicitly wants that group.
        // Distinguishing '' from undefined matters for re-imports of an
        // already-known book: without it, a falsy check would silently
        // keep the existingBook's stale groupId/groupName from a prior
        // import instead of moving the book to the root.
        let { groupId: resolvedGroupId, groupName: resolvedGroupName } = resolveImportGroup(
          groupId,
          selectedFile.packGroupName,
          getGroupId,
          getGroupName,
        );
        if (resolvedGroupId === undefined && path && basePath) {
          resolvedGroupName = getFolderImportGroupName(path, basePath);
          resolvedGroupId = getGroupId(resolvedGroupName);
        }
        // Read settings from the store at call-time rather than the
        // component closure. `runFolderImport` may have just registered
        // the picked directory as an external library folder via
        // `setSettings(...)`, but React state updates don't mutate the
        // already-captured `settings` reference until the next render —
        // by the time we get here, the closure still holds the *old*
        // settings, so `shouldImportInPlace` would see an empty
        // `externalLibraryFolders` and incorrectly fall back to copy
        // mode. Pulling the latest snapshot from zustand fixes this.
        const liveSettings = useSettingsStore.getState().settings;
        const book = await ingestFile(
          {
            file,
            books: library,
            lookupIndex,
            groupId: resolvedGroupId,
            groupName: resolvedGroupName,
          },
          { appService, settings: liveSettings, isLoggedIn: !!user, appBooksPrefix },
        );
        if (!book) return null;
        successfulImports.push(book.title);
        return book;
      } catch (error) {
        const filename = typeof file === 'string' ? file : file.name;
        if (typeof file === 'string') failedPaths.push(file);
        const baseFilename = getFilename(filename);
        const errorMessage = error instanceof Error ? _(getImportErrorMessage(error.message)) : '';
        failedImports.push({ filename: baseFilename, errorMessage });
        console.error('Failed to import book:', filename, error);
        return null;
      }
    };

    // Periodically persist the library index while the run is in flight so a
    // crash/kill mid-import (#5601: WebKit resource exhaustion during bulk
    // TXT folder import) loses at most one interval of work instead of the
    // whole run — the book dirs are written per file, and index rows that
    // never reach disk are what re-imports and duplicate rows are made of.
    // Saving per book would bring back the "library.json save dominates large
    // imports" cost, hence the throttle.
    const checkpoint = createThrottledCheckpoint(async () => {
      const currentLibrary = useLibraryStore.getState().library;
      const currentAppService = await envConfig.getAppService();
      await currentAppService.saveLibraryBooks(currentLibrary);
    }, IMPORT_CHECKPOINT_INTERVAL_MS);

    // A true worker pool (not the old barrier batches of 4): a slow file no
    // longer stalls three finished siblings, and each completed book streams
    // into the store immediately so the shelf renders incrementally.
    await runWithConcurrency(effectiveFiles, IMPORT_CONCURRENCY, async (selectedFile) => {
      const book = await processFile(selectedFile);
      if (book) {
        await updateBooks(envConfig, [book], { skipSave: true });
        checkpoint.touch();
      }
    });

    // Persist whatever the last checkpoint hasn't covered.
    if (successfulImports.length > 0) {
      await checkpoint.flush();
    }

    pushLibrary();

    if (!options.silent && failedImports.length > 1) {
      setFailedImportsModal(failedImports);
    } else if (!options.silent && failedImports.length === 1) {
      const { filename, errorMessage } = failedImports[0]!;
      eventDispatcher.dispatch('toast', {
        message:
          _('Failed to import book(s): {{filenames}}', {
            filenames: listFormater(false).format([filename]),
          }) + (errorMessage ? `\n${errorMessage}` : ''),
        timeout: 5000,
        type: 'error',
      });
    }
    // Surface the success toast when books were imported. In silent (auto-import)
    // mode failures are suppressed, so show success independently of them; in
    // interactive mode keep the original behaviour (only when nothing failed).
    if (successfulImports.length > 0 && (options.silent || failedImports.length === 0)) {
      eventDispatcher.dispatch('toast', {
        message: _('Successfully imported {{count}} book(s)', {
          count: successfulImports.length,
        }),
        timeout: 2000,
        type: 'success',
      });
    }

    setLoading(false);
    return { failedPaths, importedCount: successfulImports.length };
  };

  // Queue downloads (the TransferQueuePanel path) report progress into the
  // transfer store instead of through this hook. Bookshelf reads them straight
  // from the store via `selectActiveBookDownloadProgress` and merges them with
  // this state, so `booksTransferProgress` keeps a single writer.
  const { handleBookUpload, handleBookDownload } = useBookTransferActions(
    envConfig,
    appService,
    updateBook,
    setBooksTransferProgress,
  );

  const handleBookDelete = (deleteAction: DeleteAction) => {
    return async (book: Book, syncBooks = true) => {
      const deletionMessages = {
        both: _('Book deleted: {{title}}', { title: book.title }),
        cloud: _('Deleted cloud backup of the book: {{title}}', { title: book.title }),
        local: _('Deleted local copy of the book: {{title}}', { title: book.title }),
        purge: _('Purged book data: {{title}}', { title: book.title }),
      };
      const deletionFailMessages = {
        both: _('Failed to delete book: {{title}}', { title: book.title }),
        cloud: _('Failed to delete cloud backup of the book: {{title}}', { title: book.title }),
        local: _('Failed to delete local copy of the book: {{title}}', { title: book.title }),
        purge: _('Failed to purge book data: {{title}}', { title: book.title }),
      };

      try {
        // Purge also erases the book's synced progress and notes, or the next
        // open pulls them straight back (#6532). It runs first: if the network
        // step fails, nothing irreversible has happened locally yet.
        if (deleteAction === 'purge' && user) {
          await purgeCloudBookData(book.hash);
        }

        // Handle local deletion immediately. Purge mirrors 'both' (tombstone +
        // queued cloud delete) but hands 'purge' to deleteBook, which also wipes
        // the entire Books/<hash>/ folder (config/nav/cover) — issue #4615.
        if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
          await appService?.deleteBook(book, deleteAction === 'purge' ? 'purge' : 'local');
          if (deleteAction === 'both' || deleteAction === 'purge') {
            // The tombstone also bumps `updatedAt`, so it outranks the row's
            // own older page-turn progress in the whole-row sync merge — see
            // markBookDeleted for what broke without that (#6663).
            markBookDeleted(book, Date.now(), deleteAction === 'purge');
          } else {
            // "Remove from Device Only" must never leave stale authorization
            // from an older delete/re-import cycle on the live row.
            book.fileSyncDeletionRequestedAt = null;
          }
          await updateBook(envConfig, book);
          clearBookData(book.hash);
          if (syncBooks) pushLibrary();
        }

        // Cloud deletion. The transfer queue only speaks to Cognoscimus storage, so a
        // book whose cloud copy lives on the selected third-party provider must
        // not be routed through it — it would delete nothing. 'both' / 'purge'
        // tombstoned the book above, and the file sync GCs a tombstoned book's
        // remote directory on its next run, so the removal is already covered.
        // ("Remove from Cloud Only" is not offered for those providers — see
        // BookDetailModal.)
        if (deleteAction === 'cloud' || deleteAction === 'both' || deleteAction === 'purge') {
          if (isCognoscimusCloudStorageActive(useSettingsStore.getState().settings)) {
            const transferId = transferManager.queueDelete(book, 1, true);
            if (!transferId) {
              throw new Error('Failed to queue cloud deletion');
            }
          } else {
            book.uploadedAt = null;
            await updateBook(envConfig, book);
          }
        }

        eventDispatcher.dispatch('toast', {
          type: 'info',
          timeout: 1000,
          message: deletionMessages[deleteAction],
        });
        return true;
      } catch {
        eventDispatcher.dispatch('toast', {
          message: deletionFailMessages[deleteAction],
          type: 'error',
        });
        return false;
      }
    };
  };

  const handleUpdateMetadata = (book: Book, metadata: BookMetadata, tags: string[]) =>
    saveBookMetadataEdit(envConfig, book, metadata, tags, !!user);

  const handleMetadataValueClick = (type: 'tag' | 'subject', value: string) => {
    const groupBy = type === 'tag' ? LibraryGroupByType.Tag : LibraryGroupByType.Subject;
    const targetGroup = createBookGroups(
      libraryBooks.filter((book) => !book.deletedAt),
      groupBy,
    ).find((item): item is BooksGroup => 'books' in item && item.name === value);
    if (!targetGroup) return;
    const params = new URLSearchParams(window.location.search);
    params.set('groupBy', groupBy);
    params.set('group', targetGroup.id);
    params.delete('shelf');
    params.delete('q');
    setShowDetailsBook(null);
    navigateToLibrary(router, params.toString());
  };

  const getImportTargetGroupId = () => {
    const groupBy = getActiveBookshelfGroupBy(settings, searchParams);
    return groupBy === LibraryGroupByType.Group ? searchParams?.get('group') || '' : '';
  };

  const handleImportBooksFromFiles = async () => {
    setIsSelectMode(false);
    console.log('Importing books from files...');
    selectFiles({ type: 'books', multiple: true }).then((result) => {
      if (result.files.length === 0 || result.error) return;
      importBooks(result.files, getImportTargetGroupId());
    });
  };

  const handleImportPastedText = async (file: File) => {
    setIsSelectMode(false);
    const { importedCount } = await importBooks([{ file }], getImportTargetGroupId());
    return importedCount > 0;
  };

  const handleSetSelectMode = (selectMode: boolean) => {
    setIsSelectMode(selectMode);
    setIsSelectAll(false);
    setIsSelectNone(false);
  };

  const updateLibrarySearchUrl = (target: LibrarySearchTarget, config: LibrarySearchConfig) => {
    const params = new URLSearchParams(window.location.search);
    const query = pendingLibrarySearchQueryRef.current ?? librarySearchQuery;
    if (query) params.set('q', query);
    else params.delete('q');
    if (target === 'text') params.set('search', 'text');
    else params.delete('search');
    if (config.mode !== 'contains') params.set('mode', config.mode);
    else params.delete('mode');
    if (config.matchCase) params.set('matchCase', 'true');
    else params.delete('matchCase');
    if (config.matchDiacritics) params.set('matchDiacritics', 'true');
    else params.delete('matchDiacritics');
    if (config.mode === 'nearby-words' && config.nearbyWords !== DEFAULT_NEARBY_WORDS) {
      params.set('nearby', String(config.nearbyWords));
    } else {
      params.delete('nearby');
    }
    const value = params.toString();
    window.history.replaceState(null, '', `?${value}`);
    sessionStorage.setItem('lastLibraryParams', value);
  };

  const handleSearchTargetChange = (target: LibrarySearchTarget) => {
    librarySearchTargetRef.current = target;
    setLibrarySearchTarget(target);
    debouncedSearchUrlUpdate.cancel();
    updateLibrarySearchUrl(target, librarySearchConfigRef.current);
    if (target === 'text') handleSetSelectMode(false);
  };

  // The input itself stays instant; applying the query (URL, shelf filter,
  // content scans) debounces so typing does not re-filter the library or
  // restart searches on every keystroke.
  const updateLibrarySearchUrlRef = useRef<typeof updateLibrarySearchUrl>(null!);
  updateLibrarySearchUrlRef.current = updateLibrarySearchUrl;
  const debouncedSearchUrlUpdate = React.useMemo(
    () =>
      debounce(() => {
        updateLibrarySearchUrlRef.current(
          librarySearchTargetRef.current,
          librarySearchConfigRef.current,
        );
      }, 500),
    [],
  );
  useEffect(() => () => debouncedSearchUrlUpdate.cancel(), [debouncedSearchUrlUpdate]);

  // Immediate variant for history pills and other one-shot applications.
  const handleSearchQueryApply = (query: string) => {
    debouncedSearchUrlUpdate.cancel();
    const urlQuery = new URLSearchParams(window.location.search).get('q') ?? '';
    pendingLibrarySearchQueryRef.current = query === urlQuery ? null : query;
    setLibrarySearchQuery(query);
    updateLibrarySearchUrl(librarySearchTargetRef.current, librarySearchConfigRef.current);
  };

  const handleSearchQueryChange = (query: string) => {
    const urlQuery = new URLSearchParams(window.location.search).get('q') ?? '';
    pendingLibrarySearchQueryRef.current = query === urlQuery ? null : query;
    setLibrarySearchQuery(query);
    debouncedSearchUrlUpdate();
  };

  const handleSearchConfigChange = (config: LibrarySearchConfig) => {
    librarySearchConfigRef.current = config;
    React.startTransition(() => {
      setLibrarySearchConfig(config);
    });
    debouncedSearchUrlUpdate.cancel();
    updateLibrarySearchUrl(librarySearchTargetRef.current, config);
  };

  const handleSelectAll = () => {
    setIsSelectAll(true);
    setIsSelectNone(false);
  };

  const handleDeselectAll = () => {
    setIsSelectNone(true);
    setIsSelectAll(false);
  };

  const handleShowDetailsBook = (book: Book) => {
    setShowDetailsBook(book);
  };

  const handleNavigateToPath = (path: string | undefined) => {
    const group = path ? getGroupId(path) || '' : '';
    setIsSelectAll(false);
    setIsSelectNone(false);
    handleLibraryNavigation(group);
  };

  if (!appService || !insets) {
    return <div className='full-height bg-base-200' />;
  }

  const showBookshelf = libraryLoaded || libraryBooks.length > 0;

  return (
    <div
      ref={pageRef}
      aria-label={_('Your Library')}
      className={clsx(
        'library-page text-base-content full-height flex select-none flex-col overflow-hidden',
        viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='relative top-0 z-40 w-full'
        role='banner'
        tabIndex={-1}
        aria-label={_('Library Header')}
      >
        <LibraryHeader
          isSelectMode={isSelectMode}
          isSelectAll={isSelectAll}
          onPullLibrary={pullLibrary}
          onImportBooksFromFiles={handleImportBooksFromFiles}
          onImportPastedText={() => setShowImportPastedText(true)}
          onOpenFeeds={handleShowFeeds}
          onToggleSelectMode={() => handleSetSelectMode(!isSelectMode)}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          searchQuery={librarySearchQuery}
          searchTarget={librarySearchTarget}
          searchConfig={librarySearchConfig}
          onSearchConfigChange={handleSearchConfigChange}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchTargetChange={handleSearchTargetChange}
        />
        <progress
          aria-label={_('Library Search Progress')}
          aria-hidden={librarySearchProgress != null ? 'false' : 'true'}
          className={clsx(
            'progress progress-success absolute bottom-0 left-0 right-0 h-1 translate-y-[2px] transition-opacity duration-200 sm:translate-y-[4px]',
            librarySearchProgress != null ? 'opacity-100' : 'opacity-0',
          )}
          value={librarySearchProgress ?? 0}
          max={100}
        />
        <progress
          aria-label={_('Library Sync Progress')}
          aria-hidden={isSyncing ? 'false' : 'true'}
          className={clsx(
            'progress progress-success absolute bottom-0 left-0 right-0 h-1 translate-y-[2px] transition-opacity duration-200 sm:translate-y-[4px]',
            isSyncing ? 'opacity-100' : 'opacity-0',
          )}
          value={syncProgress * 100}
          max='100'
        />
      </div>
      {(loading || isSyncing) && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {librarySearchTarget === 'text' &&
        !librarySearchQuery.trim() &&
        librarySearchHistory.length > 0 && (
          <div className='relative my-1 flex shrink-0 items-center px-4 sm:px-6'>
            <div className='no-scrollbar not-eink:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%_-_12px),transparent)] flex flex-1 gap-1.5 overflow-x-auto'>
              {librarySearchHistory.map((term) => (
                <button
                  key={term}
                  type='button'
                  onClick={() => handleSearchQueryApply(term)}
                  className='bg-base-300/45 hover:bg-base-300/70 text-base-content/70 max-w-[60%] shrink-0 whitespace-nowrap rounded-full px-3 py-0.5 text-xs'
                >
                  <p className='truncate'>{term}</p>
                </button>
              ))}
            </div>
            <button
              type='button'
              onClick={() => {
                clearLibrarySearchHistory();
                setLibrarySearchHistory([]);
              }}
              title={_('Clear search history')}
              aria-label={_('Clear search history')}
              className='text-base-content/50 hover:text-base-content/80 flex h-6 w-8 shrink-0 items-center justify-center'
            >
              <MdClose className='h-4 w-4' />
            </button>
          </div>
        )}
      {currentGroupPath && (
        <div
          className={`transition-all duration-300 ease-in-out ${
            currentGroupPath ? 'opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className='flex flex-wrap items-center gap-y-1 px-4 text-base'>
            <button
              onClick={() => handleNavigateToPath(undefined)}
              className='hover:bg-base-300 text-base-content/85 rounded-sm px-2 py-1'
            >
              {_('All')}
            </button>
            {getBreadcrumbs(currentGroupPath).map((crumb, index, array) => {
              const isLast = index === array.length - 1;
              return (
                <React.Fragment key={index}>
                  <MdChevronRight size={iconSize} className='text-neutral-content' />
                  {isLast ? (
                    <span className='truncate rounded-sm px-2 py-1'>{crumb.name}</span>
                  ) : (
                    <button
                      onClick={() => handleNavigateToPath(crumb.path)}
                      className='hover:bg-base-300 text-base-content/85 truncate rounded-sm px-2 py-1'
                    >
                      {crumb.name}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
      {currentVirtualGroup && (
        <GroupHeader
          groupBy={currentVirtualGroup.groupBy}
          groupName={currentVirtualGroup.groupName}
          localized={currentVirtualGroup.localized}
        />
      )}
      <BookshelvesDialog />
      {showBookshelf && (
        <div aria-label={_('Your Bookshelf')} className='flex min-h-0 grow flex-col'>
          <div
            ref={containerRef}
            className={clsx(
              'scroll-container drop-zone flex min-h-0 grow flex-col',
              isDragging && 'drag-over',
            )}
            style={{
              paddingRight: `${insets.right}px`,
              paddingLeft: `${insets.left}px`,
            }}
          >
            <DropIndicator />
            <Bookshelf
              libraryBooks={libraryBooks}
              isSelectMode={isSelectMode}
              isSelectAll={isSelectAll}
              isSelectNone={isSelectNone}
              onScrollerRef={handleScrollerRef}
              handleImportBooks={setImportMenuAnchor}
              handleBookUpload={handleBookUpload}
              handleBookDownload={handleBookDownload}
              handleBookDelete={handleBookDelete('both')}
              handleBookPurge={handleBookDelete('purge')}
              handleSetSelectMode={handleSetSelectMode}
              handleShowDetailsBook={handleShowDetailsBook}
              handleLibraryNavigation={handleLibraryNavigation}
              booksTransferProgress={booksTransferProgress}
              handlePushLibrary={pushLibrary}
              onSearchContents={() => handleSearchTargetChange('text')}
              onSearchProgress={setLibrarySearchProgress}
              contentSearch={
                librarySearchTarget === 'text'
                  ? { query: searchParams?.get('q') ?? '', config: librarySearchConfig }
                  : null
              }
            />
          </div>
        </div>
      )}
      {importMenuAnchor && (
        <ImportMenuPopup
          anchor={importMenuAnchor}
          onClose={() => setImportMenuAnchor(null)}
          onImportBooksFromFiles={handleImportBooksFromFiles}
          onImportPastedText={() => setShowImportPastedText(true)}
          onOpenFeeds={handleShowFeeds}
        />
      )}
      <NowPlayingBar isSelectMode={isSelectMode} />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
          handleBookUpload={handleBookUpload}
          handleBookDownload={handleBookDownload}
          handleBookDelete={handleBookDelete('both')}
          // Cognoscimus storage only. A third-party provider mirrors the library, so
          // removing just its cloud copy is not expressible: the next sync would
          // upload the still-local book straight back (#5084).
          handleBookDeleteCloudBackup={
            isCognoscimusCloudStorageActive(settings) ? handleBookDelete('cloud') : undefined
          }
          handleBookDeleteLocalCopy={handleBookDelete('local')}
          handleBookPurge={handleBookDelete('purge')}
          handleBookMetadataUpdate={handleUpdateMetadata}
          onMetadataValueClick={handleMetadataValueClick}
        />
      )}
      {isTransferQueueOpen && (
        <ModalPortal>
          <TransferQueuePanel />
        </ModalPortal>
      )}
      <AboutWindow />
      <ReadingStatsDialog />
      <KeyboardShortcutsHelp />
      <BackupWindow onPullLibrary={pullLibrary} />
      {isSettingsDialogOpen && <SettingsDialog bookKey={''} />}
      {showFeeds && <FeedsView onClose={() => setShowFeeds(false)} />}
      <AddFeedModal
        isOpen={showAddFeed}
        onClose={() => setShowAddFeed(false)}
        onSubmit={handleAddFeedSubmit}
      />
      {failedImportsModal && (
        <FailedImportsDialog
          failedImports={failedImportsModal}
          onClose={() => setFailedImportsModal(null)}
        />
      )}
      <ImportPastedTextDialog
        isOpen={showImportPastedText}
        onClose={() => setShowImportPastedText(false)}
        onImport={handleImportPastedText}
      />
      <Toast />
    </div>
  );
};

const LibraryPage = () => {
  return (
    <Suspense fallback={<div className='full-height' />}>
      <LibraryPageWithSearchParams />
    </Suspense>
  );
};

export default LibraryPage;
