'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import Landing from '@/components/landing/Landing';

// Visitors see the public start page; a signed-in user goes straight to the
// library (Later is one click away in its header). The session comes from
// localStorage, so the decision waits for the first client render to keep the
// server-rendered HTML and hydration identical.
export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && user) router.replace('/library');
  }, [mounted, user, router]);

  return mounted && user ? null : <Landing />;
}
