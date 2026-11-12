import { describe, expect, it } from 'vitest';
import {
  hasPrintedCopy,
  isPhysicalFormat,
  isWish,
  readBorrowerName,
  readDueDate,
} from '@/libs/loansServer';

describe('isWish', () => {
  it('is true only for a printed entry that is not owned yet', () => {
    expect(isWish('PHYSICAL', { physical: { owned: false } })).toBe(true);
    expect(isWish('physical', JSON.stringify({ physical: { owned: false } }))).toBe(true);
    expect(isWish('PHYSICAL', { physical: { owned: true } })).toBe(false);
    expect(isWish('PHYSICAL', null)).toBe(false);
    expect(isWish('EPUB', { physical: { owned: false } })).toBe(false);
    expect(isWish('PHYSICAL', '{ broken')).toBe(false);
  });
});

describe('hasPrintedCopy', () => {
  it('holds for a printed entry and for a file book marked as also printed', () => {
    expect(hasPrintedCopy('PHYSICAL', null)).toBe(true);
    expect(hasPrintedCopy('PHYSICAL', { physical: { owned: false } })).toBe(false);
    expect(hasPrintedCopy('EPUB', { physical: { owned: true } })).toBe(true);
    expect(hasPrintedCopy('EPUB', {})).toBe(false);
    expect(isPhysicalFormat(null)).toBe(false);
  });
});

describe('readBorrowerName', () => {
  it('trims, collapses spaces and enforces the length', () => {
    expect(readBorrowerName('  Anna   Muster ')).toBe('Anna Muster');
    expect(readBorrowerName('   ')).toBeNull();
    expect(readBorrowerName('x'.repeat(81))).toBeNull();
    expect(readBorrowerName(7)).toBeNull();
  });
});

describe('readDueDate', () => {
  it('accepts a real day, nothing, and rejects the rest', () => {
    expect(readDueDate('2027-01-31')).toBe('2027-01-31T12:00:00.000Z');
    expect(readDueDate('')).toBeNull();
    expect(readDueDate(undefined)).toBeNull();
    expect(readDueDate('2027-02-31')).toBeUndefined();
    expect(readDueDate('31.01.2027')).toBeUndefined();
    expect(readDueDate(5)).toBeUndefined();
  });
});
