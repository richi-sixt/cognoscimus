import { describe, expect, test } from 'vitest';
import {
  SETTINGS_DICTIONARY_FIELDS,
  SETTINGS_KIND,
  SETTINGS_REPLICA_ID,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_WHITELIST,
  readPath,
  settingsAdapter,
  writePath,
  type SettingsRemoteRecord,
} from '@/services/sync/adapters/settings';
import type { FieldEnvelope, Hlc, ReplicaRow } from '@/types/replica';
import type { SystemSettings } from '@/types/settings';

const HLC = '00000000001-00000000-dev' as Hlc;
const env = <T>(v: T): FieldEnvelope<T> => ({ v, t: HLC, s: 'dev' });

const makeRow = (fields: Record<string, FieldEnvelope<unknown>>): ReplicaRow => ({
  user_id: 'u',
  kind: SETTINGS_KIND,
  replica_id: SETTINGS_REPLICA_ID,
  fields_jsonb: fields,
  manifest_jsonb: null,
  deleted_at_ts: null,
  reincarnation: null,
  updated_at_ts: HLC,
  schema_version: 1,
});

describe('settingsAdapter', () => {
  test('kind + schemaVersion + replica id are stable', () => {
    expect(settingsAdapter.kind).toBe('settings');
    expect(settingsAdapter.schemaVersion).toBe(1);
    expect(SETTINGS_KIND).toBe('settings');
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
    expect(SETTINGS_REPLICA_ID).toBe('singleton');
  });

  test('every dictionary-category path is a real whitelist entry', () => {
    // The 'dictionary' sync gate in replicaSettingsSync matches these
    // paths against SETTINGS_WHITELIST by exact string. A typo or a
    // renamed whitelist entry would silently reopen the leak in #5465,
    // so pin the membership here.
    for (const path of SETTINGS_DICTIONARY_FIELDS) {
      expect(SETTINGS_WHITELIST).toContain(path);
    }
    // Conversely, every whitelisted dictionarySettings.* path must be
    // gated — a new one added without updating the list would sync
    // regardless of the Dictionaries toggle.
    const whitelistedDictPaths = SETTINGS_WHITELIST.filter((p) =>
      p.startsWith('dictionarySettings.'),
    );
    expect([...SETTINGS_DICTIONARY_FIELDS].sort()).toEqual(whitelistedDictPaths.slice().sort());
  });

  test('declares no `binary` capability — bundled metadata only', () => {
    expect(settingsAdapter.binary).toBeUndefined();
  });

  test('computeId always returns the singleton id', async () => {
    expect(await settingsAdapter.computeId({ name: 'singleton', patch: {} })).toBe('singleton');
  });

  test('pack only emits whitelisted fields, dropping non-whitelist keys', () => {
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        globalReadSettings: { userHighlightColors: userColors },
        // not in whitelist:
        telemetryEnabled: true,
        screenBrightness: 0.5,
        localBooksDir: '/should/not/sync',
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['globalReadSettings.userHighlightColors']).toEqual(userColors);
    expect(fields['telemetryEnabled']).toBeUndefined();
    expect(fields['screenBrightness']).toBeUndefined();
    expect(fields['localBooksDir']).toBeUndefined();
  });

  test('pack ∘ unpack round-trips object-valued nested fields (highlight palette)', () => {
    const customColors = { yellow: '#ffeb3b', blue: '#2196f3' };
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        globalReadSettings: {
          customHighlightColors: customColors,
          userHighlightColors: userColors,
        },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    const out = settingsAdapter.unpack(fields);
    expect(out.patch.globalReadSettings?.customHighlightColors).toEqual(customColors);
    expect(out.patch.globalReadSettings?.userHighlightColors).toEqual(userColors);
  });

  test('pack drops empty/blank kosync.customHeaders instead of shipping an empty object', () => {
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        kosync: { customHeaders: {} },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['kosync.customHeaders']).toBeUndefined();
  });

  test('pack drops empty/blank bookorbit.customHeaders instead of shipping an empty object', () => {
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        bookorbit: { customHeaders: {} },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['bookorbit.customHeaders']).toBeUndefined();
  });

  test('kosync.serverUrl is plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('kosync.serverUrl');
  });

  test('webdav.serverUrl and webdav.rootPath are plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('webdav.serverUrl');
    expect(settingsAdapter.encryptedFields).not.toContain('webdav.rootPath');
  });

  test('s3.endpoint / region / bucket are plaintext (not in encryptedFields)', () => {
    expect(settingsAdapter.encryptedFields).not.toContain('s3.endpoint');
    expect(settingsAdapter.encryptedFields).not.toContain('s3.region');
    expect(settingsAdapter.encryptedFields).not.toContain('s3.bucket');
  });

  test('unpackRow returns null when the row carries no whitelisted fields', () => {
    const row = makeRow({ unknownField: env('garbage') });
    expect(settingsAdapter.unpackRow(row, '')).toBeNull();
  });
});

