'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getMyProfile,
  HANDLE_PATTERN,
  normalizeHandle,
  type Profile,
  saveMyProfile,
} from '@/libs/later/social';

/**
 * The public side of the account: a unique username (handle) and a display name,
 * shared by the library and Later. Others find the account by its exact handle,
 * and only when it is switched to discoverable.
 */
export function ProfileSection({ onSaved }: { onSaved?: (profile: Profile) => void }) {
  const _ = useTranslation();
  const { user } = useAuth();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [libraryShared, setLibraryShared] = useState(false);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    void getMyProfile(user.id)
      .then((profile) => {
        if (!profile) return;
        setExists(true);
        setHandle(profile.handle);
        setDisplayName(profile.display_name);
        setDiscoverable(profile.discoverable);
        setLibraryShared(profile.library_shared);
      })
      .catch((err) => setError(err instanceof Error ? err.message : _('Something went wrong')));
  }, [user, _]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || busy) return;
    setMessage('');
    const clean = normalizeHandle(handle);
    if (!HANDLE_PATTERN.test(clean)) {
      setError(_('A username has 3 to 30 lowercase letters, numbers or hyphens.'));
      return;
    }
    setBusy(true);
    try {
      await saveMyProfile(user.id, { handle: clean, displayName, discoverable, libraryShared });
      setHandle(clean);
      setExists(true);
      onSaved?.({
        user_id: user.id,
        handle: clean,
        display_name: displayName.trim(),
        discoverable,
        library_shared: libraryShared,
      });
      setError('');
      setMessage(_('Profile saved.'));
    } catch (err) {
      // 23505 is the unique violation on the handle.
      setError(
        (err as { code?: string }).code === '23505'
          ? _('This username is already taken.')
          : err instanceof Error
            ? err.message
            : _('Something went wrong'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className='flex flex-col gap-3'>
      <h3 className='text-base-content text-lg font-semibold'>{_('Username')}</h3>
      <p className='text-base-content/70 text-sm'>
        {_(
          'One username for the library and Later. Other people find you by it; your e-mail address is never shown.',
        )}
      </p>
      <label className='flex flex-col gap-1 text-sm'>
        <span className='text-base-content/70'>{_('Username')}</span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          maxLength={31}
          placeholder='your-name'
          autoCapitalize='none'
          autoCorrect='off'
          spellCheck={false}
          className='input eink-bordered w-full rounded-lg'
        />
      </label>
      <label className='flex flex-col gap-1 text-sm'>
        <span className='text-base-content/70'>{_('Display name')}</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          className='input eink-bordered w-full rounded-lg'
        />
      </label>
      <label className='flex cursor-pointer items-start gap-2 text-sm'>
        <input
          type='checkbox'
          checked={discoverable}
          onChange={(e) => setDiscoverable(e.target.checked)}
          className='checkbox checkbox-sm mt-0.5'
        />
        <span>
          {_('Others can find me by my exact username and ask to follow me')}
          <span className='text-base-content/60 block text-xs'>{_('Off by default.')}</span>
        </span>
      </label>
      <label className='flex cursor-pointer items-start gap-2 text-sm'>
        <input
          type='checkbox'
          checked={libraryShared}
          onChange={(e) => setLibraryShared(e.target.checked)}
          className='checkbox checkbox-sm mt-0.5'
        />
        <span>
          {_('People who follow me can browse my library')}
          <span className='text-base-content/60 block text-xs'>
            {_(
              'They see title, author and cover, and can ask to borrow a book. Off by default. You can hide single books.',
            )}
          </span>
        </span>
      </label>
      <button type='submit' className='btn btn-primary w-fit rounded-lg' disabled={busy}>
        {exists ? _('Save') : _('Create profile')}
      </button>
      {message && <p className='text-success text-sm'>{message}</p>}
      {error && <p className='text-error text-sm'>{error}</p>}
    </form>
  );
}
