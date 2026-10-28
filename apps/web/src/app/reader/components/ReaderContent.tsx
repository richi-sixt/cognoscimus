'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { flushPendingLibrarySave, useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useGamepad } from '@/hooks/useGamepad';
import { useTranslation } from '@/hooks/useTranslation';
import { SystemSettings } from '@/types/settings';
import { uniqueId } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { transitionAway } from '@/utils/viewTransition';
import { navigateToLibrary } from '@/utils/nav';
import { getLockedPanX } from '../utils/lockedPan';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';
import { saveBookMetadataEdit } from '@/services/bookMetadataEdit';
import { BookDetailModal } from '@/components/metadata';
import ShareBookDialog from '@/app/library/components/ShareBookDialog';
import { useAuth } from '@/context/AuthContext';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { canTransitionWithNotebookRecovery } from '../services/notebookDocumentCoordinator';
import {
  discardNotebookDocument,
  flushNotebookDocument,
} from '../hooks/useNotebookDocumentCoordinator';
import { writeTextToClipboard } from '@/utils/clipboard';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import Spinner from '@/components/Spinner';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';
import SettingsDialog from '@/components/settings/SettingsDialog';
import AudiobookPairingDialog from './audiobook/AudiobookPairingDialog';
import ModalPortal from '@/components/ModalPortal';
import NotebookTransitionAlert from './notebook/NotebookTransitionAlert';

// The library has mounted. Its shelf rows can't be awaited: the virtual list
// measures before placing rows, and nothing is measured while the transition
// holds the old page on screen. The app may also serve the library at `/`.
const libraryArrived = () => !!document.querySelector('.bookshelf');

