import { mergeBookshelfStates } from '@/services/bookshelves/state';
import type { Configuration, FileEntry, ZipWriter } from '@zip.js/zip.js';
import { AppService, FileItem } from '@/types/system';
import { EXTS } from '@/libs/document';
import { Book, BookConfig, BookNote } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import type { PageStatEvent, StatBook } from '@/types/statistics';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  getBackupBookFilename,
  getBookDirOfPath,
  getCoverFilename,
  getLibraryFilename,
  getLocalBookFilename,
  getRemoteBookFilename,
  isBookFile,
} from '@/utils/book';
import { CLOUD_BOOKS_SUBDIR } from '@/services/constants';
import { stampBookConfigSchema } from '@/utils/serializer';
import { transformBookConfigFromDB, transformBookNoteFromDB } from '@/utils/transform';
import type { DBBookConfig, DBBookNote } from '@/types/records';
import { configureZip } from '@/utils/zip';

/** Book file extensions for identifying book files in backup directories. */
const BOOK_EXTS = new Set(Object.values(EXTS));

/** Root-level zip entry name for the backed-up global settings snapshot. */
export const SETTINGS_BACKUP_FILENAME = 'settings.json';

/** Root-level zip entry name for the reading statistics (#6488). */
export const STATISTICS_BACKUP_FILENAME = 'statistics.json';

/**
 * Options controlling what a backup zip includes.
 */
export interface BackupOptions {
  /**
   * Include account credentials (sync tokens, passwords, API keys) in the
   * settings snapshot. The backup zip is unencrypted, so this is opt-in and
   * defaults to false.
   */
  includeCredentials?: boolean;
  /**
   * Also fetch the files of books that live only in the cloud and put them in
   * the archive, one at a time, without storing them on this device. Books with
   * no config.json on this device also get their reading position and notes
   * from the server, so nothing a cloud-only book holds is left out.
   */
  includeCloudBooks?: boolean;
}

/** What a backup run ended up with, for the summary the user sees. */
export interface BackupSummary {
  /** Files written from this device. */
  files: number;
  /** Books whose files came from the cloud. */
  cloudBooks: number;
  /** Cloud books that could not be fetched, by title. */
  skipped: string[];
  /** Books whose reading position or notes came from the server. */
  configs: number;
  /** The server's positions and notes could not be read. */
  configsFailed: boolean;
}

export interface BackupExtras {
  signal?: AbortSignal;
  onSummary?: (summary: BackupSummary) => void;
}

/**
 * SystemSettings dot-paths excluded from backups. Each is either tied to
 * this device (and meaningless to restore elsewhere) or sync/migration
 * bookkeeping that would corrupt state if restored stale. Restore keeps
 * the current device's value for every path here — see issue #4098.
 */
export const BACKUP_SETTINGS_BLACKLIST = [
  // Device filesystem paths — invalid on another device / OS.
  'localBooksDir',
  'customRootDir',
  'externalLibraryFolders',
  'autoImportFolders',
  'autoImportFlattenFolders',
  'savedBookCoverForLockScreenPath',
  // Per-device identity — restoring causes sync identity / HLC collisions.
  'replicaDeviceId',
  // Sync cursors — stale values make sync skip pulls or re-push everything.
  'lastSyncedAtBooks',
  'lastSyncedAtConfigs',
  'lastSyncedAtNotes',
  'lastSyncedAtReplicas',
  'googleDrive.deviceId',
  'googleDrive.lastSyncedAt',
  'webdav.deviceId',
  'webdav.lastSyncedAt',
  'webdav.providerSelectedAt',
  'googleDrive.providerSelectedAt',
  'onedrive.deviceId',
  'onedrive.lastSyncedAt',
  'onedrive.providerSelectedAt',
  's3.deviceId',
  's3.lastSyncedAt',
  's3.providerSelectedAt',
  'icloud.deviceId',
  'icloud.lastSyncedAt',
  'icloud.providerSelectedAt',
  'cognoscimusCloud.disabledAt',
  // Transient runtime state — book keys may not exist post-restore; screen
  // brightness is live device state.
  'lastOpenBooks',
  'screenBrightness',
  // Schema versioning — restore keeps the current device's value so its
  // migrations are not skipped.
  'version',
  'migrationVersion',
] as const;

