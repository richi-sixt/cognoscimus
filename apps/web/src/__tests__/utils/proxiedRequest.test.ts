import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeCustomHeaders } from '@/utils/customHeaders';

// Mock environment for web platform
vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => true),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
  getBaseUrl: () => 'https://cognoscimus.sixt.services',
  getNodeBaseUrl: () => 'https://cognoscimus.sixt.services',
  isWebDevMode: () => true,
}));

describe('opdsReq', () => {
  let needsProxy: typeof import('@/utils/proxiedRequest').needsProxy;
  let getProxiedURL: typeof import('@/utils/proxiedRequest').getProxiedURL;
  let isWebAppPlatform: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const envModule = await import('@/services/environment');
    isWebAppPlatform = envModule.isWebAppPlatform as ReturnType<typeof vi.fn>;
    const opdsReq = await import('@/utils/proxiedRequest');
    needsProxy = opdsReq.needsProxy;
    getProxiedURL = opdsReq.getProxiedURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('needsProxy', () => {
    it('should return true for HTTP URLs on web platform', () => {
      isWebAppPlatform.mockReturnValue(true);
      expect(needsProxy('http://my-opds-server.local/covers/book.jpg')).toBe(true);
    });

    it('should return true for HTTPS URLs on web platform', () => {
      isWebAppPlatform.mockReturnValue(true);
      expect(needsProxy('https://opds.example.com/feed')).toBe(true);
    });

    it('should return false on native/Tauri platform', () => {
      isWebAppPlatform.mockReturnValue(false);
      expect(needsProxy('http://my-opds-server.local/covers/book.jpg')).toBe(false);
    });

    it('should return false for non-HTTP URLs', () => {
      isWebAppPlatform.mockReturnValue(true);
      expect(needsProxy('/local/path/image.jpg')).toBe(false);
      expect(needsProxy('data:image/png;base64,...')).toBe(false);
    });
  });

  describe('getProxiedURL', () => {
    it('should generate proxy URL for image requests without auth', () => {
      const imageUrl = 'http://my-opds-server.local/covers/book.jpg';
      const proxied = getProxiedURL(imageUrl, true);
      expect(proxied).toContain('/api/opds/proxy');
      expect(proxied).toContain('url=' + encodeURIComponent(imageUrl));
      expect(proxied).toContain('stream=true');
    });

    it('should include serialized custom headers in the proxy URL', () => {
      const imageUrl = 'http://my-opds-server.local/covers/book.jpg';
      const proxied = getProxiedURL(imageUrl, true, {
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'secret',
      });
      const params = new URL(proxied, 'https://cognoscimus.sixt.services').searchParams;

      expect(deserializeCustomHeaders(params.get('headers'))).toEqual({
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'secret',
      });
    });

    it('should strip credentials from URL before proxying', () => {
      const imageUrl = 'http://user:pass@my-opds-server.local/covers/book.jpg';
      const proxied = getProxiedURL(imageUrl);
      expect(proxied).not.toContain('user:pass');
      expect(proxied).toContain(
        'url=' + encodeURIComponent('http://my-opds-server.local/covers/book.jpg'),
      );
    });

    it('should return non-HTTP URLs unchanged', () => {
      const localPath = '/local/path/image.jpg';
      expect(getProxiedURL(localPath)).toBe(localPath);
    });

    it('should use node proxy for standardebooks domain', () => {
      const url = 'https://standardebooks.org/opds/all';
      const proxied = getProxiedURL(url);
      expect(proxied).toContain('/node-api/opds/proxy');
    });
  });
});
