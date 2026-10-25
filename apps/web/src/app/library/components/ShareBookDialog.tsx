'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { IoPersonAddOutline } from 'react-icons/io5';
import Dialog from '@/components/Dialog';
import SegmentedControl from '@/components/SegmentedControl';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { Book } from '@/types/book';
import { GRANT_DEFAULT_EXPIRATION_DAYS, GRANT_EXPIRATION_DAYS } from '@/services/constants';
import { createGrant, listGrants, revokeGrant, type BookGrant } from '@/libs/grants';
import { formatBytes } from '@/utils/book';
import { useSettingsStore } from '@/store/settingsStore';
import { isCognoscimusCloudStorageActive } from '@/services/sync/cloudSyncProvider';

interface ShareBookDialogProps {
  isOpen: boolean;
  book: Book | null;
  onClose: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// A grant is shown as active until it expires or is revoked; the server decides
// access, this only drives the labels.
const isActive = (g: BookGrant) => !g.revoked_at && new Date(g.expires_at).getTime() > Date.now();

const ShareBookDialog: React.FC<ShareBookDialogProps> = ({ isOpen, book, onClose }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);

  const [email, setEmail] = useState('');
  const [expirationDays, setExpirationDays] = useState<number>(GRANT_DEFAULT_EXPIRATION_DAYS);
  const [sharing, setSharing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [grants, setGrants] = useState<BookGrant[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);

  const bookHash = book?.hash;

  const loadGrants = useCallback(async () => {
    if (!bookHash) return;
    try {
      const all = await listGrants('owner');
      setGrants(all.filter((g) => g.book_hash === bookHash));
    } catch {
      // The list is secondary to sharing; the form still works without it.
      setGrants([]);
    }
  }, [bookHash]);

  // Reset transient state every time the dialog opens for a book.
  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setExpirationDays(GRANT_DEFAULT_EXPIRATION_DAYS);
    setSharing(false);
    setUploadProgress(null);
    setErrorMessage(null);
    setGrants([]);
    setRevokingId(null);
    setFileSize(null);
    void loadGrants();
  }, [isOpen, loadGrants]);

  // File size is decorative; a cloud-only book has no local file to measure.
  useEffect(() => {
    if (!isOpen || !book || !appService) return;
    let cancelled = false;
    (async () => {
      try {
        const size = await appService.getBookFileSize(book);
        if (!cancelled) setFileSize(size);
      } catch {
        // leave null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, book?.hash, appService]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!book) return null;

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sharing || !email.trim()) return;
    setSharing(true);
    setErrorMessage(null);
    try {
      // The recipient downloads from our storage, so the book has to be there.
      // `uploadedAt` alone doesn't prove that: the file-sync engine also stamps
      // it for a book whose only cloud copy is on a third-party provider.
      const inCognoscimusStorage = !!book.uploadedAt && isCognoscimusCloudStorageActive(settings);
      if (!inCognoscimusStorage && appService) {
        try {
          await appService.uploadBook(book, (progress) => {
            setUploadProgress((progress.progress / progress.total) * 100);
          });
        } finally {
          setUploadProgress(null);
        }
      }

      await createGrant({ bookHash: book.hash, granteeEmail: email.trim(), expirationDays });
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Book shared with {{email}}', { email: email.trim() }),
        timeout: 2500,
      });
      setEmail('');
      await loadGrants();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : _('Could not share the book'));
    } finally {
      setSharing(false);
    }
  };

  const handleRevoke = async (grant: BookGrant) => {
    setRevokingId(grant.id);
    setErrorMessage(null);
    try {
      await revokeGrant(grant.id);
      await loadGrants();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : _('Could not revoke access'));
    } finally {
      setRevokingId(null);
    }
  };

  const activeGrants = grants.filter(isActive);

  return (
    <Dialog
      isOpen={isOpen}
      title={_('Share Book')}
      onClose={onClose}
      boxClassName='sm:min-w-[460px] sm:max-w-[460px] sm:h-auto sm:max-h-[90%]'
      contentClassName='px-6! py-4!'
    >
      <div className='flex flex-col gap-5 pt-2'>
        <div className='flex items-center gap-4'>
          {book.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverImageUrl}
              alt=''
              className='h-28 w-20 shrink-0 rounded-lg object-cover shadow-md'
              loading='lazy'
            />
          ) : (
            <div className='bg-base-200 flex h-28 w-20 shrink-0 items-center justify-center rounded-lg shadow-md'>
              <IoPersonAddOutline className='text-base-content/30 h-8 w-8' aria-hidden='true' />
            </div>
          )}
          <div className='min-w-0 flex-1'>
            <div className='text-base-content line-clamp-2 text-lg font-semibold leading-tight'>
              {book.title}
            </div>
            <div className='text-base-content/60 mt-1.5 truncate text-sm'>
              {[book.author, book.format, formatBytes(fileSize)].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        <form onSubmit={handleShare} className='flex flex-col gap-4'>
          <div className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
            <label className='flex min-h-12 items-center justify-between gap-3 px-4 py-2'>
              <span className='text-base-content text-sm font-medium'>{_('Email')}</span>
              <input
                type='email'
                required
                autoComplete='off'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sharing}
                placeholder='name@example.com'
                className='text-base-content min-w-0 flex-1 bg-transparent text-right text-sm outline-hidden'
              />
            </label>
            <div className='flex min-h-12 items-center justify-between gap-3 px-4 py-2'>
              <span className='text-base-content text-sm font-medium'>{_('Access for')}</span>
              <SegmentedControl<number>
                ariaLabel={_('Access for')}
                value={expirationDays}
                onChange={setExpirationDays}
                disabled={sharing}
                options={GRANT_EXPIRATION_DAYS.map((n) => ({
                  value: n,
                  label: _('{{count}} days', { count: n }),
                }))}
              />
            </div>
          </div>

          {uploadProgress !== null && (
            <div>
              <div className='text-base-content/70 mb-1.5 text-xs'>
                {_('Uploading book…')} {Math.round(uploadProgress)}%
              </div>
              <progress
                className='progress progress-primary w-full'
                value={uploadProgress}
                max={100}
              />
            </div>
          )}

          {errorMessage && (
            <p className='text-error text-xs' role='alert'>
              {errorMessage}
            </p>
          )}

          <button
            type='submit'
            disabled={sharing || !email.trim()}
            className='btn btn-primary btn-block gap-2 rounded-2xl'
          >
            <IoPersonAddOutline className='h-5 w-5' aria-hidden='true' />
            {sharing ? _('Sharing…') : _('Share')}
          </button>
        </form>

        {activeGrants.length > 0 && (
          <div className='flex flex-col gap-2'>
            <div className='text-base-content/70 text-xs font-medium uppercase'>
              {_('Shared with')}
            </div>
            <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
              {activeGrants.map((grant) => (
                <li key={grant.id} className='flex items-center justify-between gap-3 px-4 py-2'>
                  <div className='min-w-0'>
                    <div className='truncate text-sm'>
                      {grant.grantee_email ?? _('Unknown user')}
                    </div>
                    <div className='text-base-content/60 text-xs'>
                      {_('Until {{date}}', { date: formatDate(grant.expires_at) })}
                    </div>
                  </div>
                  <button
                    type='button'
                    onClick={() => handleRevoke(grant)}
                    disabled={revokingId === grant.id}
                    className='link link-error shrink-0 text-xs'
                  >
                    {revokingId === grant.id ? _('Revoking…') : _('Revoke')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default ShareBookDialog;
