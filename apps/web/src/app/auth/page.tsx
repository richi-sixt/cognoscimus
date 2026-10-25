'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';
import { useTheme } from '@/hooks/useTheme';
import AuthPanel from './components/AuthPanel';

// Only same-origin paths may be used as a post-login target (no open redirect).
const safeRedirect = (target: string | null): string =>
  target && target.startsWith('/') && !target.startsWith('//') ? target : '/library';

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [isMounted, setIsMounted] = useState(false);

  useTheme({ systemUIVisible: false });

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token && session.user) {
        login(session.access_token, session.user);
        const redirectTo = safeRedirect(
          new URLSearchParams(window.location.search).get('redirect'),
        );
        const lastRedirectAtKey = 'lastRedirectAt';
        const lastRedirectAt = parseInt(localStorage.getItem(lastRedirectAtKey) || '0', 10);
        const now = Date.now();
        localStorage.setItem(lastRedirectAtKey, now.toString());
        if (now - lastRedirectAt > 3000) {
          router.push(redirectTo);
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
      <AuthPanel
        supabaseClient={supabase}
        magicLink={true}
        redirectTo={`${window.location.origin}/auth/callback`}
      />
    </div>
  );
}
