import { describe, expect, it } from 'vitest';
import {
  hashExtensionToken,
  isExtensionToken,
  newExtensionToken,
} from '@/libs/later/extensionAuth';
import { readLabelNames, readNote, readTokenName } from '@/libs/later/extensionInput';

describe('extension tokens', () => {
  it('creates tokens that pass the format check and differ each time', () => {
    const a = newExtensionToken();
    const b = newExtensionToken();
    expect(isExtensionToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('does not take a session token or junk for an extension token', () => {
    expect(isExtensionToken('eyJhbGciOiJFUzI1NiJ9.e30.sig')).toBe(false);
    expect(isExtensionToken('cgl_short')).toBe(false);
    expect(isExtensionToken(undefined)).toBe(false);
  });
  it('hashes to 64 hex characters, the same for the same token', () => {
    const token = newExtensionToken();
    expect(hashExtensionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashExtensionToken(token)).toBe(hashExtensionToken(token));
    expect(hashExtensionToken(token)).not.toBe(hashExtensionToken(newExtensionToken()));
  });
});

describe('extension input', () => {
  it('trims notes and turns empty ones into null', () => {
    expect(readNote('  hi ')).toBe('hi');
    expect(readNote('   ')).toBeNull();
    expect(readNote(null)).toBeNull();
    expect(readNote(5)).toBeUndefined();
    expect(readNote('a'.repeat(2001))).toBeUndefined();
  });
  it('trims label names and drops repeats regardless of case', () => {
    expect(readLabelNames([' Reading', 'reading', 'Tech'])).toEqual(['Reading', 'Tech']);
    expect(readLabelNames([])).toEqual([]);
  });
  it('refuses labels that are not short strings, and too many of them', () => {
    expect(readLabelNames('reading')).toBeNull();
    expect(readLabelNames(['ok', 3])).toBeNull();
    expect(readLabelNames([''])).toBeNull();
    expect(readLabelNames(['a'.repeat(41)])).toBeNull();
    expect(readLabelNames(Array.from({ length: 21 }, (_, i) => `l${i}`))).toBeNull();
  });
  it('falls back to a generic name for a connected browser', () => {
    expect(readTokenName(' Firefox ')).toBe('Firefox');
    expect(readTokenName(undefined)).toBe('Browser');
    expect(readTokenName('x'.repeat(200))).toHaveLength(80);
  });
});
