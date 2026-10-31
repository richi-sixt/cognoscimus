'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { IoArrowBack } from 'react-icons/io5';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { LaterApiError } from '@/libs/later/client';
import {
  addFeed,
  countNewEntries,
  deleteFeed,
  dismissAll,
  type Feed,
  type FeedEntryRow,
  importFeeds,
  listFeedEntries,
  listFeeds,
  parseOpml,
  saveFeedEntry,
  setEntryState,
  setFeedActive,
} from '@/libs/later/feedsClient';

// RSS and Atom feeds: new entries wait here until they are saved as articles or dismissed.
const FeedsPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [feedId, setFeedId] = useState('');
  const [entries, setEntries] = useState<FeedEntryRow[] | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opmlInput = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater%2Ffeeds');
  }, [mounted, user]);

  const fail = useCallback(
    (err: unknown) =>
      setError(
        err instanceof LaterApiError || err instanceof Error
          ? err.message
          : _('Something went wrong'),
      ),
    [_],
  );

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedFeeds, loadedCounts, loadedEntries] = await Promise.all([
        listFeeds(),
        countNewEntries(),
        listFeedEntries(feedId || undefined),
      ]);
      setFeeds(loadedFeeds);
      setCounts(loadedCounts);
      setEntries(loadedEntries);
    } catch (err) {
      fail(err);
    }
  }, [user, feedId, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const note = await action();
      if (note) setMessage(note);
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const url = address.trim();
    if (!url) return;
    void run(async () => {
      const added = await addFeed(url);
      setAddress('');
      return _('Now following {{title}}.', { title: added.title });
    });
  };

  const importOpml = (file: File) =>
    run(async () => {
      const found = parseOpml(await file.text());
      if (found.length === 0) return _('No feeds found in this file.');
      const result = await importFeeds(found);
      return _(
        '{{imported}} feeds added, {{existing}} already followed. Their entries appear within the hour.',
        { imported: result.imported, existing: result.existing },
      );
    });

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center gap-2 px-4 py-3'>
        <Link href='/later' className='btn btn-ghost btn-circle btn-sm' aria-label={_('Back')}>
          <IoArrowBack className='h-5 w-5' />
        </Link>
        <h1 className='text-lg font-semibold'>{_('Feeds')}</h1>
      </header>

      <main className='mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-16'>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
        {message && <p className='text-success text-sm'>{message}</p>}

        <form onSubmit={add} className='join w-full'>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={_('Feed or website address')}
            aria-label={_('Feed or website address')}
            className='input input-bordered input-sm join-item w-full'
          />
          <button type='submit' className='btn btn-sm join-item' disabled={busy || !address.trim()}>
            {busy ? <span className='loading loading-spinner loading-xs' /> : _('Follow')}
          </button>
        </form>

        <div className='flex flex-wrap items-center gap-2'>
          {feeds && feeds.length > 0 && (
            <select
              className='select select-bordered select-sm max-w-full'
              value={feedId}
              onChange={(e) => setFeedId(e.target.value)}
              aria-label={_('Feed')}
            >
              <option value=''>{_('All feeds ({{count}})', { count: total })}</option>
              {feeds.map((f) => (
                <option key={f.id} value={f.id}>
                  {`${f.title || f.url} (${counts[f.id] ?? 0})`}
                </option>
              ))}
            </select>
          )}
          {entries && entries.length > 0 && (
            <button
              type='button'
              className='btn btn-ghost btn-sm'
              disabled={busy}
              onClick={() => void run(() => dismissAll(feedId || undefined))}
            >
              {_('Dismiss all')}
            </button>
          )}
          <button
            type='button'
            className='btn btn-ghost btn-sm ms-auto'
            disabled={busy}
            onClick={() => opmlInput.current?.click()}
          >
            {_('Import OPML')}
          </button>
          <input
            ref={opmlInput}
            type='file'
            accept='.opml,.xml,text/xml'
            className='hidden'
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importOpml(file);
            }}
          />
        </div>

        {feeds && feeds.length === 0 && (
          <p className='text-base-content/60 text-sm'>
            {_('You do not follow any feeds yet. Paste a feed or website address above.')}
          </p>
        )}
        {entries === null && !error && <span className='loading loading-dots loading-md' />}
        {entries?.length === 0 && feeds && feeds.length > 0 && (
          <p className='text-base-content/60 text-sm'>{_('Nothing new.')}</p>
        )}

        {entries?.map((entry) => (
          <article
            key={entry.id}
            className='bg-base-200/60 flex flex-col gap-1.5 rounded-2xl px-4 py-3'
          >
            <span className='text-base-content/60 truncate text-xs'>
              {[
                entry.later_feeds?.title,
                new Date(entry.published_at ?? entry.created_at).toLocaleDateString(),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <a
              href={entry.url}
              target='_blank'
              rel='noopener noreferrer'
              className='font-medium hover:underline'
            >
              {entry.title}
            </a>
            {entry.excerpt && (
              <p className='text-base-content/70 line-clamp-3 text-sm'>{entry.excerpt}</p>
            )}
            <span className='flex gap-1 pt-1'>
              <button
                type='button'
                className='btn btn-primary btn-xs'
                disabled={busy}
                onClick={() => void run(() => saveFeedEntry(entry))}
              >
                {_('Save')}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                disabled={busy}
                onClick={() => void run(() => setEntryState([entry.id], 'dismissed'))}
              >
                {_('Dismiss')}
              </button>
            </span>
          </article>
        ))}

        {feeds && feeds.length > 0 && (
          <details className='mt-4'>
            <summary className='text-base-content/60 cursor-pointer text-sm font-medium'>
              {_('Manage feeds ({{count}})', { count: feeds.length })}
            </summary>
            <ul className='bg-base-200/60 divide-base-content/5 mt-2 divide-y overflow-hidden rounded-2xl'>
              {feeds.map((f) => (
                <li key={f.id} className='flex items-center justify-between gap-3 px-4 py-3'>
                  <span className='min-w-0'>
                    <span className='block truncate'>{f.title || f.url}</span>
                    {!f.active && (
                      <span className='text-warning block text-xs'>
                        {_('Paused')}
                        {f.last_error && `: ${f.last_error}`}
                      </span>
                    )}
                  </span>
                  <span className='flex shrink-0 gap-1'>
                    <button
                      type='button'
                      className='btn btn-ghost btn-xs'
                      disabled={busy}
                      onClick={() => void run(() => setFeedActive(f.id, !f.active))}
                    >
                      {f.active ? _('Pause') : _('Resume')}
                    </button>
                    <button
                      type='button'
                      className='btn btn-ghost btn-xs text-error'
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            _('Stop following "{{title}}"?', { title: f.title || f.url }),
                          )
                        )
                          void run(async () => {
                            if (feedId === f.id) setFeedId('');
                            await deleteFeed(f.id);
                          });
                      }}
                    >
                      {_('Remove')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
};

export default FeedsPage;
