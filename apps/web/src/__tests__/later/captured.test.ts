import { describe, expect, it } from 'vitest';
import { readCapturedHtml } from '@/libs/later/captured';
import { CAPTURED_HTML_MAX } from '@/libs/later/constants';

describe('readCapturedHtml', () => {
  it('treats missing or blank input as nothing sent', () => {
    expect(readCapturedHtml(undefined)).toEqual({ ok: true, html: null });
    expect(readCapturedHtml(null)).toEqual({ ok: true, html: null });
    expect(readCapturedHtml('  \n')).toEqual({ ok: true, html: null });
  });
  it('passes HTML through unchanged', () => {
    const html = '<html><body><p>Text</p></body></html>';
    expect(readCapturedHtml(html)).toEqual({ ok: true, html });
  });
  it('rejects anything that is not a string', () => {
    expect(readCapturedHtml(42)).toEqual({ ok: false, code: 'invalid_html' });
    expect(readCapturedHtml({ html: 'x' })).toEqual({ ok: false, code: 'invalid_html' });
  });
  it('rejects HTML over the limit and accepts it at the limit', () => {
    expect(readCapturedHtml('a'.repeat(CAPTURED_HTML_MAX))).toMatchObject({ ok: true });
    expect(readCapturedHtml('a'.repeat(CAPTURED_HTML_MAX + 1))).toEqual({
      ok: false,
      code: 'too_large',
    });
  });
});