/**
 * Credential dot-paths stripped from backups unless `includeCredentials`
 * is set. Custom translator and custom TTS credentials live inside the
 * `customTranslators` / `customTTSServices` arrays and are handled separately in
 * `sanitizeSettingsForBackup`.
 */
export const BACKUP_SETTINGS_CREDENTIAL_FIELDS = [
  // S3 access keys are strong, long-lived cloud credentials — strip them from
  // unencrypted backup zips unless the user opts into including credentials.
  's3.accessKeyId',
  's3.secretAccessKey',
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Delete a dot-path key from a deep object; no-op when the path is absent. */
const deletePath = (obj: Record<string, unknown>, path: string): void => {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]!];
    if (!isPlainObject(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]!];
};

/**
 * Produce a copy of SystemSettings safe to write into a backup zip:
 * strips device-specific / sync-bookkeeping fields always, and account
 * credentials unless `includeCredentials` is set. Input is not mutated.
 */
export function sanitizeSettingsForBackup(
  settings: SystemSettings,
  options: BackupOptions = {},
): SystemSettings {
  const clone = structuredClone(settings) as SystemSettings & Record<string, unknown>;
  if (clone.bookshelves) {
    clone.bookshelves = structuredClone(mergeBookshelfStates(clone.bookshelves));
    // A portable snapshot must not depend on this device's anonymous journal.
    for (const row of Object.values(clone.bookshelves.rows)) delete row.localOnly;
  }
  for (const path of BACKUP_SETTINGS_BLACKLIST) {
    deletePath(clone, path);
  }
  if (!options.includeCredentials) {
    for (const path of BACKUP_SETTINGS_CREDENTIAL_FIELDS) {
      deletePath(clone, path);
    }
    if (Array.isArray(clone.customTranslators)) {
      clone.customTranslators = clone.customTranslators.map((translator) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { apiKey: _apiKey, ...rest } = translator;
        return rest;
      });
    }
    if (Array.isArray(clone.customTTSServices)) {
      clone.customTTSServices = clone.customTTSServices.map((service) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { apiKey: _apiKey, ...rest } = service;
        return rest;
      });
    }
  }
  return clone;
}

/** Recursively merge `source` onto `target`; objects merge, scalars/arrays replace. */
const deepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Merge a restored settings snapshot onto the current device settings.
 * Blacklisted fields are absent from the snapshot, so the current
 * device's values for them are preserved. Neither input is mutated.
 */
export function mergeRestoredSettings(
  current: SystemSettings,
  backup: Partial<SystemSettings>,
): SystemSettings {
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    backup as unknown as Record<string, unknown>,
  ) as unknown as SystemSettings;
  if (current.bookshelves || backup.bookshelves)
    merged.bookshelves = mergeBookshelfStates(current.bookshelves, backup.bookshelves);
  return merged;
}

/**
 * Merge two BookConfigs: uses the config with higher reading progress as base,
 * then merges booknotes from both (deduplicating by id, latest updatedAt wins).
 */
export function mergeBookConfigs(
  current: Partial<BookConfig>,
  backup: Partial<BookConfig>,
): Partial<BookConfig> {
  const currentPage = current.progress?.[0] ?? 0;
  const backupPage = backup.progress?.[0] ?? 0;

  // Use the config with higher progress as base
  const base = backupPage > currentPage ? { ...backup } : { ...current };

  // Merge booknotes from both configs
  const noteMap = new Map<string, BookNote>();
  for (const note of current.booknotes ?? []) {
    noteMap.set(note.id, note);
  }
  for (const note of backup.booknotes ?? []) {
    const existing = noteMap.get(note.id);
    if (!existing || (note.updatedAt || 0) > (existing.updatedAt || 0)) {
      noteMap.set(note.id, note);
    }
  }
  base.booknotes = [...noteMap.values()];

  return stampBookConfigSchema(base);
}

/**
 * Merge two Book metadata records: uses the one with higher updatedAt as base,
 * then reconciles timestamps. Only marks as deleted if BOTH sides agree.
 */
export function mergeBookMetadata(current: Book, backup: Book): Book {
  const base = backup.updatedAt > current.updatedAt ? { ...backup } : { ...current };
  base.updatedAt = Math.max(current.updatedAt, backup.updatedAt);
  base.createdAt = Math.min(current.createdAt, backup.createdAt);
  // Only deleted if BOTH sides agree
  base.deletedAt =
    current.deletedAt && backup.deletedAt ? Math.max(current.deletedAt, backup.deletedAt) : null;
  return base;
}

