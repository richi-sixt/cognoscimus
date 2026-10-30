'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';
import { useTheme } from '@/hooks/useTheme';
import { sessionNeedsMfa } from '@/utils/mfa';
import AuthPanel from './components/AuthPanel';
import MfaChallenge from './components/MfaChallenge';

// Only same-origin paths may be used as a post-login target (no open redirect).
const safeRedirect = (target: string | null): string =>
  target && target.startsWith('/') && !target.startsWith('//') ? target : '/library';

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [isMounted, setIsMounted] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);

  useTheme();

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setMfaPending(sessionNeedsMfa(session));
      if (session?.access_token && session.user && !sessionNeedsMfa(session)) {
        login(session.access_token, session.user);
        const redirectTo = safeRedirect(
          new URLSearchParams(window.location.search).get('redirect'),
        );
        const lastRedirectAtKey = 'lastRedirectAt';
        const lastRedirectAt = parseInt(localStorage.getItem(lastRedirectAtKey) || '0', 10);
        const now = Date.now();
        localStorage.setItem(lastRedirectAtKey, now.toString());
        if (now - lastRedirectAt > 3000) {
          // /later is served without cross-origin isolation: it needs a full page load.
          if (redirectTo === '/later' || redirectTo.startsWith('/later/')) {
            window.location.assign(redirectTo);
          } else {
            router.push(redirectTo);
          }
        }
      }
    });

    return () => {
      subscription?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return (
    <div className='bg-base-100 flex min-h-screen flex-col items-center overflow-y-auto px-6 pb-12 pt-20'>
      {mfaPending ? (
        <div className='flex w-full max-w-sm flex-col items-center gap-6'>
          <MfaChallenge supabaseClient={supabase} />
        </div>
      ) : (
        <AuthPanel
          supabaseClient={supabase}
          magicLink={true}
          redirectTo={`${window.location.origin}/auth/callback`}
        />
      )}
    </div>
  );
}
