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
  listSharedFeed,
  type SharedEntry,
} from '@/libs/later/social';
import KindBadge from '../components/KindBadge';

const nameOf = (handle: string, name: string) => (name ? `${name} (@${handle})` : `@${handle}`);

// What the people you follow have shared with their followers, as one feed.
const ExplorePage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [people, setPeople] = useState<FollowedPerson[] | null>(null);
  const [who, setWho] = useState('');
  const [entries, setEntries] = useState<SharedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater%2Fexplore');
  }, [mounted, user]);

  useEffect(() => {
    if (!user) return;
    listFollowing()
      .then(setPeople)
      .catch((err) => setError(err instanceof Error ? err.message : _('Something went wrong')));
  }, [user, _]);

  useEffect(() => {
    if (!user) return;
    setEntries(null);
    listSharedFeed(who || undefined)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : _('Something went wrong')));
  }, [user, who, _]);

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <Link href='/later' className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
          <IoArrowBack className='h-5 w-5' />
        </Link>
        <h1 className='text-lg font-semibold'>{_('Explore')}</h1>
      </header>

      <main className='mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-16'>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}

        {people && people.length === 0 && (
          <p className='text-base-content/60 text-sm'>
            {_('You do not follow anyone yet. Ask someone to follow on the People page.')}
          </p>
        )}

        {people && people.length > 0 && (
          <select
            className='select select-bordered select-sm w-fit max-w-full'
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label={_('Whose articles')}
          >
            <option value=''>{_('Everyone I follow')}</option>
            {people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {nameOf(p.handle, p.display_name)}
              </option>
            ))}
          </select>
        )}

        {entries === null && !error && <span className='loading loading-dots loading-md' />}
        {entries?.length === 0 && people && people.length > 0 && (
          <p className='text-base-content/60 text-sm'>{_('Nothing shared yet.')}</p>
        )}
        {entries?.map((entry) => (
          <Link
            key={entry.id}
            href={`/later/explore/read?id=${entry.id}`}
            className='bg-base-200/60 hover:bg-base-200 flex flex-col gap-1.5 rounded-2xl px-4 py-3'
          >
            <span className='flex items-center gap-2'>
              <KindBadge kind={entry.kind} />
              <span className='text-base-content/60 min-w-0 truncate text-xs'>
                @{entry.owner_handle}
                {entry.collection_name && ` · ${entry.collection_name}`}
              </span>
            </span>
            <span className='font-medium'>{entry.title}</span>
            {entry.note && <span className='text-sm italic'>{entry.note}</span>}
            {entry.excerpt && (
              <span className='text-base-content/70 line-clamp-2 text-sm'>{entry.excerpt}</span>
            )}
            <span className='text-base-content/50 text-xs'>
              {[
                entry.site_name,
                new Date(entry.saved_at).toLocaleDateString(),
                entry.word_count > 0 ? _('{{count}} words', { count: entry.word_count }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </Link>
        ))}
      </main>
    </div>
  );
};

export default ExplorePage;
