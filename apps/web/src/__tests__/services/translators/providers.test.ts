import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

// Mock environment module
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: vi.fn(() => 'https://api.example.com'),
}));

vi.mock('@/utils/misc', () => ({
  stubTranslation: (s: string) => s,
}));

// @/utils/lang is deliberately NOT mocked: the providers' language-code
// handling against the real normalizers is part of what these tests verify.
// A hand-rolled lang mock previously hid that normalizeToFullLang maximizes
// bare subtags ('en' -> 'en-US'), which Bing rejects with statusCode 400.

// Mock Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Stub Supabase so importing the full providers registry (which pulls in
// deepl.ts → @/utils/access → @/utils/supabase) doesn't instantiate a real
// GoTrueClient on every `vi.resetModules()` round. Without this, each test
// that dynamically imports the registry logs a "Multiple GoTrueClient
// instances" warning from the real Supabase client.
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  },
}));

vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn(async () => {}),
  // Stand-in for the real OpenCC conversion; the assertions only need to see
  // that the Simplified reply was routed through it with the right variant.
  runSimpleCC: vi.fn((text: string) => text.replace(/只/g, '隻').replace(/过/g, '過')),
}));

vi.mock('@/utils/access', () => ({
  getSubscriptionPlan: vi.fn(() => 'free'),
  getTranslationQuota: vi.fn(() => 1000),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Google Translate Provider
// ---------------------------------------------------------------------------
describe('googleProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(tauriFetch).mockReset();
    // Other suites flip the platform mock to Tauri; google must behave the same
    // either way, so start each test from the default.
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    // The provider keeps a module-level concurrency counter, so each test needs
    // a fresh module.
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[['Bonjour', 'Hello']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('preserves empty strings in input', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[['translated', 'original']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['', 'Hello'], 'en', 'fr');
    expect(result[0]).toBe('');
    expect(result[1]).toBe('translated');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    await expect(googleProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'Translation failed with status 500',
    );
  });

  it('falls back to original text when response format is unexpected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('caps concurrent requests instead of fanning out over the whole page', async () => {
    // The endpoint is unofficial and Google throttles it per client bucket. An
    // unbounded fan-out over a page of paragraphs is what earns the 429 page
    // ("your computer or network may be sending automated queries"), and the
    // block outlives the burst by many minutes.
    let inFlight = 0;
    let peakInFlight = 0;
    mockFetch.mockImplementation(async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { ok: true, status: 200, json: async () => [[['translated', 'original']]] };
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const lines = Array.from({ length: 24 }, (_, index) => `line ${index}`);
    const result = await googleProvider.translate(lines, 'en', 'zh-CN');

    expect(result).toHaveLength(24);
    expect(result.every((line) => line === 'translated')).toBe(true);
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(4);
    // Throttling must not drop work.
    expect(mockFetch).toHaveBeenCalledTimes(24);
  });

  it('goes through the webview stack even on Tauri, never the Rust HTTP plugin', async () => {
    // Google refuses the Tauri HTTP plugin's requests: measured on an Android
    // device, window.fetch answered 200 five times in a row while tauriFetch
    // answered 429 for the same URL in the same run, and the block on the Rust
    // client outlived a restart. The endpoint is CORS-open and already in the
    // app's connect-src CSP, so the webview stack works on every platform.
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [[['你好', 'Hello']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'zh-CN');

    expect(result).toEqual(['你好']);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(vi.mocked(tauriFetch)).not.toHaveBeenCalled();
  });

  it('surfaces a rate-limit rather than echoing the source text back', async () => {
    // A 429 means Google decided the traffic looks automated. Returning the
    // untranslated line would render as a silently untranslated paragraph.
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    const { googleProvider } = await import('@/services/translators/providers/google');
    await expect(googleProvider.translate(['Hello'], 'en', 'zh-CN')).rejects.toThrow(
      'Translation failed with status 429',
    );
  });

  it('has correct provider metadata', async () => {
    const { googleProvider } = await import('@/services/translators/providers/google');
    expect(googleProvider.name).toBe('google');
    expect(googleProvider.label).toBe('Google Translate');
  });
});

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
describe('provider registry availability handling', () => {
  // No `vi.resetModules()` here — these tests only inspect static provider
  // metadata, so resolving the registry once is enough. Resetting between
  // each test would re-evaluate the full import chain and churn module
  // state for no benefit.

  it('isTranslatorAvailable returns false for disabled providers', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const disabled = { name: 'x', label: 'X', disabled: true, translate: async () => [] };
    expect(isTranslatorAvailable(disabled, true, true)).toBe(false);
    expect(isTranslatorAvailable(disabled, false, false)).toBe(false);
  });

  it('isTranslatorAvailable returns false for authRequired without token', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const authed = { name: 'x', label: 'X', authRequired: true, translate: async () => [] };
    expect(isTranslatorAvailable(authed, false, false)).toBe(false);
    expect(isTranslatorAvailable(authed, true, false)).toBe(true);
  });

  it('isTranslatorAvailable returns false when quota is exceeded', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const exhausted = { name: 'x', label: 'X', quotaExceeded: true, translate: async () => [] };
    expect(isTranslatorAvailable(exhausted, true, false)).toBe(false);
  });

  it('getTranslatorDisplayLabel returns the plain label for healthy providers', async () => {
    const { getTranslator, getTranslatorDisplayLabel } = await import(
      '@/services/translators/providers'
    );
    const google = getTranslator('google')!;
    expect(getTranslatorDisplayLabel(google, true, false, (s) => s)).toBe('Google Translate');
  });
});

// ---------------------------------------------------------------------------
// Inline-markup capability (#1582)
// ---------------------------------------------------------------------------
describe('preservesMarkup capability', () => {
  it('is enabled only for providers verified against their live API', async () => {
    const { getTranslators } = await import('@/services/translators');
    const capable = getTranslators()
      .filter((translator) => translator.preservesMarkup)
      .map((translator) => translator.name)
      .sort();
    // Google repositions inline tags onto the matching words.
    expect(capable).toEqual(['google']);
  });
});
