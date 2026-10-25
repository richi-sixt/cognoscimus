'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

// cognoscimus is private: everything except the sign-in routes needs a session.
// The session is read from localStorage on the first client render, so a signed-in
// user is never bounced; an expired one is cleared by AuthProvider and lands here.
const isPublicPath = (pathname: string) => pathname === '/auth' || pathname.startsWith('/auth/');

const AuthGate = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const blocked = mounted && !user && !isPublicPath(window.location.pathname);

  useEffect(() => {
    if (!blocked) return;
    const target = window.location.pathname + window.location.search;
    router.replace(`/auth?redirect=${encodeURIComponent(target)}`);
  }, [blocked, router]);

  if (blocked) return null;
  return <>{children}</>;
};

export default AuthGate;
