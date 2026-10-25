import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  stat: vi.fn(),
  isTauriAppPlatform: vi.fn(() => false),
  isIOSApp: false,
  servers: [] as Array<{ url: string; deletedAt?: number; allowSelfSignedCert?: boolean }>,
  settingsServers: [] as Array<{ url: string; deletedAt?: number; allowSelfSignedCert?: boolean }>,
  bookorbit: undefined as
    | { serverUrl: string; password?: string; allowSelfSignedCert?: boolean }
    | undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: mocks.stat }));

vi.mock('@/services/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/environment')>();
  return {
    ...actual,
    isTauriAppPlatform: mocks.isTauriAppPlatform,
    getInitializedAppService: () => ({ isIOSApp: mocks.isIOSApp }),
  };
});

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: { absServers: mocks.settingsServers, bookorbit: mocks.bookorbit },
    }),
  },
}));

import { getLocalMediaUrl, proxiedMediaUrl } from '@/services/audiobook/mediaProxy';

describe('getMediaProxyBase (#6216)', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.isTauriAppPlatform.mockReturnValue(true);
    mocks.isIOSApp = false;
    mocks.servers = [];
    mocks.settingsServers = [];
    mocks.bookorbit = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never starts a proxy on the web, where fetch and media share one TLS policy', async () => {
    mocks.isTauriAppPlatform.mockReturnValue(false);
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  // Read from the app service, not the user agent: iPadOS sends a desktop one (#6974).
  it('never starts a proxy in the iOS app, whose AVPlayer clocks take the direct URL', async () => {
    mocks.isIOSApp = true;
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  // A certificate belongs to the origin (host:port), so servers sharing one
  // share its policy: if any of them turned the option off, it is verified
  // for all of them, whichever call registers the origin.

  // The player route can open before the store is hydrated from settings; the
  // book's server (and its origin) still resolves from settings.absServers, so
  // the allowlist must include it or the proxy refuses the opened track (#6216).

  it('degrades to direct streaming when the proxy cannot start, and retries on the next open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.invoke.mockRejectedValueOnce(new Error('bind failed'));
    mocks.invoke.mockResolvedValueOnce('http://127.0.0.1:5/s');
    const { getMediaProxyBase: fresh } = await import('@/services/audiobook/mediaProxy');

    await expect(fresh()).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    await expect(fresh()).resolves.toBe('http://127.0.0.1:5/s');
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });
});

describe('proxiedMediaUrl', () => {
  it('wraps the upstream URL, token and all, as one encoded query value', () => {
    const upstream = 'https://abs.example/api/items/i1/file/2?token=a+b&c=d';
    expect(proxiedMediaUrl('http://127.0.0.1:41234/s3cret', upstream)).toBe(
      `http://127.0.0.1:41234/s3cret/media?u=${encodeURIComponent(upstream)}`,
    );
  });
});

describe('getLocalMediaUrl (#6848)', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.stat.mockReset();
    mocks.isTauriAppPlatform.mockReturnValue(true);
    mocks.isIOSApp = false;
  });

  it('registers the whole file as one window, so a long recording streams past 1 MB', async () => {
    mocks.stat.mockResolvedValue({ size: 285_530_804 });
    mocks.invoke.mockResolvedValue('http://127.0.0.1:5/s/file/abc');

    await expect(getLocalMediaUrl('/books/h/audiobook/big.m4a', 'audio/mp4')).resolves.toBe(
      'http://127.0.0.1:5/s/file/abc',
    );
    expect(mocks.stat).toHaveBeenCalledWith('/books/h/audiobook/big.m4a');
    expect(mocks.invoke).toHaveBeenCalledWith('get_media_file_url', {
      path: '/books/h/audiobook/big.m4a',
      start: 0,
      end: 285_530_804,
      contentType: 'audio/mp4',
    });
  });

  it('returns null when the file cannot be read, so the caller keeps its own URL', async () => {
    mocks.stat.mockRejectedValue(new Error('forbidden path'));

    await expect(getLocalMediaUrl('/elsewhere/a.mp3', 'audio/mpeg')).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