describe('SETTINGS_WHITELIST', () => {
  test('is non-empty (at least one field shipped in v1)', () => {
    expect(SETTINGS_WHITELIST.length).toBeGreaterThan(0);
  });

  test('includes only string-typed dot-paths', () => {
    for (const key of SETTINGS_WHITELIST) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  test('includes the dictionary settings paths (PR 6 — whole-field LWW)', () => {
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.providerOrder');
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.providerEnabled');
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.webSearches');
    // Dictionary popup font size (#4443) follows the user across devices.
    expect(SETTINGS_WHITELIST).toContain('dictionarySettings.fontScale');
  });

  test('includes the S3 connection fields but not its per-device bookkeeping', () => {
    expect(SETTINGS_WHITELIST).toContain('s3.endpoint');
    expect(SETTINGS_WHITELIST).toContain('s3.region');
    expect(SETTINGS_WHITELIST).toContain('s3.bucket');
    expect(SETTINGS_WHITELIST).toContain('s3.accessKeyId');
    expect(SETTINGS_WHITELIST).toContain('s3.secretAccessKey');
    expect(SETTINGS_WHITELIST).not.toContain('s3.enabled');
    expect(SETTINGS_WHITELIST).not.toContain('s3.deviceId');
    expect(SETTINGS_WHITELIST).not.toContain('s3.providerSelectedAt');
  });

  test('does NOT sync dictionarySettings.defaultProviderId (per-device last-used tab)', () => {
    expect(SETTINGS_WHITELIST).not.toContain('dictionarySettings.defaultProviderId');
  });

  test('syncs library-scope proofread rules (issue #4700 — PC rules not reaching mobile)', () => {
    expect(SETTINGS_WHITELIST).toContain('globalViewSettings.proofreadRules');
  });

  test('syncs WebDAV connection + credentials (issue #4810 — credentials not synced)', () => {
    expect(SETTINGS_WHITELIST).toContain('webdav.serverUrl');
    expect(SETTINGS_WHITELIST).toContain('webdav.username');
    expect(SETTINGS_WHITELIST).toContain('webdav.password');
    expect(SETTINGS_WHITELIST).toContain('webdav.rootPath');
  });

  test('does NOT sync per-device WebDAV bookkeeping fields', () => {
    // enabled / deviceId / lastSyncedAt / sync sub-toggles are per-device
    // state — syncing them would auto-arm a fresh device or rotate its id.
    expect(SETTINGS_WHITELIST).not.toContain('webdav.enabled');
    expect(SETTINGS_WHITELIST).not.toContain('webdav.deviceId');
    expect(SETTINGS_WHITELIST).not.toContain('webdav.lastSyncedAt');
  });
});

describe('settingsAdapter proofread rules', () => {
  test('pack ∘ unpack round-trips globalViewSettings.proofreadRules', () => {
    const proofreadRules = [
      {
        id: 'r1',
        scope: 'library',
        pattern: 'colour',
        replacement: 'color',
        enabled: true,
        isRegex: false,
        caseSensitive: true,
        order: 1000,
        wholeWord: true,
      },
    ];
    const record: SettingsRemoteRecord = {
      name: 'singleton',
      patch: {
        globalViewSettings: { proofreadRules },
      } as unknown as Partial<SystemSettings>,
    };
    const fields = settingsAdapter.pack(record);
    expect(fields['globalViewSettings.proofreadRules']).toEqual(proofreadRules);
    const out = settingsAdapter.unpack(fields);
    expect(out.patch.globalViewSettings?.proofreadRules).toEqual(proofreadRules);
  });

  test('unpackRow reconstructs proofread rules from a CRDT envelope', () => {
    const proofreadRules = [
      {
        id: 'r1',
        scope: 'library',
        pattern: 'teh',
        replacement: 'the',
        enabled: true,
        isRegex: false,
        caseSensitive: false,
        order: 1000,
        wholeWord: true,
      },
    ];
    const row = makeRow({ 'globalViewSettings.proofreadRules': env(proofreadRules) });
    const out = settingsAdapter.unpackRow(row, '');
    expect(out).not.toBeNull();
    expect(out!.patch.globalViewSettings?.proofreadRules).toEqual(proofreadRules);
  });
});

describe('readPath / writePath', () => {
  test('reads top-level and nested values', () => {
    const obj = { a: 1, nested: { b: 'x', deep: { c: true } } };
    expect(readPath(obj, 'a')).toBe(1);
    expect(readPath(obj, 'nested.b')).toBe('x');
    expect(readPath(obj, 'nested.deep.c')).toBe(true);
    expect(readPath(obj, 'nested.missing')).toBeUndefined();
    expect(readPath(obj, 'missing.path')).toBeUndefined();
  });

  test('writes top-level and nested, creating intermediates', () => {
    const obj: Record<string, unknown> = {};
    writePath(obj, 'a', 1);
    writePath(obj, 'nested.b', 'x');
    writePath(obj, 'nested.deep.c', true);
    expect(obj).toEqual({ a: 1, nested: { b: 'x', deep: { c: true } } });
  });

  test('writePath overwrites a non-object intermediate with a fresh object', () => {
    const obj: Record<string, unknown> = { foo: 'oops' };
    writePath(obj, 'foo.bar', 1);
    expect(obj).toEqual({ foo: { bar: 1 } });
  });

  test('writePath rejects __proto__ / constructor / prototype segments', () => {
    const obj: Record<string, unknown> = {};
    writePath(obj, '__proto__.polluted', 'bad');
    writePath(obj, 'constructor.prototype.polluted', 'bad');
    writePath(obj, 'a.prototype.b', 'bad');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(obj).toEqual({});
  });

  test('readPath rejects __proto__ / constructor / prototype segments', () => {
    const obj = { a: 1 };
    expect(readPath(obj, '__proto__')).toBeUndefined();
    expect(readPath(obj, 'constructor')).toBeUndefined();
    expect(readPath(obj, 'a.prototype')).toBeUndefined();
  });
});
