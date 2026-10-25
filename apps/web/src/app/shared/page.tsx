'use client';

import { useCallback, useEffect, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useTheme } from '@/hooks/useTheme';
import { Toast } from '@/components/Toast';
import { listGrants, type BookGrant } from '@/libs/grants';
import { importGrantedBook } from '@/libs/grantImport';
import { navigateToReader } from '@/utils/nav';

const formatExpiry = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Books other people shared with the signed-in account. Opening one downloads
// it to this device for as long as the grant lasts.
const SharedWithMePage = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { appService } = useEnv();
  useTheme({ systemUIVisible: false });

  const [grants, setGrants] = useState<BookGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGrants(await listGrants('grantee'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not load shared books'));
    }
  }, [_]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOpen = async (grant: BookGrant) => {
    if (!appService || openingId) return;
    setOpeningId(grant.id);
    setError(null);
    try {
      const book = await importGrantedBook(grant, appService);
      navigateToReader(router, [book.hash]);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not open the shared book'));
      setOpeningId(null);
      // The grant may have just ended; show the current list.
      void load();
    }
  };

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <button
          type='button'
          onClick={() => router.push('/library')}
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Back to library')}
        >
          <IoArrowBack className='h-5 w-5' />
        </button>
        <h1 className='text-lg font-semibold'>{_('Shared with me')}</h1>
      </header>

      <main className='mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-10'>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
        {grants === null && !error && <span className='loading loading-dots loading-md' />}
        {grants?.length === 0 && (
          <p className='text-base-content/60 text-sm'>
            {_('Nobody has shared a book with you at the moment.')}
          </p>
        )}
        {grants && grants.length > 0 && (
          <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
            {grants.map((grant) => (
              <li key={grant.id} className='flex items-center justify-between gap-3 px-4 py-3'>
                <div className='min-w-0'>
                  <div className='truncate font-medium'>{grant.book_title}</div>
                  <div className='text-base-content/60 truncate text-xs'>
                    {[grant.book_author, grant.book_format.toUpperCase()]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className='text-base-content/60 truncate text-xs'>
                    {grant.owner_email
                      ? `${_('From {{email}}', { email: grant.owner_email })} · `
                      : ''}
                    {_('Until {{date}}', { date: formatExpiry(grant.expires_at) })}
                  </div>
                </div>
                <button
                  type='button'
                  onClick={() => handleOpen(grant)}
                  disabled={!!openingId}
                  className='btn btn-primary btn-sm shrink-0 rounded-xl'
                >
                  {openingId === grant.id ? (
                    <span className='loading loading-spinner loading-xs' />
                  ) : (
                    _('Open')
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Toast />
    </div>
  );
};

export default SharedWithMePage;
