import { CAPTURED_HTML_MAX } from './constants';

export type CapturedHtml =
  | { ok: true; html: string | null }
  | { ok: false; code: 'invalid_html' | 'too_large' };

/**
 * Checks the page HTML a browser extension sent along with a link. It is as
 * untrusted as a downloaded page and goes through the same extraction; this
 * only keeps its size in bounds. Nothing sent means the server fetches the page.
 */
export const readCapturedHtml = (value: unknown): CapturedHtml => {
  if (value === undefined || value === null) return { ok: true, html: null };
  if (typeof value !== 'string') return { ok: false, code: 'invalid_html' };
  if (value.length > CAPTURED_HTML_MAX) return { ok: false, code: 'too_large' };
  return { ok: true, html: value.trim() ? value : null };
};
