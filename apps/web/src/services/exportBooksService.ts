import type { ZipWriter } from '@zip.js/zip.js';
import { EXTS } from '@/libs/document';
import {
  CLOUD_BATCH,
  canStreamBackup,
  fetchCloudFile,
  streamZipToFile,
  throwIfAborted,
} from '@/services/backupService';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { getBookBinaryData } from '@/services/pack/packService';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { getLocalBookFilename, getRemoteBookFilename } from '@/utils/book';
import { makeSafeFilename } from '@/utils/misc';
import { configureZip } from '@/utils/zip';

export interface ExportSummary {
  saved: number;
  /** Titles of books whose file could be read neither here nor from the cloud. */
  skipped: string[];
}

export interface ExportExtras {
  signal?: AbortSignal;
  onSummary?: (summary: ExportSummary) => void;
}

export type ExportProgress = (current: number, total: number, title: string) => void;

/**
 * File names for the books in the archive: the current title, which is the
 * master, plus the extension. Equal names get " (2)", " (3)", ... so none
 * overwrites another.
 */
export const uniqueBookFilenames = (books: Book[]): string[] => {
  const used = new Set<string>();
  return books.map((book) => {
    const stem = makeSafeFilename(book.title || book.sourceTitle || book.hash);
    const ext = EXTS[book.format];
    let name = `${stem}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n}).${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
};

/**
 * Adds the books' files to the zip, flat, named after their titles. A book that
 * is on this device is read from there, any other is fetched from the cloud.
 */
export async function addBooksToZip(
  writer: ZipWriter<unknown>,
  appService: AppService,
  books: Book[],
  onProgress?: ExportProgress,
  extras: ExportExtras = {},
): Promise<ExportSummary> {
  const { Uint8ArrayReader } = await import('@zip.js/zip.js');
  const { batchGetDownloadUrls } = await import('@/libs/storage');
  const refresh = async (file: { lfp: string; cfp: string }) =>
    (await batchGetDownloadUrls([file]))[0]?.downloadUrl;

  // Books shared with this account are not the user's to copy out.
  const own = books.filter((book) => !book.grant);
  const names = uniqueBookFilenames(own);
  const summary: ExportSummary = { saved: 0, skipped: [] };

  for (let start = 0; start < own.length; start += CLOUD_BATCH) {
    throwIfAborted(extras.signal);
    const batch = own.slice(start, start + CLOUD_BATCH);
    // Addresses for the whole batch at once, only for books with a cloud copy and
    // no file on this device.
    const cloud: Book[] = [];
    for (const book of batch) {
      if (book.uploadedAt && !(await appService.exists(getLocalBookFilename(book), 'Books'))) {
        cloud.push(book);
      }
    }
    const urls = new Map<string, { lfp: string; cfp: string; downloadUrl?: string }>();
    if (cloud.length > 0) {
      const wanted = cloud.map((book) => ({
        lfp: getLocalBookFilename(book),
        cfp: `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`,
      }));
      try {
        for (const file of await batchGetDownloadUrls(wanted)) urls.set(file.lfp, file);
      } catch (error) {
        console.warn('Could not get download addresses:', error);
      }
    }

    for (let i = 0; i < batch.length; i++) {
      throwIfAborted(extras.signal);
      const book = batch[i]!;
      onProgress?.(start + i + 1, own.length, book.title);
      let data: Uint8Array | null = null;
      const local = await getBookBinaryData(book, appService);
      if (local) {
        data = local.data;
      } else {
        const file = urls.get(getLocalBookFilename(book));
        data = file ? await fetchCloudFile(file, refresh).catch(() => null) : null;
      }
      if (!data) {
        summary.skipped.push(book.title);
        continue;
      }
      await writer.add(names[start + i]!, new Uint8ArrayReader(data), { level: 0 });
      summary.saved++;
    }
  }

  extras.onSummary?.(summary);
  return summary;
}

/**
 * Saves the books as one zip. Streams straight to a file where the browser
 * allows it; otherwise the whole archive is built in memory. Returns false when
 * the save dialog was dismissed.
 */
export async function exportBooksAsZip(
  appService: AppService,
  books: Book[],
  filename: string,
  onProgress?: ExportProgress,
  extras: ExportExtras = {},
): Promise<boolean> {
  if (canStreamBackup()) {
    return streamZipToFile(filename, async (writer) => {
      await addBooksToZip(writer, appService, books, onProgress, extras);
    });
  }
  await configureZip();
  const { BlobWriter, ZipWriter } = await import('@zip.js/zip.js');
  const blobWriter = new BlobWriter('application/zip');
  const writer = new ZipWriter(blobWriter);
  await addBooksToZip(writer, appService, books, onProgress, extras);
  await writer.close();
  const blob = await blobWriter.getData();
  return appService.saveFile(filename, await blob.arrayBuffer(), { mimeType: 'application/zip' });
}
