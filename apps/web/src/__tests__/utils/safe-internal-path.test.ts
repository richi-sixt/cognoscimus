import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '@/utils/nav';

// A post-login target comes from the address bar. Only paths inside the app may pass;
// browsers read a backslash as '/', so '/\host' leaves the app like '//host' does.

describe('safeInternalPath', () => {
  it('keeps paths inside the app, with their query', () => {
    expect(safeInternalPath('/later')).toBe('/later');
    expect(safeInternalPath('/reader/abc?cfi=1')).toBe('/reader/abc?cfi=1');
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/a\\b',
    'https://evil.example',
    'javascript:alert(1)',
    '',
  ])('turns %j into the fallback', (target) => {
    expect(safeInternalPath(target)).toBe('/library');
  });

  it('falls back for a missing target and takes a custom fallback', () => {
    expect(safeInternalPath(null)).toBe('/library');
    expect(safeInternalPath(undefined, '/')).toBe('/');
  });
});
