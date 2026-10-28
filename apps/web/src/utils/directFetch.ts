/**
 * User-configured services (custom translators, custom speech endpoints) call
 * arbitrary third-party HTTP endpoints the user typed into settings. The
 * browser's `window.fetch` is subject to CORS preflight, so the upstream server
 * has to send the right `Access-Control-Allow-*` headers.
 */
export const getDirectFetch = (): typeof fetch => window.fetch.bind(window);
