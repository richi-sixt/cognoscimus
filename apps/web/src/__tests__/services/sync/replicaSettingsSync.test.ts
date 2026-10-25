import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const publishMock = vi.fn();
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: (...args: unknown[]) => publishMock(...args),
}));

let isUnlocked = true;
vi.mock('@/libs/crypto/session', () => ({
  cryptoSession: { isUnlocked: () => isUnlocked },
}));

// Default behavior: the gate "succeeds" by flipping isUnlocked to true
// (mimicking a successful passphrase setup/unlock). Individual tests
// override to simulate cancellation or a missing prompter.
const ensurePassphraseMock = vi.fn(async () => {
  isUnlocked = true;
});
vi.mock('@/services/sync/passphraseGate', () => ({
  ensurePassphraseUnlocked: () => ensurePassphraseMock(),
}));

import {
  __resetSettingsSyncForTests,
  applyRemoteSettings,
  initSettingsSync,
  publishSettingsIfChanged,
} from '@/services/sync/replicaSettingsSync';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import type { CustomTheme } from '@/styles/themes';

const baseHighlight = {
  customThemes: [],
  customHighlightColors: { yellow: '#ffeb3b' },
  userHighlightColors: [],
  defaultHighlightLabels: {},
  customTtsHighlightColors: [],
};

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    globalReadSettings: { ...baseHighlight },
    kosync: { serverUrl: '', username: '', userkey: '', password: '' },
    readwise: { accessToken: '' },
    hardcover: { accessToken: '' },
    notion: {
      enabled: false,
      accessToken: '',
      databaseId: '',
      lastSyncedAt: 0,
      includeChapterHeading: true,
    },
    webdav: { serverUrl: '', username: '', password: '', rootPath: '/' },
    ...overrides,
  }) as unknown as SystemSettings;

const makeEnvConfig = (): EnvConfigType => ({ getAppService: vi.fn() }) as unknown as EnvConfigType;

/**
 * Flip the 'dictionary' sync category for the current test. Dictionary
 * preferences (providerOrder / providerEnabled / webSearches / fontScale)
 * ride the bundled settings row but belong to the user-facing
 * "Dictionaries" toggle, not "App settings" — see issue #5465.
 */
const setDictionarySync = (enabled: boolean): void => {
  const current = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: {
      ...current,
      syncCategories: { ...current?.syncCategories, dictionary: enabled },
    } as never,
  } as never);
};