/** A book restored from a backup whose local copy had been soft-deleted. */
export interface RevivedBook {
  /** The live library record, mutated in place by `reviveRestoredBooks`. */
  book: Book;
  /** The book's metadata as stored in the backup. */
  backup: Book;
}

/**
 * Fix up books revived from a backup — present (not deleted) in the backup
 * but soft-deleted in the current library — see issue #4098.
 *
 * Their files were just re-extracted, so `downloadedAt` / `coverDownloadedAt`
 * are taken from the backup record (the local deletion had cleared them).
 *
 * `updatedAt` is bumped so the restore out-ranks the cloud's deletion
 * tombstone in the next sync's last-writer-wins merge. A single uniform
 * offset is applied to every revived book, so their relative `updatedAt`
 * order — and thus the library's "Updated" sort — is preserved exactly.
 * `syncedAt` is cleared so the next push re-uploads them and corrects the
 * cloud rows. Mutates the `book` of each entry in place.
 */
export function reviveRestoredBooks(revived: RevivedBook[], now: number = Date.now()): void {
  if (revived.length === 0) return;
  let maxUpdatedAt = 0;
  for (const { book } of revived) {
    if (book.updatedAt > maxUpdatedAt) maxUpdatedAt = book.updatedAt;
  }
  // offset >= 1 guarantees every book out-ranks its (un-bumped) cloud copy
  // while a single shared offset keeps their relative order intact.
  const offset = Math.max(1, now - maxUpdatedAt);
  for (const { book, backup } of revived) {
    book.updatedAt += offset;
    book.syncedAt = null;
    book.downloadedAt = backup.downloadedAt ?? book.downloadedAt ?? now;
    book.coverDownloadedAt = backup.coverDownloadedAt ?? book.coverDownloadedAt ?? now;
  }
}

type ProgressCallback = (current: number, total: number, filename: string) => void;

interface BackupPlan {
  /** Small JSON entries: the canonical library.json and sanitized settings.json. */
  texts: { name: string; content: string }[];
  /** Book files, `file.path` relative to the Books dir, `entryName` with forward slashes. */
  files: { file: FileItem; entryName: string }[];
  /** Live books with a cloud copy and no book file on this device. */
  cloudBooks: { book: Book; hasLocalCover: boolean }[];
  /** Live books with no config.json on this device. */
  withoutConfig: Book[];
}

/**
 * Plan the archive: which entries a backup holds and what they are named.
 * Used by the in-memory zip.js writer.
 */
