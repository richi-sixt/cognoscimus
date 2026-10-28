'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import Landing from '@/components/landing/Landing';
import LibraryPage from './library/page';

// Visitors see the public start page; a signed-in user goes straight to the
// library. The session comes from localStorage, so the choice waits for the
// first client render to keep the server-rendered HTML and hydration identical.
export default function HomePage() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return mounted && user ? <LibraryPage /> : <Landing />;
}
