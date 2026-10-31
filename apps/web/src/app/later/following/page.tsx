'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  type FollowedPerson,
  listFollowing,
  listSharedItems,
  type SharedItem,
} from '@/libs/later/social';

const nameOf = (p: FollowedPerson) =>
  p.display_name ? `${p.display_name} (@${p.handle})` : `@${p.handle}`;

// What the people you follow have shared with their followers: titles and text only.
const FollowingPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [people, setPeople] = useState<FollowedPerson[] | null>(null);
  const [open, setOpen] = useState<FollowedPerson | null>(null);
  const [items, setItems] = useState<SharedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater%2Ffollowing');
  }, [mounted, user]);

  useEffect(() => {
    if (!user) return;
    listFollowing()
      .then(setPeople)
      .catch((err) => setError(err instanceof Error ? err.message : _('Something went wrong')));
  }, [user, _]);

  const show = async (person: FollowedPerson) => {
    setOpen(person);
    setItems(null);
    try {
      setItems(await listSharedItems(person.user_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    }
  };

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        {open ? (
          <button
            type='button'
            className='btn btn-ghost btn-circle btn-sm'
            aria-label={_('Back')}
            onClick={() => setOpen(null)}
          >
            <IoArrowBack className='h-5 w-5' />
          </button>
        ) : (
          <Link href='/later' className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
            <IoArrowBack className='h-5 w-5' />
          </Link>
        )}
        <h1 className='text-lg font-semibold'>{open ? nameOf(open) : _('Following')}</h1>
      </header>

      <main className='mx-auto flex max-w-xl flex-col gap-4 px-4 pb-16'>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}

        {!open && people === null && !error && <span className='loading loading-dots loading-md' />}
        {!open && people?.length === 0 && (
          <p className='text-base-content/60 text-sm'>
            {_('You do not follow anyone yet. Ask someone to follow on the People page.')}
          </p>
        )}
        {!open && people && people.length > 0 && (
          <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
            {people.map((p) => (
              <li key={p.user_id}>
                <button
                  type='button'
                  className='hover:bg-base-200 flex w-full items-center justify-between gap-3 px-4 py-3 text-start'
                  onClick={() => void show(p)}
                >
                  <span className='min-w-0 truncate'>{nameOf(p)}</span>
                  <span className='text-base-content/50 text-xs'>
                    {_('{{count}} shared', { count: p.shared_count })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && items === null && !error && <span className='loading loading-dots loading-md' />}
        {open && items?.length === 0 && (
          <p className='text-base-content/60 text-sm'>{_('Nothing shared yet.')}</p>
        )}
        {open && items && items.length > 0 && (
          <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/later/following/read?id=${item.id}`}
                  className='hover:bg-base-200 flex flex-col gap-0.5 px-4 py-3'
                >
                  <span className='font-medium'>{item.title}</span>
                  <span className='text-base-content/50 text-xs'>
                    {new Date(item.saved_at).toLocaleDateString()}
                    {item.word_count > 0 &&
                      ` · ${_('{{count}} words', { count: item.word_count })}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};

export default FollowingPage;