async function collectBackupEntries(
  appService: AppService,
  options: BackupOptions,
): Promise<BackupPlan> {
  // Generate canonical library.json from the current storage backend
  // Books shared with this account are not the user's to keep or copy out.
  const books = (await appService.loadLibraryBooks()).filter((b) => !b.grant);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const libraryBooks = books.map(({ coverImageUrl, ...rest }) => rest);
  const texts = [{ name: getLibraryFilename(), content: JSON.stringify(libraryBooks, null, 2) }];

  // Add the global settings snapshot, sanitized of device-specific and
  // (unless opted in) credential fields.
  try {
    const settings = await appService.loadSettings();
    const sanitized = sanitizeSettingsForBackup(settings, options);
    texts.push({ name: SETTINGS_BACKUP_FILENAME, content: JSON.stringify(sanitized, null, 2) });
  } catch (error) {
    console.warn('Skipping settings backup:', error);
  }

  // Reading statistics live in statistics.db under the Data dir, outside the
  // Books tree walked below: export every book and page event.
  try {
    const stats = await StatisticsDb.open(appService);
    const { books: statBooks, events } = await stats.getEventsForPush(0);
    texts.push({
      name: STATISTICS_BACKUP_FILENAME,
      content: JSON.stringify({ books: statBooks, events }),
    });
  } catch (error) {
    console.warn('Skipping statistics backup:', error);
  }

  // Add the files of every live library book. Only a book's own `<hash>/`
  // dir is exported: the Books/ tree also holds root-level library metadata
  // and dirs no live row references — a soft-deleted book whose file
  // lingered, or an import killed before the library was saved. Those never
  // show in the library UI and must not be silently exported either (#5837).
  // With no rows at all (a library.json that failed to load hands back `[]`)
  // every dir is exported instead, so a broken library can still be rebuilt
  // by restore's orphan-dir import.
  const liveHashes = new Set(books.filter((b) => !b.deletedAt).map((b) => b.hash));
  const isExported = (path: string) => {
    const dir = getBookDirOfPath(path);
    return !!dir && (books.length === 0 || liveHashes.has(dir));
  };
  const booksDir = await appService.resolveFilePath('', 'Books');
  const files = await appService.readDirectory(booksDir, 'None');
  // `readDirectory` returns host-separator paths; on Windows that is a
  // backslash (e.g. `hash\cover.png`). Zip entry names must use forward
  // slashes so the backup restores on every platform — restore matches a
  // book's files by `${hash}/` (see `restoreFromBackupZip`). Issue #4703.
  const bookByHash = new Map(books.map((b) => [b.hash, b]));
  const bookFiles = files
    .filter((file) => file.size > 0 && isExported(file.path))
    .map((file) => {
      const entryName = file.path.replace(/\\/g, '/');
      // The file on disk is named after the title the book was imported with;
      // the archive names it after the current title instead.
      const book = bookByHash.get(getBookDirOfPath(entryName) ?? '');
      return {
        file,
        entryName: book && isBookFile(entryName) ? getBackupBookFilename(book) : entryName,
      };
    })
    // A restore killed mid-file leaves its `.part` temp file behind.
    .filter(({ entryName }) => !entryName.endsWith('.part'));
  const dirsWithBook = new Set(
    bookFiles
      .filter(({ entryName }) => isBookFile(entryName))
      .map(({ entryName }) => getBookDirOfPath(entryName)),
  );
  const dirsWithCover = new Set(
    bookFiles
      .filter(({ entryName }) => entryName.endsWith('/cover.png'))
      .map(({ entryName }) => getBookDirOfPath(entryName)),
  );
  const cloudBooks = books
    .filter((b) => !b.deletedAt && !!b.uploadedAt && !dirsWithBook.has(b.hash))
    .map((book) => ({ book, hasLocalCover: dirsWithCover.has(book.hash) }));
  const dirsWithConfig = new Set(
    bookFiles
      .filter(({ entryName }) => entryName.endsWith('/config.json'))
      .map(({ entryName }) => getBookDirOfPath(entryName)),
  );
  const withoutConfig = books.filter((b) => !b.deletedAt && !dirsWithConfig.has(b.hash));
  return { texts, files: bookFiles, cloudBooks, withoutConfig };
}

const CLOUD_BATCH = 20;

/**
 * A config.json for each book that has none on this device, built from what the
 * server holds: reading position, settings and notes. Restore merges it with the
 * current config, keeping the further position and every note.
 */
async function serverConfigs(books: Book[]): Promise<Map<string, string>> {
  const { SyncClient } = await import('@/libs/sync');
  const client = new SyncClient();
  const [{ configs }, { notes }] = await Promise.all([
    client.pullChanges(0, 'configs'),
    client.pullChanges(0, 'notes'),
  ]);
  const wanted = new Set(books.map((b) => b.hash));
  // Pulled rows are DB-shaped (snake_case) despite the record types.
  const configByHash = new Map<string, DBBookConfig>();
  for (const row of (configs ?? []) as unknown as DBBookConfig[]) {
    if (wanted.has(row.book_hash) && !row.deleted_at) configByHash.set(row.book_hash, row);
  }
  const notesByHash = new Map<string, BookNote[]>();
  for (const row of (notes ?? []) as unknown as DBBookNote[]) {
    if (!wanted.has(row.book_hash) || row.deleted_at) continue;
    const list = notesByHash.get(row.book_hash) ?? [];
    list.push(transformBookNoteFromDB(row));
    notesByHash.set(row.book_hash, list);
  }
  const result = new Map<string, string>();
  for (const hash of wanted) {
    const row = configByHash.get(hash);
    const booknotes = notesByHash.get(hash);
    if (!row && !booknotes) continue;
    const config: Partial<BookConfig> = row
      ? transformBookConfigFromDB(row)
      : { bookHash: hash, updatedAt: 0 };
    result.set(
      `${hash}/config.json`,
      JSON.stringify(stampBookConfigSchema({ ...config, booknotes: booknotes ?? [] })),
    );
  }
  return result;
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Backup cancelled', 'AbortError');
};

