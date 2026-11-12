'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { GRANT_DEFAULT_EXPIRATION_DAYS, GRANT_EXPIRATION_DAYS } from '@/services/constants';
import { answerBookRequest, type BookRequest, listBookRequests } from '@/libs/libraryExplore';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import KindBadge from '../later/components/KindBadge';
import {
  answerFollower,
  answerShare,
  type IncomingShare,
  listIncomingShares,
  followByHandle,
  getMyProfile,
  listConnections,
  type Person,
  type Profile,
  removeFollower,
  unfollow,
} from '@/libs/later/social';

const nameOf = (p: Person) =>
  p.display_name ? `${p.display_name} (@${p.handle})` : `@${p.handle}`;

const PeoplePage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [backHref, setBackHref] = useState('/later');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [find, setFind] = useState('');
  const [requests, setRequests] = useState<Person[]>([]);
  const [following, setFollowing] = useState<Person[]>([]);
  const [pendingOut, setPendingOut] = useState<Person[]>([]);
  const [followers, setFollowers] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<IncomingShare[]>([]);
  const [borrow, setBorrow] = useState<BookRequest[]>([]);
  const [days, setDays] = useState<number>(GRANT_DEFAULT_EXPIRATION_DAYS);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    // Both the library and Later link here; a plain <a> back, since /later is not isolated.
    if (new URLSearchParams(window.location.search).get('from') === 'library') {
      setBackHref('/library');
    }
  }, []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Fpeople');
  }, [mounted, user]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const mine = await getMyProfile(user.id);
      setProfile(mine);
      if (mine) {
        setIncoming(await listIncomingShares());
        setBorrow((await listBookRequests('owner')).filter((r) => r.status === 'pending'));
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
        <a href={backHref} className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
          <IoArrowBack className='h-5 w-5' />
        </a>
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

        {loaded && !profile && (
          <div className='bg-base-200/60 flex flex-col gap-3 rounded-2xl p-4 text-sm'>
            <p>{_('Choose a username first. It is shared with the library.')}</p>
            <a href='/user?redirect=%2Fpeople' className='btn btn-primary btn-sm w-fit'>
              {_('Choose a username')}
            </a>
          </div>
        )}

        {profile && (
          <p className='text-base-content/70 text-sm'>
            {_('You are @{{handle}}.', { handle: profile.handle })}{' '}
            <a href='/user?redirect=%2Fpeople' className='link'>
              {_('Edit profile')}
            </a>
            {!profile.discoverable && (
              <span className='block'>
                {_('Others cannot find you yet. Switch it on in your profile.')}
              </span>
            )}
          </p>
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

            {incoming.length > 0 && (
              <section className='flex flex-col gap-2'>
                <h2 className='font-medium'>{_('Sent to you')}</h2>
                <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
                  {incoming.map((s) => (
                    <li key={s.id} className='flex items-center justify-between gap-3 px-4 py-3'>
                      <span className='min-w-0'>
                        <span className='flex items-center gap-2'>
                          <KindBadge kind={s.kind} />
                          <span className='truncate'>{s.title}</span>
                        </span>
                        <span className='text-base-content/50 block text-xs'>
                          {_('from @{{handle}}', { handle: s.sender_handle })}
                        </span>
                      </span>
                      <span className='flex shrink-0 gap-1'>
                        <a
                          href={`/later/explore/read?id=${s.id}&offer=1`}
                          className='btn btn-primary btn-xs'
                        >
                          {_('Open')}
                        </a>
                        <button
                          type='button'
                          className='btn btn-ghost btn-xs'
                          onClick={() => void run(() => answerShare(s.id, false))}
                        >
                          {_('Delete')}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {borrow.length > 0 && (
              <section className='flex flex-col gap-2'>
                <div className='flex items-center justify-between gap-3'>
                  <h2 className='font-medium'>{_('Requests to borrow a book')}</h2>
                  <label className='flex items-center gap-2 text-xs'>
                    {_('Lend for')}
                    <select
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                      className='select select-bordered select-xs'
                    >
                      {GRANT_EXPIRATION_DAYS.map((n) => (
                        <option key={n} value={n}>
                          {_('{{count}} days', { count: n })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
                  {borrow.map((r) => (
                    <li key={r.id} className='flex items-center justify-between gap-3 px-4 py-3'>
                      <span className='min-w-0'>
                        <span className='block truncate'>{r.book_title}</span>
                        <span className='text-base-content/50 block text-xs'>
                          {_('from @{{handle}}', { handle: r.other_handle })}
                        </span>
                        {r.book_format === 'physical' && (
                          <span className='text-base-content/50 block text-xs'>
                            {_('A printed book. It changes hands in person.')}
                          </span>
                        )}
                        {r.message && (
                          <span className='text-base-content/70 mt-1 block text-xs italic'>
                            {r.message}
                          </span>
                        )}
                      </span>
                      <span className='flex shrink-0 gap-1'>
                        <button
                          type='button'
                          className='btn btn-primary btn-xs'
                          onClick={() =>
                            void run(() =>
                              answerBookRequest(
                                r.id,
                                r.book_format === 'physical'
                                  ? { accept: true }
                                  : { accept: true, expirationDays: days },
                              ),
                            )
                          }
                        >
                          {_('Lend')}
                        </button>
                        <button
                          type='button'
                          className='btn btn-ghost btn-xs'
                          onClick={() => void run(() => answerBookRequest(r.id, { accept: false }))}
                        >
                          {_('Decline')}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

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
