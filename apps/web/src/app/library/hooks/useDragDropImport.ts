import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import { SelectedFile } from '@/hooks/useFileSelector';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { LibraryGroupByType } from '@/types/settings';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';
import { BOOK_ACCEPT_FORMATS, SUPPORTED_BOOK_EXTS } from '@/services/constants';
import { hasAllowedExtension } from '@/hooks/useFileSelector';
import { useSearchParams } from 'next/navigation';

const hasSupportedBookExt = (name: string) => {
  return hasAllowedExtension(name, SUPPORTED_BOOK_EXTS);
};

const itemName = (item: File) => item.name;

export const useDragDropImport = () => {
  const _ = useTranslation();
  const searchParams = useSearchParams();
  const { settings } = useSettingsStore();
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const group = groupBy === LibraryGroupByType.Group ? searchParams?.get('group') || '' : '';

  const { appService } = useEnv();
  const [isDragging, setIsDragging] = useState(false);

  const handleDroppedFiles = async (fileItems: File[]) => {
    if (fileItems.length === 0 || !appService) return;

    const supportedItems = fileItems.filter((item) => hasSupportedBookExt(itemName(item)));
    const skippedItems = fileItems.filter((item) => !hasSupportedBookExt(itemName(item)));

    const fileSelections: SelectedFile[] = supportedItems.map((item) => ({ file: item }));

    if (fileSelections.length === 0) {
      eventDispatcher.dispatch('toast', {
        message: _('No supported files found. Supported formats: {{formats}}', {
          formats: BOOK_ACCEPT_FORMATS,
        }),
        type: 'error',
      });
      return;
    }

    // A mixed drop must not make the whitelist-dropped files vanish without a
    // trace while the rest imports — the picker path names them for the same
    // reason (#5959). An all-unsupported drop is answered above with the
    // supported-format list instead.
    if (skippedItems.length > 0) {
      const filenames = skippedItems.map(itemName).join(', ');
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to import book(s): {{filenames}}', {
          filenames,
        }),
        timeout: 5000,
      });
    }

    eventDispatcher.dispatch('import-book-files', {
      files: fileSelections,
      groupId: group,
    });
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement> | DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement> | DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement> | DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const files = Array.from(event.dataTransfer.files);
      handleDroppedFiles(files);
    }
  };

  useEffect(() => {
    const libraryPage = document.querySelector('.library-page');
    if (!appService?.isMobile) {
      libraryPage?.addEventListener('dragover', handleDragOver as unknown as EventListener);
      libraryPage?.addEventListener('dragleave', handleDragLeave as unknown as EventListener);
      libraryPage?.addEventListener('drop', handleDrop as unknown as EventListener);
    }

    return () => {
      if (!appService?.isMobile) {
        libraryPage?.removeEventListener('dragover', handleDragOver as unknown as EventListener);
        libraryPage?.removeEventListener('dragleave', handleDragLeave as unknown as EventListener);
        libraryPage?.removeEventListener('drop', handleDrop as unknown as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  return { isDragging };
};
