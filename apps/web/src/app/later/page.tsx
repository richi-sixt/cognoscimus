'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IoPersonCircleOutline } from 'react-icons/io5';
import AppSwitcher from '@/components/AppSwitcher';
import SaveFromAnywhere from './components/SaveFromAnywhere';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  listItems,
  listLabels,
  purgeTrash,
  saveArticle,
  type LaterItem,
  type LaterLabel,
  type LaterView,
} from '@/libs/later/client';
import { TRASH_RETENTION_DAYS } from '@/libs/later/constants';

const LaterPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<LaterView>('inbox');
  const [search, setSearch] = useState('');
  const [labelId, setLabelId] = useState<string | null>(null);
  const [labels, setLabels] = useState<LaterLabel[]>([]);
  const [items, setItems] = useState<LaterItem[] | null>(null);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater');
  }, [mounted, user]);

  const load = useCallback(async () => {
    try {
      // Opening the trash also clears what has outlived its retention.
      if (view === 'trash') await purgeTrash({ expiredOnly: true });
      setItems(await listItems({ view, search, labelId }));
      // Labels disappear with their last article, so the list is refreshed too.
      const current = await listLabels();
      setLabels(current);
      if (labelId && !current.some((l) => l.id === labelId)) setLabelId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not load your articles'));
    }
  }, [view, search, labelId, _]);

  useEffect(() => {
    if (!user) return;
    // Debounce typing in the search box.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [user, load]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveArticle(url);
      setUrl('');
      setView('inbox');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not save the article'));
    } finally {
      setSaving(false);
    }
  };

  const emptyTrash = async () => {
    if (!window.confirm(_('Delete everything in the trash for good?'))) return;
    try {
      await purgeTrash();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    }
  };

  const viewLabels: Record<LaterView, string> = {
    inbox: _('Inbox'),
    archive: _('Archive'),
    trash: _('Trash'),
  };

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center justify-between gap-2 px-4 py-3'>
        <AppSwitcher />
        <button
          type='button'
          onClick={() => window.location.assign('/user?redirect=%2Flater')}
          className='btn btn-ghost btn-circle btn-sm'
          aria-label={_('Account')}
          title={_('Account')}
        >
          <IoPersonCircleOutline className='h-6 w-6' />
        </button>
      </header>

      <main className='mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-10'>
        <form onSubmit={handleSave} className='join w-full'>
          <input
            type='url'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={_('Paste a link to save')}
            className='input input-bordered join-item w-full'
            aria-label={_('Link to save')}
          />
          <button
            type='submit'
            className='btn btn-primary join-item'
            disabled={saving || !url.trim()}
          >
            {saving ? <span className='loading loading-spinner loading-sm' /> : _('Save')}
          </button>
        </form>

        <SaveFromAnywhere />

        <div className='flex flex-wrap items-center gap-2'>
          <div role='tablist' className='tabs tabs-box'>
            {(['inbox', 'archive', 'trash'] as const).map((v) => (
              <button
                key={v}
                type='button'
                role='tab'
                className={clsx('tab', view === v && 'tab-active')}
                onClick={() => setView(v)}
              >
                {viewLabels[v]}
              </button>
            ))}
          </div>
          <input
            type='search'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={_('Search')}
            className='input input-bordered input-sm min-w-0 flex-1'
            aria-label={_('Search articles')}
          />
        </div>

        {view === 'trash' && (
          <div className='text-base-content/60 flex items-center justify-between gap-3 text-sm'>
            <span>
              {_('Articles are deleted for good after {{count}} days.', {
                count: TRASH_RETENTION_DAYS,
              })}
            </span>
            {items && items.length > 0 && (
              <button type='button' className='btn btn-ghost btn-xs' onClick={emptyTrash}>
                {_('Empty trash')}
              </button>
            )}
          </div>
        )}

        {labels.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {labels.map((label) => (
              <button
                key={label.id}
                type='button'
                className={clsx(
                  'badge badge-lg',
                  labelId === label.id ? 'badge-primary' : 'badge-outline',
                )}
                onClick={() => setLabelId(labelId === label.id ? null : label.id)}
              >
                {label.name}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
        {items === null && !error && <span className='loading loading-dots loading-md' />}
        {items?.length === 0 && (
          <p className='text-base-content/60 text-sm'>
            {search || labelId
              ? _('No articles match.')
              : view === 'trash'
                ? _('The trash is empty.')
                : _('Nothing here yet.')}
          </p>
        )}
        {items && items.length > 0 && (
          <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/later/read?id=${item.id}`}
                  className='hover:bg-base-200 flex items-center gap-3 px-4 py-3'
                >
                  {item.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail}
                      alt=''
                      referrerPolicy='no-referrer'
                      loading='lazy'
                      className='h-14 w-14 shrink-0 rounded-lg object-cover'
                    />
                  )}
                  <div className='min-w-0'>
                    <div className='truncate font-medium'>{item.title}</div>
                    <div className='text-base-content/60 truncate text-xs'>
                      {[
                        item.site_name,
                        `${Math.max(1, Math.round(item.word_count / 220))} min`,
                        item.progress > 0 && item.state !== 'archived'
                          ? `${Math.round(item.progress * 100)}%`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};

export default LaterPage;
