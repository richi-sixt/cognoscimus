'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import ImportRaindrop from '../components/ImportRaindrop';
import SaveFromAnywhere from '../components/SaveFromAnywhere';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { loadPending } from '@/libs/later/client';

// Tools that are set up once rather than used while reading: saving from
// other pages and apps, and the import from Raindrop.
const LaterSettingsPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater%2Fsettings');
  }, [mounted, user]);

  // Fetches the article text of the links that were just imported.
  const loadImported = async () => {
    if (loadProgress) return;
    setError(null);
    setLoaded(false);
    setLoadProgress({ done: 0, total: 0 });
    try {
      await loadPending((done, total) => setLoadProgress({ done, total }));
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setLoadProgress(null);
    }
  };

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <Link href='/later' className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
          <IoArrowBack className='h-5 w-5' />
        </Link>
        <h1 className='text-lg font-semibold'>{_('Settings')}</h1>
      </header>

      <main className='mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-16'>
        <SaveFromAnywhere />
        <ImportRaindrop onImported={() => void loadImported()} />

        {loadProgress && (
          <p className='bg-base-200/60 rounded-2xl px-4 py-3 text-sm' role='status'>
            {_('Loading articles {{done}} / {{total}}', loadProgress)}
          </p>
        )}
        {loaded && (
          <Link href='/later' className='btn btn-sm w-fit'>
            {_('Back to the list')}
          </Link>
        )}
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
      </main>
    </div>
  );
};

export default LaterSettingsPage;
