import { jwtDecode } from 'jwt-decode';
import type { Session } from '@supabase/supabase-js';

/**
 * True when the user has a verified TOTP factor but the session has not passed
 * the second step yet (aal1 instead of aal2). Such a session must not count as
 * signed in.
 */
export const sessionNeedsMfa = (
  session: Pick<Session, 'access_token' | 'user'> | null | undefined,
): boolean => {
  if (!session) return false;
  const hasVerifiedFactor = (session.user.factors ?? []).some(
    (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
  );
  if (!hasVerifiedFactor) return false;
  try {
    return jwtDecode<{ aal?: string }>(session.access_token).aal !== 'aal2';
  } catch {
    return true;
  }
};