/**
 * Fetches one cloud file whole. The signed address can have expired by the time a
 * long run reaches it, so a refused request asks for a fresh one once.
 */
async function fetchCloudFile(
  file: { lfp: string; cfp: string; downloadUrl?: string },
  refresh: (file: { lfp: string; cfp: string }) => Promise<string | undefined>,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  let url = file.downloadUrl;
  for (let attempt = 0; attempt < 2 && url; attempt++) {
    const response = await fetch(url, { signal });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status !== 401 && response.status !== 403) return null;
    url = await refresh(file);
  }
  return null;
}

/**
 * Shared logic: add all library entries to a ZipWriter.
 */
export async function addBackupEntriesToZip(
  writer: ZipWriter<unknown>,
  appService: AppService,
  options: BackupOptions,
  onProgress?: ProgressCallback,
  extras: BackupExtras = {},
): Promise<BackupSummary> {
  const { Uint8ArrayReader } = await import('@zip.js/zip.js');
  const { texts, files, cloudBooks, withoutConfig } = await collectBackupEntries(
    appService,
    options,
  );
  const summary: BackupSummary = {
    files: 0,
    cloudBooks: 0,
    skipped: [],
    configs: 0,
    configsFailed: false,
  };
  const fromCloud = options.includeCloudBooks ? cloudBooks : [];

  for (const { name, content } of texts) {
    await writer.add(name, new Uint8ArrayReader(new TextEncoder().encode(content)));
  }

  const total = files.length + fromCloud.length;
  for (let i = 0; i < files.length; i++) {
    throwIfAborted(extras.signal);
    const { file, entryName } = files[i]!;
    onProgress?.(i + 1, total, file.path);
    try {
      const content = await appService.readFile(file.path, 'Books', 'binary');
      const data = new Uint8Array(content as ArrayBuffer);
      await writer.add(entryName, new Uint8ArrayReader(data), { level: 0 });
      summary.files++;
    } catch (error) {
      console.warn(`Skipping file ${file.path}:`, error);
    }
  }

  if (fromCloud.length > 0) {
    const { batchGetDownloadUrls } = await import('@/libs/storage');
    const refresh = async (file: { lfp: string; cfp: string }) =>
      (await batchGetDownloadUrls([file]))[0]?.downloadUrl;

    for (let start = 0; start < fromCloud.length; start += CLOUD_BATCH) {
      throwIfAborted(extras.signal);
      const batch = fromCloud.slice(start, start + CLOUD_BATCH);
      const wanted = batch.flatMap(({ book, hasLocalCover }) => [
        {
          lfp: getLocalBookFilename(book),
          cfp: `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`,
        },
        ...(hasLocalCover
          ? []
          : [
              {
                lfp: getCoverFilename(book),
                cfp: `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`,
              },
            ]),
      ]);
      const urls = new Map<string, { lfp: string; cfp: string; downloadUrl?: string }>(
        (await batchGetDownloadUrls(wanted)).map((f) => [f.lfp, f]),
      );

      for (let i = 0; i < batch.length; i++) {
        throwIfAborted(extras.signal);
        const { book, hasLocalCover } = batch[i]!;
        onProgress?.(files.length + start + i + 1, total, getLocalBookFilename(book));
        const bookFile = urls.get(getLocalBookFilename(book));
        const data = bookFile ? await fetchCloudFile(bookFile, refresh).catch(() => null) : null;
        if (!data) {
          summary.skipped.push(book.title);
          continue;
        }
        await writer.add(getBackupBookFilename(book), new Uint8ArrayReader(data), { level: 0 });
        summary.cloudBooks++;
        // A missing cover only costs the picture; the book itself is saved.
        const coverFile = hasLocalCover ? undefined : urls.get(getCoverFilename(book));
        const cover = coverFile ? await fetchCloudFile(coverFile, refresh).catch(() => null) : null;
        if (cover)
          await writer.add(getCoverFilename(book), new Uint8ArrayReader(cover), { level: 0 });
      }
    }
  }

  if (options.includeCloudBooks && withoutConfig.length > 0) {
    throwIfAborted(extras.signal);
    try {
      for (const [name, content] of await serverConfigs(withoutConfig)) {
        await writer.add(name, new Uint8ArrayReader(new TextEncoder().encode(content)));
        summary.configs++;
      }
    } catch (error) {
      console.warn('Skipping reading positions and notes from the server:', error);
      summary.configsFailed = true;
    }
  }

  extras.onSummary?.(summary);
  return summary;
}

