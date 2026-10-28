import { describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { sessionNeedsMfa } from '@/utils/mfa';

const token = (aal: string) => `x.${btoa(JSON.stringify({ aal }))}.y`;

const session = (aal: string, factors: unknown[] = []) =>
  ({ access_token: token(aal), user: { factors } }) as unknown as Session;

const verified = { factor_type: 'totp', status: 'verified' };
const unverified = { factor_type: 'totp', status: 'unverified' };

describe('sessionNeedsMfa', () => {
  it('is false without a session', () => {
    expect(sessionNeedsMfa(null)).toBe(false);
  });

  it('is false when the user has no verified factor', () => {
    expect(sessionNeedsMfa(session('aal1'))).toBe(false);
    expect(sessionNeedsMfa(session('aal1', [unverified]))).toBe(false);
  });

  it('is true for an aal1 session with a verified factor', () => {
    expect(sessionNeedsMfa(session('aal1', [verified]))).toBe(true);
  });

  it('is false once the session reached aal2', () => {
    expect(sessionNeedsMfa(session('aal2', [verified]))).toBe(false);
  });
});
