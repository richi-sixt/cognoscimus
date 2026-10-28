import { AppService } from '@/types/system';
import { stubTranslation as _ } from '@/utils/misc';
import { getFileExtension } from '@/utils/path';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { BOOK_ACCEPT_FORMATS, SUPPORTED_BOOK_EXTS } from '@/services/constants';

export interface FileSelectorOptions {
  type: SelectionType;
  accept?: string;
  multiple?: boolean;
  extensions?: string[];
  dialogTitle?: string;
}

export interface SelectedFile {
  file?: File;

  // Path of a file on disk, with the folder it was found under.
  path?: string;
  basePath?: string;

  // Resolved display name (with extension).
  name?: string;
}

export interface FileSelectionResult {
  files: SelectedFile[];
  error?: string;
}

/**
 * Whether `filename` is one of `extensions` (lowercase, no leading dot), with
 * `'*'` accepting anything. Tolerates the duplicate-download marker some
 * browsers append after the extension, e.g. `book.epub (1)` (issue #5959).
 */
export const hasAllowedExtension = (filename: string | undefined, extensions: string[]) =>
  extensions.includes('*') || extensions.includes(getFileExtension(filename || ''));

const selectFileWeb = (options: FileSelectorOptions): Promise<File[]> => {
  return new Promise((resolve) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = options.accept || '*/*';
    fileInput.multiple = options.multiple || false;
    fileInput.click();

    fileInput.onchange = () => {
      resolve(Array.from(fileInput.files || []));
    };
  });
};

const processWebFiles = (files: File[]): SelectedFile[] => {
  return files.map((file) => ({
    file,
  }));
};

export const useFileSelector = (appService: AppService | null, _: TranslationFunc) => {
  const selectFiles = async (options: FileSelectorOptions = { type: 'generic' }) => {
    options = { ...FILE_SELECTION_PRESETS[options.type], ...options };
    if (!appService) {
      return { files: [] as SelectedFile[], error: 'App service is not available' };
    }
    try {
      const webFiles = await selectFileWeb(options);
      const files = processWebFiles(webFiles);
      return { files };
    } catch (error) {
      return {
        files: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  };
  return {
    selectFiles,
  };
};

export const FILE_SELECTION_PRESETS = {
  generic: {
    accept: '*/*',
    extensions: ['*'],
    dialogTitle: _('Select Files'),
  },
  images: {
    accept: 'image/*',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
    dialogTitle: _('Select Image'),
  },
  videos: {
    accept: 'video/*',
    extensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
    dialogTitle: _('Select Video'),
  },
  audio: {
    accept: 'audio/*,.m4b',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'm4b'],
    dialogTitle: _('Select Audio'),
  },
  books: {
    accept: BOOK_ACCEPT_FORMATS,
    extensions: SUPPORTED_BOOK_EXTS,
    dialogTitle: _('Select Books'),
  },
  fonts: {
    accept: '.ttf, .otf, .woff, .woff2',
    extensions: ['ttf', 'otf', 'woff', 'woff2'],
    dialogTitle: _('Select Fonts'),
  },
  dictionaries: {
    accept: '.mdx, .mdd, .ifo, .idx, .dict, .dz, .syn, .index, .slob, .bgl, .css, .zip, .rdict',
    extensions: [
      'mdx',
      'mdd',
      'ifo',
      'idx',
      'dict',
      'dz',
      'syn',
      'index',
      'slob',
      'bgl',
      'css',
      'zip',
      'rdict',
    ],
    dialogTitle: _('Select Dictionary Files'),
  },
  covers: {
    accept: '.png, .jpg, .jpeg, .gif',
    extensions: ['png', 'jpg', 'jpeg', 'gif'],
    dialogTitle: _('Select Image'),
  },
};

export type SelectionType = keyof typeof FILE_SELECTION_PRESETS;