const ZIP_WRITE_CONFIG: Partial<Configuration> = {
  useWebWorkers: true,
  useCompressionStream: true,
  chunkSize: 1 * 1024 * 1024, // 1MB chunks for streaming
};

/**
 * Create a backup zip in memory, returning an ArrayBuffer.
 */
export async function createBackupZip(
  appService: AppService,
  options: BackupOptions = {},
  onProgress?: ProgressCallback,
  extras: BackupExtras = {},
): Promise<ArrayBuffer> {
  await configureZip(ZIP_WRITE_CONFIG);
  const { BlobWriter, ZipWriter } = await import('@zip.js/zip.js');

  const blobWriter = new BlobWriter('application/zip');
  const writer = new ZipWriter(blobWriter);
  await addBackupEntriesToZip(writer, appService, options, onProgress, extras);
  await writer.close();
  const blob = await blobWriter.getData();
  return await blob.arrayBuffer();
}

/**
 * Validate that zip entries contain a valid backup structure.
 * Must contain library.json at the root level.
 */
export function validateBackupStructure(entryNames: string[]): boolean {
  return entryNames.some((name) => name === getLibraryFilename());
}

/**
 * Restore library from a zip backup, merging with existing data.
 * - Override book files and cover images for existing books
 * - Merge book config files (keep higher progress, merge notes)
 * - Add new books not present in current library
 * - Import orphan hash directories not listed in library.json
 * - Restore global settings (settings.json), deep-merged onto current
 * - Merge reading statistics (statistics.json) into statistics.db
 */
