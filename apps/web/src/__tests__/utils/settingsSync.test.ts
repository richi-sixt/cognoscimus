import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' })),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

import { emit } from '@tauri-apps/api/event';
import { getDefaultViewSettings } from '@/services/settingsService';
import { DEFAULT_SYSTEM_SETTINGS, DEFAULT_READSETTINGS } from '@/services/constants';
import { broadcastGlobalSettings, type SettingsSyncPayload } from '@/utils/settingsSync';

// Real SystemSettings fixture built from the app's own default-settings
// factories (the same ones `loadSettings` uses), so this exercises the real
// `broadcastGlobalSettings` end to end instead of mocking the whole module.
const defaultGlobalViewSettings = getDefaultViewSettings({
  fs: {} as FileSystem,
  isMobile: false,
  isEink: false,
  isAppDataSandbox: false,
});

function makeFullSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    version: 1,
    localBooksDir: '/books',
    customFonts: [],
    customTextures: [],
    opdsCatalogs: [],
    savedBookCoverForLockScreen: '',
    savedBookCoverForLockScreenPath: '',
    globalReadSettings: DEFAULT_READSETTINGS,
    globalViewSettings: defaultGlobalViewSettings,
    ...overrides,
  } as SystemSettings;
}

describe('broadcastGlobalSettings: cognoscimusCloud in the emitted payload', () => {
  beforeEach(() => {
    vi.mocked(emit).mockClear();
  });

  const capturePayload = (): SettingsSyncPayload => {
    const call = vi.mocked(emit).mock.calls[0];
    return call![1] as SettingsSyncPayload;
  };

  test('omits the cognoscimusCloud key entirely when settings has no cognoscimusCloud slice', async () => {
    const settings = makeFullSettings();
    expect(settings.cognoscimusCloud).toBeUndefined();

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    expect(payload.cloudSyncProviders).toBeDefined();
    // A key present with value `undefined` is NOT the same as an absent key:
    // the receiving window's merge only touches `cognoscimusCloud` `if
    // (payload.cloudSyncProviders.cognoscimusCloud)`, so an explicit `{ enabled:
    // undefined }` would still be truthy and would clobber the receiver.
    expect('cognoscimusCloud' in payload.cloudSyncProviders!).toBe(false);
  });

  test('carries enabled:false and disabledAt faithfully', async () => {
    const settings = makeFullSettings({
      cognoscimusCloud: { enabled: false, disabledAt: 1234 },
    });

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    expect(payload.cloudSyncProviders?.cognoscimusCloud).toEqual({
      enabled: false,
      disabledAt: 1234,
    });
  });

  test('carries enabled:true', async () => {
    const settings = makeFullSettings({
      cognoscimusCloud: { enabled: true },
    });

    await broadcastGlobalSettings(settings, { includeCloudSyncProviders: true });

    const payload = capturePayload();
    expect(payload.cloudSyncProviders?.cognoscimusCloud?.enabled).toBe(true);
  });
});
