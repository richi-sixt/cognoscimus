import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoragePlanData } from '@/utils/access';

const GIB = 1024 ** 3;

const token = (claims: Record<string, unknown>) => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.`;
};

afterEach(() => vi.unstubAllEnvs());

describe('getStoragePlanData owner limit', () => {
  it('gives the owner the larger limit, ignoring case and spaces', () => {
    vi.stubEnv('STORAGE_FIXED_QUOTA', String(50 * GIB));
    vi.stubEnv('STORAGE_OWNER_EMAIL', ' Owner@Example.com ');
    vi.stubEnv('STORAGE_OWNER_QUOTA', String(200 * GIB));
    expect(getStoragePlanData(token({ email: 'owner@example.com' })).quota).toBe(200 * GIB);
  });

  it('leaves everyone else at the normal limit', () => {
    vi.stubEnv('STORAGE_FIXED_QUOTA', String(50 * GIB));
    vi.stubEnv('STORAGE_OWNER_EMAIL', 'owner@example.com');
    vi.stubEnv('STORAGE_OWNER_QUOTA', String(200 * GIB));
    expect(getStoragePlanData(token({ email: 'other@example.com' })).quota).toBe(50 * GIB);
    expect(getStoragePlanData(token({})).quota).toBe(50 * GIB);
  });

  it('does nothing when either variable is missing or the limit is not a number', () => {
    vi.stubEnv('STORAGE_FIXED_QUOTA', String(50 * GIB));
    vi.stubEnv('STORAGE_OWNER_EMAIL', 'owner@example.com');
    vi.stubEnv('STORAGE_OWNER_QUOTA', 'lots');
    expect(getStoragePlanData(token({ email: 'owner@example.com' })).quota).toBe(50 * GIB);
    vi.stubEnv('STORAGE_OWNER_EMAIL', '');
    vi.stubEnv('STORAGE_OWNER_QUOTA', String(200 * GIB));
    expect(getStoragePlanData(token({ email: 'owner@example.com' })).quota).toBe(50 * GIB);
  });
});