export async function restoreFromBackupZip(
  appService: AppService,
  zipBlob: Blob,
  onProgress?: ProgressCallback,
): Promise<{ booksAdded: number; booksUpdated: number; settingsRestored: boolean }> {
  await configureZip();
  const { BlobReader, ZipReader, Uint8ArrayWriter } = await import('@zip.js/zip.js');

  const reader = new ZipReader(new BlobReader(zipBlob));
  const entries = await reader.getEntries();

  // Validate structure
  const entryNames = entries.map((e) => e.filename);
  if (!validateBackupStructure(entryNames)) {
    await reader.close();
    throw new Error('Invalid backup file: missing library.json');
  }

  // Filter to file entries only (directories don't have getData)
  const fileEntries = entries.filter((e) => !e.directory);

  // Read backup library.json
  const libraryEntry = fileEntries.find((e) => e.filename === getLibraryFilename());
  if (!libraryEntry) {
    await reader.close();
    throw new Error('Cannot read library.json from backup');
  }
  const libraryData = await libraryEntry.getData!(new Uint8ArrayWriter());
  const backupBooks: Book[] = JSON.parse(new TextDecoder().decode(libraryData));

  // Load current library
  const currentBooks = await appService.loadLibraryBooks();

  const currentBooksMap = new Map<string, Book>();
  for (const book of currentBooks) {
    currentBooksMap.set(book.hash, book);
  }

  // Collect orphan hash directories: in zip but not in library.json
  const backupHashes = new Set(backupBooks.map((b) => b.hash));
  const orphanHashes = new Set<string>();
  for (const entry of fileEntries) {
    const slashIdx = entry.filename.indexOf('/');
    if (slashIdx < 0) continue;
    const dir = entry.filename.slice(0, slashIdx);
    if (dir && !backupHashes.has(dir)) {
      orphanHashes.add(dir);
    }
  }

  let booksAdded = 0;
  let booksUpdated = 0;
  const revivedBooks: RevivedBook[] = [];
  // Plan first so progress can count the whole job: the config.json of a
  // book already in the library is merged in JS, every other entry is
  // extracted in one pass, then orphan books are imported from disk.
  const configMerges: FileEntry[] = [];
  const bulkEntries: FileEntry[] = [];
  const orphanImports: FileEntry[] = [];
  // A book file is named after the title in the archive but lives under the
  // name the app looks it up by (getLocalBookFilename), so it is renamed on
  // the way in. Backups made before the rename carry that name already.
  const bookOfFile = new Map<FileEntry, Book>();

  for (const backupBook of backupBooks) {
    const existingBook = currentBooksMap.get(backupBook.hash);
    const bookDir = backupBook.hash;

    // Get all file entries for this book's directory
    const bookFileEntries = fileEntries.filter((e) => e.filename.startsWith(`${bookDir}/`));

    if (existingBook) {
      // Update: override book file and cover, merge config
      for (const entry of bookFileEntries) {
        (entry.filename.endsWith('/config.json') ? configMerges : bulkEntries).push(entry);
        if (isBookFile(entry.filename)) bookOfFile.set(entry, existingBook);
      }

      // Merge book metadata (timestamps, deletedAt reconciliation). A book
      // deleted locally but present in the backup is "revived" — collect it
      // so its download state and updatedAt can be fixed up after the loop.
      const wasRevived = !!existingBook.deletedAt && !backupBook.deletedAt;
      Object.assign(existingBook, mergeBookMetadata(existingBook, backupBook));
      if (wasRevived) revivedBooks.push({ book: existingBook, backup: backupBook });
      booksUpdated++;
    } else {
      // Add new book: extract all files
      if (!(await appService.exists(bookDir, 'Books'))) {
        await appService.createDir(bookDir, 'Books');
      }
      bulkEntries.push(...bookFileEntries);
      for (const entry of bookFileEntries) {
        if (isBookFile(entry.filename)) bookOfFile.set(entry, backupBook);
      }
      currentBooks.push(backupBook);
      currentBooksMap.set(backupBook.hash, backupBook);
      booksAdded++;
    }
  }

  // Orphan directories: hash dirs in zip not listed in library.json.
  for (const hash of orphanHashes) {
    const existingBook = currentBooksMap.get(hash);
    if (existingBook && !existingBook.deletedAt) continue;
    const orphanEntries = fileEntries.filter((e) => e.filename.startsWith(`${hash}/`));
    // Find the book file by extension
    const bookEntry = orphanEntries.find((e) => {
      const ext = e.filename.split('.').pop()?.toLowerCase() ?? '';
      return BOOK_EXTS.has(ext);
    });
    if (!bookEntry) continue;
    if (!(await appService.exists(hash, 'Books'))) {
      await appService.createDir(hash, 'Books');
    }
    bulkEntries.push(...orphanEntries);
    orphanImports.push(bookEntry);
  }

  const total = configMerges.length + bulkEntries.length + orphanImports.length;
  let done = 0;
  const tick = (name: string) => onProgress?.(++done, total, name);

  // Merged configs are written only once the book files they describe are
  // on disk, so a failed extraction leaves the current configs untouched.
  const mergedConfigs: { filename: string; json: string }[] = [];
  for (const entry of configMerges) {
    tick(entry.filename);
    const data = await entry.getData!(new Uint8ArrayWriter());
    let currentConfig: Partial<BookConfig> = {};
    try {
      const str = (await appService.readFile(entry.filename, 'Books', 'text')) as string;
      currentConfig = JSON.parse(str);
    } catch {
      /* use empty config if current doesn't exist */
    }
    const backupConfig: Partial<BookConfig> = JSON.parse(new TextDecoder().decode(data));
    const mergedConfig = mergeBookConfigs(currentConfig, backupConfig);
    mergedConfigs.push({ filename: entry.filename, json: JSON.stringify(mergedConfig) });
  }

  await extractEntries(
    appService,
    bulkEntries,
    (current, _bulkTotal, name) => {
      onProgress?.(configMerges.length + current, total, name);
    },
    (entry) => {
      const book = bookOfFile.get(entry);
      return book ? getLocalBookFilename(book) : entry.filename;
    },
  );
  done = configMerges.length + bulkEntries.length;
  for (const { filename, json } of mergedConfigs) {
    await appService.writeFile(filename, 'Books', json);
  }

  for (const bookEntry of orphanImports) {
    tick(bookEntry.filename);
    try {
      const filePath = await appService.resolveFilePath(bookEntry.filename, 'Books');
      const imported = await appService.importBook(filePath, currentBooks, { overwrite: true });
      if (imported) {
        currentBooksMap.set(imported.hash, imported);
        booksAdded++;
      }
    } catch (error) {
      console.warn(`Failed to import orphan book from ${bookEntry.filename}:`, error);
    }
  }

  // Make revived books out-rank the cloud's deletion tombstone in the
  // next sync, without disturbing the library's "Updated" sort order.
  reviveRestoredBooks(revivedBooks);

  // Save merged library
  await appService.saveLibraryBooks(currentBooks);

  // Restore global settings if the backup carries them. Blacklisted
  // fields are absent from the snapshot, so the current device keeps
  // its own values for those after the deep merge.
  let settingsRestored = false;
  const settingsEntry = fileEntries.find((e) => e.filename === SETTINGS_BACKUP_FILENAME);
  if (settingsEntry) {
    try {
      const data = await settingsEntry.getData!(new Uint8ArrayWriter());
      const backupSettings: Partial<SystemSettings> = JSON.parse(new TextDecoder().decode(data));
      const currentSettings = await appService.loadSettings();
      await appService.saveSettings(mergeRestoredSettings(currentSettings, backupSettings));
      settingsRestored = true;
    } catch (error) {
      console.warn('Failed to restore settings from backup:', error);
    }
  }

  // Merge reading statistics the same way a stats sync pull does: book rows
  // matched by md5, a session already on this device keeps its longer duration.
  const statsEntry = fileEntries.find((e) => e.filename === STATISTICS_BACKUP_FILENAME);
  if (statsEntry) {
    try {
      const data = await statsEntry.getData!(new Uint8ArrayWriter());
      const { books, events }: { books: StatBook[]; events: PageStatEvent[] } = JSON.parse(
        new TextDecoder().decode(data),
      );
      const stats = await StatisticsDb.open(appService);
      await stats.applyRemoteEvents(books, events);
    } catch (error) {
      console.warn('Failed to restore statistics from backup:', error);
    }
  }

  await reader.close();

  return { booksAdded, booksUpdated, settingsRestored };
}