beforeEach(() => {
  publishMock.mockReset();
  ensurePassphraseMock.mockReset();
  ensurePassphraseMock.mockImplementation(async () => {
    isUnlocked = true;
  });
  __resetSettingsSyncForTests();
  isUnlocked = true;
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(),
    applyUILanguage: vi.fn(),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

afterEach(() => {
  __resetSettingsSyncForTests();
});

describe('publishSettingsIfChanged', () => {
  test.each([
    'startup',
    'published',
    'remote',
  ] as const)('publishes in-place custom theme changes after a %s snapshot', async (source) => {
    const settings = makeSettings();
    settings.globalReadSettings.customThemes = [];
    await publishSettingsIfChanged(settings);
    if (source === 'startup') {
      __resetSettingsSyncForTests();
      initSettingsSync(settings);
    } else if (source === 'remote') {
      applyRemoteSettings(makeEnvConfig(), {
        name: 'singleton',
        patch: {
          globalReadSettings: { customThemes: [] },
        } as unknown as Partial<SystemSettings>,
      });
    }
    const current = source === 'remote' ? useSettingsStore.getState().settings : settings;
    await publishSettingsIfChanged(current);
    publishMock.mockClear();

    const theme: CustomTheme = {
      name: 'custom',
      label: 'Custom',
      colors: {
        light: { bg: '#ffffff', fg: '#000000', primary: '#0066cc' },
        dark: { bg: '#000000', fg: '#ffffff', primary: '#0066cc' },
      },
    };
    // saveCustomTheme pushes into the live array, then reuses that settings object.
    current.globalReadSettings.customThemes.push(theme);
    await publishSettingsIfChanged(current);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock.mock.calls[0]![1].patch.globalReadSettings.customThemes).toEqual([theme]);
    publishMock.mockClear();

    theme.colors.dark.bg = '#112233';
    await publishSettingsIfChanged(current);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(
      publishMock.mock.calls[0]![1].patch.globalReadSettings.customThemes[0].colors.dark.bg,
    ).toBe('#112233');
    publishMock.mockClear();

    current.globalReadSettings.customThemes.splice(0, 1);
    await publishSettingsIfChanged(current);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock.mock.calls[0]![1].patch.globalReadSettings.customThemes).toEqual([]);
    publishMock.mockClear();

    await publishSettingsIfChanged(current);
    expect(publishMock).not.toHaveBeenCalled();
  });

  test('first call publishes every populated whitelisted field', async () => {
    await publishSettingsIfChanged(makeSettings());
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [kind, record, replicaId] = publishMock.mock.calls[0]!;
    expect(kind).toBe('settings');
    expect(replicaId).toBe('singleton');
    const patch = (record as { patch: Partial<SystemSettings> }).patch;
    expect(patch.globalReadSettings?.customHighlightColors).toEqual(
      baseHighlight.customHighlightColors,
    );
  });

  test('second call with no changes is a no-op', async () => {
    await publishSettingsIfChanged(makeSettings());
    publishMock.mockReset();
    await publishSettingsIfChanged(makeSettings());
    expect(publishMock).not.toHaveBeenCalled();
  });

  test('does NOT publish dictionarySettings.providerOrder by default (auto-mutation gate)', async () => {
    // providerOrder must only ship cross-device on explicit user
    // actions (drag-drop reorder, dict import, dict delete, web-search
    // add). Auto-mutations from applyRemoteDictionary, softDeleteByContentId,
    // loadCustomDictionaries reconciliation, and ordinary saveSettings
    // calls must NOT republish it — otherwise a fresh device's local
    // append-on-pull or orphan-rescue order would clobber the
    // authoritative cross-device order under per-field LWW.
    await publishSettingsIfChanged(
      makeSettings({
        dictionarySettings: {
          providerOrder: ['imp-new', 'builtin:wiktionary'],
          providerEnabled: { 'imp-new': true, 'builtin:wiktionary': true },
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    // providerOrder excluded — gate closed, no explicit opt-in.
    expect(patch.dictionarySettings?.providerOrder).toBeUndefined();
    // providerEnabled is NOT gated — auto-publishes per usual diff.
    expect(patch.dictionarySettings?.providerEnabled).toBeDefined();
  });

  test('publishes dictionarySettings.providerOrder when markExplicitProviderOrderPublish was called', async () => {
    const { markExplicitProviderOrderPublish } = await import(
      '@/services/sync/replicaSettingsSync'
    );
    markExplicitProviderOrderPublish();
    await publishSettingsIfChanged(
      makeSettings({
        dictionarySettings: {
          providerOrder: ['imp-new', 'builtin:wiktionary'],
          providerEnabled: { 'imp-new': true, 'builtin:wiktionary': true },
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.dictionarySettings?.providerOrder).toEqual(['imp-new', 'builtin:wiktionary']);
  });

  test('explicit-publish opt-in is consumed after one publish (no carryover)', async () => {
    const { markExplicitProviderOrderPublish } = await import(
      '@/services/sync/replicaSettingsSync'
    );
    markExplicitProviderOrderPublish();
    const settings1 = makeSettings({
      dictionarySettings: {
        providerOrder: ['a'],
        providerEnabled: { a: true },
        webSearches: [],
      },
    } as Partial<SystemSettings>);
    await publishSettingsIfChanged(settings1);
    expect(publishMock).toHaveBeenCalledTimes(1);
    publishMock.mockReset();

    // Second publish without re-marking — providerOrder change is gated.
    const settings2 = makeSettings({
      dictionarySettings: {
        providerOrder: ['b', 'a'],
        providerEnabled: { a: true, b: true },
        webSearches: [],
      },
    } as Partial<SystemSettings>);
    await publishSettingsIfChanged(settings2);
    // providerEnabled changed — that publishes. providerOrder is gated.
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.dictionarySettings?.providerOrder).toBeUndefined();
    expect(patch.dictionarySettings?.providerEnabled).toEqual({ a: true, b: true });
  });

  test('does NOT publish dictionarySettings when the dictionary category is OFF (issue #5465)', async () => {
    setDictionarySync(false);
    await publishSettingsIfChanged(
      makeSettings({
        dictionarySettings: {
          providerOrder: ['imp-new'],
          providerEnabled: { 'imp-new': true, 'builtin:systemDictionary': false },
          webSearches: [{ id: 'web:y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' }],
          fontScale: 1.2,
        },
      } as Partial<SystemSettings>),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.dictionarySettings).toBeUndefined();
    // Unrelated whitelisted settings ride the same row and still publish.
    expect(patch.globalReadSettings?.customHighlightColors).toEqual(
      baseHighlight.customHighlightColors,
    );
  });

  test('markExplicitProviderOrderPublish does not override the OFF gate', async () => {
    const { markExplicitProviderOrderPublish } = await import(
      '@/services/sync/replicaSettingsSync'
    );
    setDictionarySync(false);
    markExplicitProviderOrderPublish();
    await publishSettingsIfChanged(
      makeSettings({
        dictionarySettings: {
          providerOrder: ['imp-new', 'builtin:wiktionary'],
          providerEnabled: { 'imp-new': true },
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
    const patch = publishMock.mock.calls[0]![1].patch as Partial<SystemSettings>;
    expect(patch.dictionarySettings).toBeUndefined();
  });

  test('initSettingsSync(initialSettings) primes the snapshot so structural disk defaults do not re-push', async () => {
    // Real-world bug: a fresh-install Device B's library boot calls
    // setSettings(disk_default) which fires publishSettingsIfChanged
    // with an empty lastPublishedFields snapshot. Every structural
    // whitelisted field looks "changed from undefined" and gets pushed
    // to the server with a fresh HLC, overwriting the cross-device
    // authoritative values another device set. Disk-priming via
    // initSettingsSync(initialSettings) seeds the snapshot from the
    // just-loaded disk so the same-value first publish skips them.
    //
    // Credential connection metadata (webdav.rootPath, kosync.serverUrl, ...)
    // is push-hash tracked, NOT disk-seeded, so it is intentionally exempt
    // from this priming — that exemption is what lets a configured-but-never-
    // published URL reach the other devices (#5141).
    const diskSettings = makeSettings({
      dictionarySettings: {
        providerOrder: ['builtin:wiktionary', 'builtin:wikipedia'],
        providerEnabled: { 'builtin:wiktionary': true, 'builtin:wikipedia': true },
        webSearches: [],
      },
    } as Partial<SystemSettings>);
    initSettingsSync(diskSettings);

    // The same disk_default replayed (typical library page initLibrary flow).
    await publishSettingsIfChanged(diskSettings);

    // Structural fields primed from disk stay out of the diff — only the
    // hash-tracked connection metadata (if any) may publish.
    const patch = publishMock.mock.calls[0]?.[1].patch as Partial<SystemSettings> | undefined;
    expect(patch?.dictionarySettings?.providerEnabled).toBeUndefined();
    expect(patch?.globalReadSettings).toBeUndefined();
  });

  test('does NOT trigger the gate when only plaintext settings change', async () => {
    isUnlocked = false;
    await publishSettingsIfChanged(
      makeSettings({
        globalReadSettings: {
          ...baseHighlight,
          userHighlightColors: [{ name: 'mint', color: '#a8e6cf' }],
        } as unknown as SystemSettings['globalReadSettings'],
      }),
    );
    expect(ensurePassphraseMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledTimes(1);
  });
});

describe('applyRemoteSettings', () => {
  test('merges patch into useSettingsStore and persists', () => {
    const env = makeEnvConfig();
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        globalReadSettings: { userHighlightColors: userColors },
      } as unknown as Partial<SystemSettings>,
    });
    const merged = useSettingsStore.getState().settings;
    expect(merged.globalReadSettings.userHighlightColors).toEqual(userColors);
    // Existing globalReadSettings fields preserved by the deep merge.
    expect(merged.globalReadSettings.customHighlightColors).toEqual(
      baseHighlight.customHighlightColors,
    );
    expect(useSettingsStore.getState().saveSettings).toHaveBeenCalledTimes(1);
  });

  test('applying remote does NOT echo the remote field back on the next publish', async () => {
    await publishSettingsIfChanged(useSettingsStore.getState().settings);
    publishMock.mockReset();

    const env = makeEnvConfig();
    const userColors = [{ name: 'mint', color: '#a8e6cf' }];
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        globalReadSettings: { userHighlightColors: userColors },
      } as unknown as Partial<SystemSettings>,
    });
    publishMock.mockReset();

    await publishSettingsIfChanged(useSettingsStore.getState().settings);
    expect(publishMock).not.toHaveBeenCalled();
  });

  test('empty patch is a no-op', () => {
    const env = makeEnvConfig();
    const before = useSettingsStore.getState().settings;
    applyRemoteSettings(env, { name: 'singleton', patch: {} });
    expect(useSettingsStore.getState().settings).toBe(before);
    expect(useSettingsStore.getState().saveSettings).not.toHaveBeenCalled();
  });

  test('propagates dictionarySettings into useCustomDictionaryStore mirror', async () => {
    const { useCustomDictionaryStore } = await import('@/store/customDictionaryStore');
    useCustomDictionaryStore.setState({
      ...useCustomDictionaryStore.getState(),
      settings: {
        providerOrder: ['local-x'],
        providerEnabled: { 'local-x': true },
        defaultProviderId: 'local-x',
        webSearches: [],
      },
    });
    const env = makeEnvConfig();
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        dictionarySettings: {
          providerOrder: ['remote-y'],
          providerEnabled: { 'remote-y': true },
          webSearches: [{ id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' }],
        },
      } as unknown as Partial<SystemSettings>,
    });
    const dictMirror = useCustomDictionaryStore.getState().settings;
    expect(dictMirror.providerOrder).toEqual(['remote-y']);
    expect(dictMirror.providerEnabled).toEqual({ 'remote-y': true });
    expect(dictMirror.webSearches).toEqual([
      { id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' },
    ]);
    expect(dictMirror.defaultProviderId).toBe('local-x');
  });

  test('does NOT apply remote dictionarySettings when the dictionary category is OFF (issue #5465)', async () => {
    const { useCustomDictionaryStore } = await import('@/store/customDictionaryStore');
    const localDict = {
      providerOrder: ['local-x'],
      providerEnabled: { 'local-x': true },
      defaultProviderId: 'local-x',
      webSearches: [],
    };
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      settings: makeSettings({ dictionarySettings: localDict } as Partial<SystemSettings>),
    });
    setDictionarySync(false);
    useCustomDictionaryStore.setState({
      ...useCustomDictionaryStore.getState(),
      settings: { ...localDict },
    });

    applyRemoteSettings(makeEnvConfig(), {
      name: 'singleton',
      patch: {
        dictionarySettings: {
          providerOrder: ['remote-y'],
          providerEnabled: { 'remote-y': true },
          webSearches: [{ id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' }],
        },
        globalReadSettings: { userHighlightColors: [{ name: 'mint', color: '#a8e6cf' }] },
      } as unknown as Partial<SystemSettings>,
    });

    const merged = useSettingsStore.getState().settings;
    expect(merged.dictionarySettings.providerOrder).toEqual(['local-x']);
    expect(merged.dictionarySettings.providerEnabled).toEqual({ 'local-x': true });
    expect(merged.dictionarySettings.webSearches).toEqual([]);
    // Non-dictionary fields on the same row still apply.
    expect(merged.globalReadSettings.userHighlightColors).toEqual([
      { name: 'mint', color: '#a8e6cf' },
    ]);
    // The dictionary panel / reader popup mirror stays on the local values.
    expect(useCustomDictionaryStore.getState().settings.providerOrder).toEqual(['local-x']);
  });

  test('a dictionary-only remote patch is a no-op when the category is OFF', () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      settings: makeSettings({
        dictionarySettings: {
          providerOrder: ['local-x'],
          providerEnabled: { 'local-x': true },
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    });
    setDictionarySync(false);
    const before = useSettingsStore.getState().settings;
    applyRemoteSettings(makeEnvConfig(), {
      name: 'singleton',
      patch: {
        dictionarySettings: {
          providerOrder: ['remote-y'],
          providerEnabled: { 'remote-y': true },
          webSearches: [],
        },
      } as unknown as Partial<SystemSettings>,
    });
    expect(useSettingsStore.getState().settings).toBe(before);
    expect(useSettingsStore.getState().saveSettings).not.toHaveBeenCalled();
  });

  test('deep-merges dictionarySettings without clobbering local fields', () => {
    const env = makeEnvConfig();
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      settings: makeSettings({
        dictionarySettings: {
          providerOrder: ['local-x'],
          providerEnabled: { 'local-x': true },
          defaultProviderId: 'local-x',
          webSearches: [],
        },
      } as Partial<SystemSettings>),
    });
    applyRemoteSettings(env, {
      name: 'singleton',
      patch: {
        dictionarySettings: {
          providerOrder: ['remote-y'],
          providerEnabled: { 'remote-y': true },
          // defaultProviderId omitted — must NOT be cleared by the merge.
          webSearches: [{ id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' }],
        },
      } as unknown as Partial<SystemSettings>,
    });
    const merged = useSettingsStore.getState().settings.dictionarySettings;
    expect(merged.providerOrder).toEqual(['remote-y']);
    expect(merged.providerEnabled).toEqual({ 'remote-y': true });
    expect(merged.webSearches).toEqual([
      { id: 'web:remote-y', name: 'Y', urlTemplate: 'https://y/?q=%WORD%' },
    ]);
    // defaultProviderId is per-device — preserved by the deep-merge even
    // when the remote patch omits it.
    expect(merged.defaultProviderId).toBe('local-x');
  });
});
