'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  answerFollower,
  followByHandle,
  getMyProfile,
  HANDLE_PATTERN,
  listConnections,
  normalizeHandle,
  type Person,
  type Profile,
  removeFollower,
  saveMyProfile,
  unfollow,
} from '@/libs/later/social';

const nameOf = (p: Person) =>
  p.display_name ? `${p.display_name} (@${p.handle})` : `@${p.handle}`;

const PeoplePage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [discoverable, setDiscoverable] = useState(false);
  const [find, setFind] = useState('');
  const [requests, setRequests] = useState<Person[]>([]);
  const [following, setFollowing] = useState<Person[]>([]);
  const [pendingOut, setPendingOut] = useState<Person[]>([]);
  const [followers, setFollowers] = useState<Person[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater%2Fpeople');
  }, [mounted, user]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const mine = await getMyProfile(user.id);
      setProfile(mine);
      if (mine) {
        setHandle(mine.handle);
        setDisplayName(mine.display_name);
        setDiscoverable(mine.discoverable);
        setRequests(await listConnections(user.id, 'pending', 'followers'));
        setFollowing(await listConnections(user.id, 'accepted', 'following'));
        setPendingOut(await listConnections(user.id, 'pending', 'following'));
        setFollowers(await listConnections(user.id, 'accepted', 'followers'));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setLoaded(true);
    }
  }, [user, _]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setMessage(null);
    try {
      await action();
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    }
  };

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const clean = normalizeHandle(handle);
    if (!HANDLE_PATTERN.test(clean)) {
      setError(_('A handle has 3 to 30 letters, numbers or hyphens.'));
      return;
    }
    void run(async () => {
      try {
        await saveMyProfile(user.id, { handle: clean, displayName, discoverable });
        setMessage(_('Profile saved.'));
      } catch (err) {
        // 23505 is the unique violation on the handle.
        if ((err as { code?: string }).code === '23505') {
          throw new Error(_('This handle is already taken.'));
        }
        throw err;
      }
    });
  };

  const sendRequest = (event: FormEvent) => {
    event.preventDefault();
    if (!find.trim()) return;
    void run(async () => {
      const result = await followByHandle(find);
      if (result === 'requested') {
        setMessage(_('Request sent. You see their articles once they accept.'));
        setFind('');
      } else if (result === 'profile_required') {
        throw new Error(_('Save your own profile first.'));
      } else {
        throw new Error(_('No one found with this handle.'));
      }
    });
  };

  const list = (title: string, people: Person[], actions: (p: Person) => React.ReactNode) =>
    people.length > 0 && (
      <section className='flex flex-col gap-2'>
        <h2 className='text-base-content/60 text-xs font-semibold uppercase'>{title}</h2>
        <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
          {people.map((p) => (
            <li key={p.user_id} className='flex items-center justify-between gap-3 px-4 py-3'>
              <span className='min-w-0 truncate'>{nameOf(p)}</span>
              <span className='flex shrink-0 gap-1'>{actions(p)}</span>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <Link href='/later' className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
          <IoArrowBack className='h-5 w-5' />
        </Link>
        <h1 className='text-lg font-semibold'>{_('People')}</h1>
      </header>

      <main className='mx-auto flex max-w-xl flex-col gap-6 px-4 pb-16'>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
        {message && <p className='text-success text-sm'>{message}</p>}
        {!loaded && <span className='loading loading-dots loading-md' />}

        {loaded && (
          <form
            onSubmit={saveProfile}
            className='bg-base-200/60 flex flex-col gap-3 rounded-2xl p-4'
          >
            <h2 className='font-medium'>{_('Your profile')}</h2>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-base-content/60'>{_('Handle')}</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                maxLength={31}
                placeholder='your-name'
                className='input input-bordered input-sm'
              />
            </label>
            <label className='flex flex-col gap-1 text-sm'>
              <span className='text-base-content/60'>{_('Display name')}</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                className='input input-bordered input-sm'
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
                {_('Others can find me by my exact handle and ask to follow me')}
                <span className='text-base-content/60 block text-xs'>
                  {_('Your e-mail address is never shown. Off by default.')}
                </span>
              </span>
            </label>
            <button type='submit' className='btn btn-primary btn-sm w-fit'>
              {_('Save')}
            </button>
          </form>
        )}

        {profile && (
          <>
            <form onSubmit={sendRequest} className='flex flex-col gap-2'>
              <h2 className='font-medium'>{_('Follow someone')}</h2>
              <div className='join w-full'>
                <input
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder={_('Exact handle')}
                  aria-label={_('Exact handle')}
                  className='input input-bordered input-sm join-item w-full'
                />
                <button type='submit' className='btn btn-sm join-item' disabled={!find.trim()}>
                  {_('Ask to follow')}
                </button>
              </div>
            </form>

            {list(_('Requests to follow you'), requests, (p) => (
              <>
                <button
                  type='button'
                  className='btn btn-primary btn-xs'
                  onClick={() =>
                    user && void run(() => answerFollower(user.id, p.user_id, 'accepted'))
                  }
                >
                  {_('Accept')}
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-xs'
                  onClick={() => user && void run(() => removeFollower(user.id, p.user_id))}
                >
                  {_('Decline')}
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-xs text-error'
                  onClick={() =>
                    user && void run(() => answerFollower(user.id, p.user_id, 'blocked'))
                  }
                >
                  {_('Block')}
                </button>
              </>
            ))}

            {list(_('You follow'), following, (p) => (
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => user && void run(() => unfollow(user.id, p.user_id))}
              >
                {_('Unfollow')}
              </button>
            ))}

            {list(_('Waiting for their answer'), pendingOut, (p) => (
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => user && void run(() => unfollow(user.id, p.user_id))}
              >
                {_('Withdraw')}
              </button>
            ))}

            {list(_('Your followers'), followers, (p) => (
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => user && void run(() => removeFollower(user.id, p.user_id))}
              >
                {_('Remove')}
              </button>
            ))}
          </>
        )}
      </main>
    </div>
  );
};

export default PeoplePage;