/** Write zip entries into the Books dir, one file at a time. */
async function extractEntries(
  appService: AppService,
  entries: FileEntry[],
  onProgress?: ProgressCallback,
  targetOf: (entry: FileEntry) => string = (entry) => entry.filename,
): Promise<void> {
  const { Uint8ArrayWriter } = await import('@zip.js/zip.js');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    onProgress?.(i + 1, entries.length, entry.filename);
    const data = await entry.getData!(new Uint8ArrayWriter());
    await appService.writeFile(targetOf(entry), 'Books', data.buffer as ArrayBuffer);
  }
}

/** Create a backup zip in memory and save it as a download. */
export async function saveBackupFile(
  appService: AppService,
  filename: string,
  options: BackupOptions = {},
  onProgress?: ProgressCallback,
  extras: BackupExtras = {},
): Promise<boolean> {
  const zipData = await createBackupZip(appService, options, onProgress, extras);
  return appService.saveFile(filename, zipData, { mimeType: 'application/zip' });
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<WritableStream & { abort: () => Promise<void> }> }>;
}

/** Whether the browser can write the backup straight into a file on disk. */
export const canStreamBackup = () =>
  typeof window !== 'undefined' &&
  typeof (window as unknown as SaveFilePickerWindow).showSaveFilePicker === 'function';

/**
 * Writes a zip into a file the user picks, entry by entry, so the archive never
 * has to fit in memory. `fill` adds the entries. Returns false when the picker
 * was dismissed. The picker has to open from the click, so it comes before any
 * other await.
 */
export async function streamZipToFile(
  filename: string,
  fill: (writer: ZipWriter<unknown>) => Promise<void>,
): Promise<boolean> {
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker!;
  let handle: Awaited<ReturnType<NonNullable<SaveFilePickerWindow['showSaveFilePicker']>>>;
  try {
    handle = await picker({
      suggestedName: filename,
      types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
  await configureZip(ZIP_WRITE_CONFIG);
  const { ZipWriter } = await import('@zip.js/zip.js');
  const writable = await handle.createWritable();
  try {
    const writer = new ZipWriter(writable);
    await fill(writer);
    await writer.close();
    return true;
  } catch (error) {
    // Drop the half-written file instead of leaving a broken archive behind.
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

/** Writes the backup into a file the user picks. See `streamZipToFile`. */
export async function saveBackupStreaming(
  appService: AppService,
  filename: string,
  options: BackupOptions = {},
  onProgress?: ProgressCallback,
  extras: BackupExtras = {},
): Promise<boolean> {
  return streamZipToFile(filename, async (writer) => {
    await addBackupEntriesToZip(writer, appService, options, onProgress, extras);
  });
}

export { ZIP_WRITE_CONFIG, CLOUD_BATCH, throwIfAborted, fetchCloudFile };
