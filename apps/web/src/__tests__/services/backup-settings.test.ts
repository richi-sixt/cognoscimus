import { journalBookshelfOperation } from '@/services/bookshelves/journal';
import { describe, it, expect } from 'vitest';
import {
  BACKUP_SETTINGS_BLACKLIST,
  BACKUP_SETTINGS_CREDENTIAL_FIELDS,
  sanitizeSettingsForBackup,
  mergeRestoredSettings,
} from '@/services/backupService';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { readBookshelves } from '@/services/bookshelves/state';
import { hlcPack } from '@/libs/crdt';
import { SystemSettings } from '@/types/settings';

/**
 * Tests for global-settings backup support (issue #4098):
 * - sanitizeSettingsForBackup strips device-specific / sync-bookkeeping
 *   fields and (by default) credentials before writing settings.json.
 * - mergeRestoredSettings deep-merges a restored snapshot onto the
 *   current device settings, preserving stripped fields.
 */

/** Read an arbitrary (possibly stripped) field as a plain record. */
const rec = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

function makeSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    version: 5,
    migrationVersion: 3,
    localBooksDir: '/Users/me/Books',
    customRootDir: '/Users/me/cognoscimus',
    externalLibraryFolders: ['/Users/me/Duokan', '/Users/me/Calibre'],
    keepLogin: true,
    screenBrightness: 0.7,
    autoScreenBrightness: false,
    lastOpenBooks: ['book-1', 'book-2'],
    savedBookCoverForLockScreen: 'cover',
    savedBookCoverForLockScreenPath: '/Users/me/cover.png',
    libraryViewMode: 'grid',
    librarySortBy: 'title',
    libraryColumns: 4,
    replicaDeviceId: 'device-uuid-aaa',
    lastSyncedAtBooks: 1234,
    lastSyncedAtConfigs: 1235,
    lastSyncedAtNotes: 1236,
    lastSyncedAtReplicas: { book: 'hlc-1' },
    opdsCatalogs: [
      {
        id: 'cat-1',
        title: 'Cat',
        url: 'https://example.com/opds',
        username: 'opds-user',
        password: 'opds-pass',
      },
    ],
    customTranslators: [
      {
        id: 'tr-1',
        type: 'openai-compatible',
        name: 'My LLM',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'tr-secret',
        addedAt: 1,
        updatedAt: 1,
      },
    ],
    customTTSServices: [
      {
        id: 'tts-1',
        name: 'My TTS',
        baseUrl: 'https://tts.example.com/v1',
        apiKey: 'tts-secret',
        model: 'tts-1',
        addedAt: 1,
        updatedAt: 1,
      },
    ],
    webdav: {
      enabled: true,
      serverUrl: 'https://dav.example',
      username: 'wuser',
      password: 'wpass',
      rootPath: '/',
      deviceId: 'webdav-device-id',
      lastSyncedAt: 666,
    },
    googleDrive: {
      enabled: true,
      accountLabel: 'me@gmail.com',
      strategy: 'silent',
      deviceId: 'gdrive-device-id',
      lastSyncedAt: 777,
    },
    globalReadSettings: {
      sideBarWidth: '20%',
      customThemes: [{ name: 'mytheme' }],
    },
    globalViewSettings: {
      userStylesheet: 'body { color: red }',
      uiLanguage: 'en',
    },
    ...overrides,
  } as unknown as SystemSettings;
}

it('exports local shelves independently of the originating device journal', () => {
  const shelf = createBookshelf('Anonymous backup');
  const t = hlcPack(100, 0, 'device');
  const row = {
    user_id: '',
    kind: 'bookshelf',
    replica_id: shelf.id,
    fields_jsonb: { definition: { v: shelf, t, s: 'device' } },
    updated_at_ts: t,
    deleted_at_ts: null,
    manifest_jsonb: null,
    reincarnation: null,
    schema_version: 1,
    localOnly: true as const,
  };
  journalBookshelfOperation(row);
  const settings = makeSettings({ bookshelves: { rows: { [shelf.id]: row } } });
  const backup = sanitizeSettingsForBackup(settings);
  localStorage.clear();
  expect(readBookshelves(backup).some((s) => s.id === shelf.id)).toBe(true);
  expect(settings.bookshelves?.rows[shelf.id]?.localOnly).toBe(true);
});

