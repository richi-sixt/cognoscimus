/**
 * Leave the current page with a full document load instead of a client-side
 * route change. Used for the sign-in redirect: a soft navigation from a
 * gated page to /auth left the production build on an empty page until a
 * manual refresh, and a fresh load also drops everything the signed-out
 * visitor's page held in memory.
 */
export const hardNavigate = (url: string): void => {
  window.location.replace(url);
};
