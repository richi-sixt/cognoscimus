import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

/**
 * User-configured services (custom translators, custom speech endpoints) call
 * arbitrary third-party HTTP endpoints the user typed into settings. In a
 * browser context `window.fetch` is subject to CORS preflight; the native app
 * can use the Tauri HTTP plugin instead, which sends the request from the Rust
 * side with no Origin header and no preflight. On the web there is no
 * alternative: the upstream server has to send the right
 * `Access-Control-Allow-*` headers.
 */
export const getDirectFetch = (): typeof fetch => {
  if (isTauriAppPlatform()) {
    // tauriFetch matches the standard `fetch` signature, so ai-sdk
    // providers can take it directly via their `fetch` option.
    return tauriFetch as unknown as typeof fetch;
  }
  return window.fetch.bind(window);
};