describe('sanitizeSettingsForBackup - blacklist', () => {
  it('strips device-specific filesystem paths', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['localBooksDir']).toBeUndefined();
    expect(out['customRootDir']).toBeUndefined();
    expect(out['externalLibraryFolders']).toBeUndefined();
    expect(out['savedBookCoverForLockScreenPath']).toBeUndefined();
  });

  it('strips per-device identity fields', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['replicaDeviceId']).toBeUndefined();
    expect(rec(out['googleDrive'])['deviceId']).toBeUndefined();
    // Non-identity Drive settings still travel with the backup.
    expect(rec(out['googleDrive'])['enabled']).toBe(true);
    // WebDAV device identity and cursor stay on the device; restoring
    // them onto a second device would duplicate WebDAV sync identity.
    expect(rec(out['webdav'])['deviceId']).toBeUndefined();
    expect(rec(out['webdav'])['lastSyncedAt']).toBeUndefined();
    expect(rec(out['webdav'])['serverUrl']).toBe('https://dav.example');
  });

  it('strips sync cursors', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['lastSyncedAtBooks']).toBeUndefined();
    expect(out['lastSyncedAtConfigs']).toBeUndefined();
    expect(out['lastSyncedAtNotes']).toBeUndefined();
    expect(out['lastSyncedAtReplicas']).toBeUndefined();
    expect(rec(out['googleDrive'])['lastSyncedAt']).toBeUndefined();
  });

  it('strips cognoscimusCloud.disabledAt but keeps cognoscimusCloud.enabled', () => {
    // disabledAt is device-local: it records when THIS device stopped
    // writing native sync rows, and anchors the mixed-fleet probe. A value
    // restored from another device's backup would corrupt that probe.
    // enabled must survive restore, matching the other providers' `enabled`
    // flags (see issue #5062).
    const out = sanitizeSettingsForBackup(
      makeSettings({ cognoscimusCloud: { enabled: false, disabledAt: 1234 } }),
    );
    expect(out.cognoscimusCloud?.disabledAt).toBeUndefined();
    expect(out.cognoscimusCloud?.enabled).toBe(false);
  });

  it('strips transient runtime state', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['lastOpenBooks']).toBeUndefined();
    expect(out['screenBrightness']).toBeUndefined();
  });

  it('strips schema versioning fields', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings()));
    expect(out['version']).toBeUndefined();
    expect(out['migrationVersion']).toBeUndefined();
  });

  it('does not mutate the input settings', () => {
    const input = makeSettings();
    const snapshot = JSON.stringify(input);
    sanitizeSettingsForBackup(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('every blacklisted path is a string', () => {
    expect(BACKUP_SETTINGS_BLACKLIST.every((p) => typeof p === 'string')).toBe(true);
  });

  it('blacklists icloud device-local fields', () => {
    expect(BACKUP_SETTINGS_BLACKLIST).toContain('icloud.deviceId');
    expect(BACKUP_SETTINGS_BLACKLIST).toContain('icloud.lastSyncedAt');
    expect(BACKUP_SETTINGS_BLACKLIST).toContain('icloud.providerSelectedAt');
  });
});

describe('sanitizeSettingsForBackup - credentials', () => {
  it('still strips blacklist fields even when credentials are included', () => {
    const out = rec(sanitizeSettingsForBackup(makeSettings(), { includeCredentials: true }));
    expect(out['localBooksDir']).toBeUndefined();
    expect(out['replicaDeviceId']).toBeUndefined();
  });

  it('every credential path is a string', () => {
    expect(BACKUP_SETTINGS_CREDENTIAL_FIELDS.every((p) => typeof p === 'string')).toBe(true);
  });
});

describe('mergeRestoredSettings', () => {
  it('overrides current scalar values with the backup snapshot', () => {
    const current = makeSettings({ libraryViewMode: 'list', libraryColumns: 2 });
    const backup = sanitizeSettingsForBackup(makeSettings({ libraryViewMode: 'grid' }));
    const merged = mergeRestoredSettings(current, backup);
    expect(merged.libraryViewMode).toBe('grid');
    expect(merged.libraryColumns).toBe(4);
  });

  it('preserves device-specific fields absent from the backup', () => {
    const current = makeSettings({
      localBooksDir: '/device/Books',
      version: 9,
      migrationVersion: 7,
    });
    const backup = sanitizeSettingsForBackup(makeSettings());
    const merged = mergeRestoredSettings(current, backup);
    expect(merged.localBooksDir).toBe('/device/Books');
    expect(merged.version).toBe(9);
    expect(merged.migrationVersion).toBe(7);
    expect(merged.replicaDeviceId).toBe('device-uuid-aaa');
  });

  it('replaces arrays wholesale rather than concatenating', () => {
    const current = makeSettings({
      globalReadSettings: {
        customThemes: [{ name: 'device-theme-a' }, { name: 'device-theme-b' }],
      } as SystemSettings['globalReadSettings'],
    });
    const backup = sanitizeSettingsForBackup(
      makeSettings({
        globalReadSettings: {
          customThemes: [{ name: 'restored-theme' }],
        } as SystemSettings['globalReadSettings'],
      }),
    );
    const merged = mergeRestoredSettings(current, backup);
    expect(merged.globalReadSettings.customThemes).toEqual([{ name: 'restored-theme' }]);
  });

  it('does not mutate the current or backup objects', () => {
    const current = makeSettings();
    const backup = sanitizeSettingsForBackup(makeSettings({ libraryViewMode: 'list' }));
    const currentSnapshot = JSON.stringify(current);
    const backupSnapshot = JSON.stringify(backup);
    mergeRestoredSettings(current, backup);
    expect(JSON.stringify(current)).toBe(currentSnapshot);
    expect(JSON.stringify(backup)).toBe(backupSnapshot);
  });

  // Bookshelves are LWW rows, not a scalar blob: a restore merges them by stamp
  // and never rolls back a newer local shelf edit.
  describe('bookshelf rows', () => {
    const shelfState = (
      id: string,
      definition: unknown,
      at: number,
    ): SystemSettings['bookshelves'] => {
      const stamp = hlcPack(at, 0, 'dev-a');
      return {
        rows: {
          [id]: {
            user_id: '',
            kind: 'bookshelf',
            replica_id: id,
            fields_jsonb: { definition: { v: definition, t: stamp, s: 'dev-a' } },
            deleted_at_ts: null,
            updated_at_ts: stamp,
            reincarnation: null,
            manifest_jsonb: null,
            schema_version: 1,
          },
        },
      };
    };
    const named = (id: string, name: string, at: number) =>
      shelfState(id, createBookshelf(name, id), at);
    const shelfNames = (settings: SystemSettings) =>
      readBookshelves(settings).map((shelf) => shelf.name);
    const CUSTOM_ID = '00000000-0000-4000-8000-000000000001';

    it('does not roll back a newer local shelf definition', () => {
      const current = makeSettings({ bookshelves: named('default', 'Local edit', 2000) });
      const backup = sanitizeSettingsForBackup(
        makeSettings({ bookshelves: named('default', 'Older backup', 1000) }),
      );
      expect(shelfNames(mergeRestoredSettings(current, backup))).not.toContain('Older backup');
      expect(shelfNames(mergeRestoredSettings(current, backup))).toContain('Local edit');
    });

    it('adopts a newer backup shelf definition', () => {
      const current = makeSettings({ bookshelves: named('default', 'Local edit', 1000) });
      const backup = sanitizeSettingsForBackup(
        makeSettings({ bookshelves: named('default', 'Newer backup', 2000) }),
      );
      expect(shelfNames(mergeRestoredSettings(current, backup))).not.toContain('Local edit');
      expect(shelfNames(mergeRestoredSettings(current, backup))).toContain('Newer backup');
    });

    it('adds a shelf that is absent locally', () => {
      const current = makeSettings({ bookshelves: named('default', 'Local edit', 1000) });
      const backup = sanitizeSettingsForBackup(
        makeSettings({ bookshelves: named(CUSTOM_ID, 'Restored shelf', 1000) }),
      );
      const merged = mergeRestoredSettings(current, backup);
      expect(Object.keys(merged.bookshelves!.rows).sort()).toEqual([CUSTOM_ID, 'default']);
      expect(shelfNames(merged)).toContain('Restored shelf');
      expect(shelfNames(merged)).toContain('Local edit');
    });

    it('drops an invalid backup row without throwing', () => {
      const current = makeSettings({ bookshelves: named('default', 'Local edit', 1000) });
      const backup = sanitizeSettingsForBackup(
        makeSettings({
          bookshelves: shelfState(CUSTOM_ID, { id: CUSTOM_ID, name: 'Broken' }, 2000),
        }),
      );
      const merged = mergeRestoredSettings(current, backup);
      expect(Object.keys(merged.bookshelves!.rows)).toEqual(['default']);
      expect(shelfNames(merged)).toContain('Local edit');
    });
  });
});
