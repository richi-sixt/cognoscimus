import { getAPIBaseUrl, getNodeAPIBaseUrl, isWebAppPlatform } from '@/services/environment';
import { CustomHeaders, serializeCustomHeaders } from '@/utils/customHeaders';

const OPDS_PROXY_URL = `${getAPIBaseUrl()}/opds/proxy`;
const NODE_OPDS_PROXY_URL = `${getNodeAPIBaseUrl()}/opds/proxy`;
/**
 * Extract username and password from URL credentials
 */
const extractCredentialsFromURL = (
  url: string,
): { url: string; username?: string; password?: string } => {
  try {
    const urlObj = new URL(url);
    const username = decodeURIComponent(urlObj.username) || undefined;
    const password = decodeURIComponent(urlObj.password) || undefined;

    if (username || password) {
      urlObj.username = '';
      urlObj.password = '';
      return {
        url: urlObj.toString(),
        username,
        password,
      };
    }
  } catch (e) {
    console.warn('Failed to parse URL:', e);
  }

  return { url };
};

export const needsProxy = (url: string): boolean => {
  return isWebAppPlatform() && url.startsWith('http');
};

const PROXY_OVERRIDES: Record<string, string> = {
  standardebooks: NODE_OPDS_PROXY_URL,
};

const getProxyBaseUrl = (url: string): string => {
  for (const [domain, proxyUrl] of Object.entries(PROXY_OVERRIDES)) {
    if (url.includes(domain)) {
      return proxyUrl;
    }
  }
  return OPDS_PROXY_URL;
};

/**
 * Generate proxied URL for OPDS requests
 */
export const getProxiedURL = (
  url: string,
  stream = false,
  customHeaders: CustomHeaders = {},
): string => {
  if (url.startsWith('http')) {
    const { url: cleanUrl } = extractCredentialsFromURL(url);
    const params = new URLSearchParams();
    params.append('url', cleanUrl);
    params.append('stream', `${stream}`);
    const serializedHeaders = serializeCustomHeaders(customHeaders);
    if (serializedHeaders) {
      params.append('headers', serializedHeaders);
    }
    const baseUrl = getProxyBaseUrl(url);
    const proxyUrl = `${baseUrl}?${params.toString()}`;
    return proxyUrl;
  }
  return url;
};
