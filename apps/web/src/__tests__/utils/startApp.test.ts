import { describe, expect, it } from 'vitest';
import { startAppOf, startPathOf } from '@/utils/startApp';

describe('start app', () => {
  it('is the library unless the account chose Later', () => {
    expect(startAppOf(null)).toBe('library');
    expect(startAppOf({ user_metadata: {} })).toBe('library');
    expect(startAppOf({ user_metadata: { start_app: 'something' } })).toBe('library');
    expect(startAppOf({ user_metadata: { start_app: 'later' } })).toBe('later');
  });
  it('maps to the path to open', () => {
    expect(startPathOf({ user_metadata: { start_app: 'later' } })).toBe('/later');
    expect(startPathOf(undefined)).toBe('/library');
  });
});
