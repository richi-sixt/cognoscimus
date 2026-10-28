'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { hardNavigate } from '@/utils/hardNavigate';

// cognoscimus is private: everything except the start page and the sign-in routes needs a
// session.
// The session is read from localStorage on the first client render, so a signed-in
// user is never bounced; an expired one is cleared by AuthProvider and lands here.
const isPublicPath = (pathname: string) =>
  pathname === '/' || pathname === '/auth' || pathname.startsWith('/auth/');

const AuthGate = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const blocked = mounted && !user && !isPublicPath(window.location.pathname);

  useEffect(() => {
    if (!blocked) return;
    const target = window.location.pathname + window.location.search;
    hardNavigate(`/auth?redirect=${encodeURIComponent(target)}`);
  }, [blocked]);

  if (blocked) return null;
  return <>{children}</>;
};

export default AuthGate;