const ReaderContent: React.FC<{ ids?: string; settings: SystemSettings }> = ({ ids, settings }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { bookKeys, dismissBook, getNextBookKey } = useBooksManager();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { saveSettings } = useSettingsStore();
  const { getConfig, setConfig, getBookData, saveConfig } = useBookDataStore();
  const { getView, setBookKeys, getViewSettings } = useReaderStore();
  const { initViewState, getViewState, clearViewState } = useReaderStore();
  const { isSettingsDialogOpen, settingsDialogBookKey } = useSettingsStore();
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [audiobookBookKey, setAudiobookBookKey] = useState<string | null>(null);
  const [shareDialogState, setShareDialogState] = useState<{
    book: Book;
    cfi: string | null;
  } | null>(null);
  const { user } = useAuth();
  const isInitiating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);
  const [blockedNotebookBookKey, setBlockedNotebookBookKey] = useState<string | null>(null);
  const pendingNotebookTransitionRef = useRef<(() => Promise<void>) | null>(null);

  useBookShortcuts({ sideBarBookKey, bookKeys });
  // Settings > Behavior > Device > Gamepad Support. Off when the device's own
  // remapper already binds the controller to keys (issue #5979).
  const gamepadEnabled = useSettingsStore((state) => state.settings.gamepadEnabled) !== false;
  useGamepad({ enabled: appService !== null && gamepadEnabled });

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const pathname = window.location.pathname;
    const bookIds = ids || searchParams?.get('ids') || pathname.split('/reader/')[1] || '';
    const requestedIds = bookIds.split(BOOK_IDS_SEPARATOR).filter(Boolean);

    const initialIds = requestedIds;
    // Back from a page opened over the reader, e.g. the account page (#6607):
    // the books are still open, so show them again instead of loading anew.
    if (useReaderStore.getState().areBooksOpen(initialIds)) return;
    const initialBookKeys = initialIds.map((id) => `${id}-${uniqueId()}`);
    setBookKeys(initialBookKeys);
    const uniqueIds = new Set<string>();
    console.log('Initialize books', initialBookKeys);
    initialBookKeys.forEach((key, index) => {
      const id = key.split('-')[0]!;
      const isPrimary = !uniqueIds.has(id);
      uniqueIds.add(id);
      if (!getViewState(key)) {
        initViewState(envConfig, id, key, isPrimary).catch((error) => {
          console.log('Error initializing book', key, error);
          setErrorLoading(true);
          eventDispatcher.dispatch('toast', {
            message: _('Unable to open book'),
            callback: () => navigateToLibrary(router, '', undefined, true),
            timeout: 2000,
            type: 'error',
          });
        });
        if (index === 0) setSideBarBookKey(key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleManageAudiobook = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string } | undefined;
      if (detail?.bookKey) setAudiobookBookKey(detail.bookKey);
    };
    eventDispatcher.on('manage-audiobook', handleManageAudiobook);
    return () => {
      eventDispatcher.off('manage-audiobook', handleManageAudiobook);
    };
  }, []);

  useEffect(() => {
    const handleShowBookDetails = (event: CustomEvent) => {
      setShowDetailsBook(event.detail as Book);
      return true;
    };
    eventDispatcher.onSync('show-book-details', handleShowBookDetails);

    return () => {
      eventDispatcher.offSync('show-book-details', handleShowBookDetails);
    };
  }, []);

  useEffect(() => {
    const handleShareIntent = (event: CustomEvent) => {
      const detail = event.detail as { book: Book; cfi?: string | null } | undefined;
      if (!detail?.book || detail.book.grant) return;
      if (!user) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Sign in to share books'),
          timeout: 2500,
        });
        return;
      }
      setShareDialogState({
        book: detail.book,
        cfi: detail.cfi ?? null,
      });
    };
    eventDispatcher.on('show-share-dialog', handleShareIntent);
    return () => {
      eventDispatcher.off('show-share-dialog', handleShareIntent);
    };
  }, [user, _]);

  useEffect(() => {
    if (bookKeys && bookKeys.length > 0) {
      const settings = useSettingsStore.getState().settings;
      const lastOpenBooks = bookKeys.map((key) => key.split('-')[0]!);
      if (settings.lastOpenBooks?.toString() !== lastOpenBooks.toString()) {
        settings.lastOpenBooks = lastOpenBooks;
        saveSettings(envConfig, settings);
      }
    }

    window.addEventListener('beforeunload', handleCloseBooks);
    eventDispatcher.on('beforereload', handleCloseBooks);
    eventDispatcher.on('close-reader', handleCloseReaderToLibrary);
    eventDispatcher.on('quit-app', handleCloseBooks);
    return () => {
      window.removeEventListener('beforeunload', handleCloseBooks);
      eventDispatcher.off('beforereload', handleCloseBooks);
      eventDispatcher.off('close-reader', handleCloseReaderToLibrary);
      eventDispatcher.off('quit-app', handleCloseBooks);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys]);

  const saveBookConfig = async (bookKey: string) => {
    const config = getConfig(bookKey);
    const { book } = getBookData(bookKey) || {};
    const { isPrimary } = getViewState(bookKey) || {};
    if (isPrimary && book && config) {
      const settings = useSettingsStore.getState().settings;
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
      // Persist locally before any remote flush. `beforeunload` and `quit-app`
      // can unload the document while a flush is still in flight.
      await saveConfig(envConfig, bookKey, config, settings);
      // saveConfig defers the library.json write by up to 30s, and closing the
      // last window quits the app on Windows/Linux before it lands: the shelf
      // then shows the old progress on the next launch (#6623).
      await flushPendingLibrarySave();
    }
  };

  const saveConfigAndCloseBook = async (bookKey: string, keepTTSAlive = false) => {
    console.log('Closing book', bookKey);

    const viewState = getViewState(bookKey);

    // Read before close() tears the pages down: a pan made since the last
    // page turn hasn't reached the config yet. Primary only, like the location.
    const panX = getLockedPanX(getView(bookKey), getViewSettings(bookKey));
    if (viewState?.isPrimary && panX !== undefined) setConfig(bookKey, { panX });
    try {
      getView(bookKey)?.close();
      getView(bookKey)?.remove();
    } catch {
      console.info('Error closing book', bookKey);
    }
    // Closes that keep the webview alive (back to library, Android back, pane
    // dismiss) let a live TTS session continue in the background;
    // webview-destroying closes (quit, window close, reload) hard-stop so the
    // media session and Android foreground service tear down with the page.
    eventDispatcher.dispatch(keepTTSAlive ? 'tts-close-book' : 'tts-stop', {
      bookKey,
    });
    await saveBookConfig(bookKey);
    clearViewState(bookKey);
  };

  const navigateBackToLibrary = () => {
    navigateToLibrary(router, '', undefined, true);
  };

  // Closing tears the book down before the library mounts, which flashed a
  // blank reader and an empty shelf. Capture the open book first so the
  // library slides in over it once its shelves are drawn.
  const leaveToLibrary = (leave: () => Promise<void>) =>
    appService?.supportsViewTransitionsAPI
      ? transitionAway(leave, libraryArrived, 'back')
      : leave();

  const saveSettingsAndGoToLibrary = () => {
    saveSettings(envConfig, settings);
    navigateBackToLibrary();
  };

  const runNotebookTransition = async (
    keys: string[],
    transition: () => Promise<void>,
  ): Promise<boolean> => {
    for (const key of keys) {
      await flushNotebookDocument(key);
      const bookHash = key.split('-')[0]!;
      if (!canTransitionWithNotebookRecovery(bookHash)) {
        pendingNotebookTransitionRef.current = async () => {
          await runNotebookTransition(keys, transition);
        };
        setBlockedNotebookBookKey(key);
        return false;
      }
    }
    pendingNotebookTransitionRef.current = null;
    setBlockedNotebookBookKey(null);
    await transition();
    return true;
  };

  const closeBooks = async (keepTTSAlive: boolean) => {
    const currentSettings = useSettingsStore.getState().settings;
    await Promise.all(bookKeys.map((key) => saveConfigAndCloseBook(key, keepTTSAlive)));
    await saveSettings(envConfig, currentSettings);
  };

  const handleCloseReaderToLibrary = async (event: CustomEvent): Promise<void> => {
    const onClose = (event.detail as { onClose?: () => void } | undefined)?.onClose;
    await runNotebookTransition(bookKeys, async () => {
      const close = async () => {
        await closeBooks(true);
        onClose?.();
      };
      await (onClose ? leaveToLibrary(close) : close());
    });
  };

  // Also wired directly to beforeunload/quit-app/window-close, which pass an
  // event object: only a literal `true` keeps TTS alive. Returns the close so
  // the window-close and quit paths can await it before the app exits; a
  // trigger that arrives mid-close joins the one already running.
  const closingBooksRef = useRef<Promise<void> | null>(null);
  const handleCloseBooks = (keepTTSAlive?: unknown) => {
    closingBooksRef.current ??= runNotebookTransition(bookKeys, () =>
      closeBooks(keepTTSAlive === true),
    )
      .then(() => {})
      .finally(() => {
        closingBooksRef.current = null;
      });
    return closingBooksRef.current;
  };

  const handleCloseBooksToLibrary = async () => {
    // SPA navigation keeps the page alive: TTS may continue headless.
    await runNotebookTransition(bookKeys, async () => {
      await leaveToLibrary(async () => {
        await closeBooks(true);
        navigateBackToLibrary();
      });
    });
  };

  const handleCloseBook = async (bookKey: string) => {
    // Header X / pane close: an SPA-side close.
    const closeBook = async () => {
      await saveConfigAndCloseBook(bookKey, true);
      if (sideBarBookKey === bookKey) {
        setSideBarBookKey(getNextBookKey(sideBarBookKey));
      }
      dismissBook(bookKey);
    };
    await runNotebookTransition([bookKey], async () => {
      const isLastBook = bookKeys.every((key) => key === bookKey);
      // Closing the last book always returns to the library.
      if (isLastBook) {
        await leaveToLibrary(async () => {
          await closeBook();
          saveSettingsAndGoToLibrary();
        });
        return;
      }
      await closeBook();
    });
  };

  if (!bookKeys || bookKeys.length === 0) return null;
  const bookData = getBookData(bookKeys[0]!);
  const viewSettings = getViewSettings(bookKeys[0]!);
  if (!bookData || !bookData.book || !bookData.bookDoc || !viewSettings) {
    setTimeout(() => setLoading(true), 200);
    return (
      loading &&
      !errorLoading && (
        <div className='hero hero-content full-height'>
          <Spinner loading={true} />
        </div>
      )
    );
  }

  return (
    <div className='reader-content full-height flex'>
      <SideBar />
      <BooksGrid
        bookKeys={bookKeys}
        onCloseBook={handleCloseBook}
        onGoToLibrary={handleCloseBooksToLibrary}
      />
      {isSettingsDialogOpen && <SettingsDialog bookKey={settingsDialogBookKey} />}
      {audiobookBookKey && getBookData(audiobookBookKey)?.bookDoc && (
        <AudiobookPairingDialog
          bookKey={audiobookBookKey}
          bookDoc={getBookData(audiobookBookKey)!.bookDoc!}
          onClose={() => setAudiobookBookKey(null)}
        />
      )}
      <Notebook />
      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
          handleBookMetadataUpdate={(book, metadata, tags) =>
            saveBookMetadataEdit(envConfig, book, metadata, tags, !!user)
          }
        />
      )}
      <ShareBookDialog
        isOpen={!!shareDialogState}
        book={shareDialogState?.book ?? null}
        onClose={() => setShareDialogState(null)}
      />
      {blockedNotebookBookKey && (
        <ModalPortal>
          <NotebookTransitionAlert
            onKeepOpen={() => {
              pendingNotebookTransitionRef.current = null;
              setBlockedNotebookBookKey(null);
            }}
            onCopy={() => {
              const bookHash = blockedNotebookBookKey.split('-')[0]!;
              const content = useNotebookDocumentStore.getState().sessions[bookHash]?.content ?? '';
              void writeTextToClipboard(content);
              eventDispatcher.dispatch('toast', {
                type: 'info',
                message: _('Notebook draft copied to clipboard'),
                timeout: 2000,
              });
            }}
            onDiscard={() => {
              const pending = pendingNotebookTransitionRef.current;
              discardNotebookDocument(blockedNotebookBookKey);
              setBlockedNotebookBookKey(null);
              if (pending) void pending();
            }}
            onRetry={() => {
              const pending = pendingNotebookTransitionRef.current;
              if (pending) void pending();
            }}
          />
        </ModalPortal>
      )}
    </div>
  );
};

export default ReaderContent;
