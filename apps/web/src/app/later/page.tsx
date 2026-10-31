'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { IoClose, IoMenuOutline, IoPersonCircleOutline } from 'react-icons/io5';
import AppSwitcher from '@/components/AppSwitcher';
import BulkBar from './components/BulkBar';
import ImportRaindrop from './components/ImportRaindrop';
import SaveFromAnywhere from './components/SaveFromAnywhere';
import Maintenance from './components/Maintenance';
import Sidebar from './components/Sidebar';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import {
  bulkAddLabel,
  bulkDelete,
  bulkSetCollection,
  bulkSetState,
  bulkTrash,
  countPending,
  createLabel,
  createSavedSearch,
  deleteSavedSearch,
  getSidebarCounts,
  listCollections,
  listItems,
  listLabels,
  listSavedSearches,
  loadPending,
  purgeTrash,
  saveArticle,
  type LaterItem,
  type LaterLabel,
  type LaterScope,
  type LaterSort,
  type SavedSearch,
  type SidebarCounts,
} from '@/libs/later/client';
import type { ItemKind } from '@/libs/later/kind';
import type { LaterCollection } from '@/libs/later/collections';
import { TRASH_RETENTION_DAYS } from '@/libs/later/constants';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

const LaterPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [scope, setScope] = useState<LaterScope>({ kind: 'inbox' });
  const [search, setSearch] = useState('');
  const [labelId, setLabelId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<ItemKind | null>(null);
  const [maintenance, setMaintenance] = useState<'failed' | 'unlabeled' | null>(null);
  const [labels, setLabels] = useState<LaterLabel[]>([]);
  const [collections, setCollections] = useState<LaterCollection[]>([]);
  const [counts, setCounts] = useState<SidebarCounts | null>(null);
  const [items, setItems] = useState<LaterItem[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<LaterSort>('newest');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [pending, setPending] = useState(0);
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user) window.location.assign('/auth?redirect=%2Flater');
  }, [mounted, user]);

  const load = useCallback(async () => {
    try {
      // Opening the trash also clears what has outlived its retention.
      if (scope.kind === 'trash') await purgeTrash({ expiredOnly: true });
      // Collections come first: a collection scope includes its sub-collections.
      const currentCollections = await listCollections();
      setCollections(currentCollections);
      setItems(
        await listItems({
          scope,
          collections: currentCollections,
          search,
          labelId,
          kind: kindFilter,
          sort,
          maintenance,
        }),
      );
      setCounts(await getSidebarCounts());
      setPending(await countPending());
      // Labels disappear with their last article, so the list is refreshed too.
      const currentLabels = await listLabels();
      setLabels(currentLabels);
      setSavedSearches(await listSavedSearches());
      if (labelId && !currentLabels.some((l) => l.id === labelId)) setLabelId(null);
      if (scope.kind === 'collection' && !currentCollections.some((c) => c.id === scope.id)) {
        setScope({ kind: 'inbox' });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not load your articles'));
    }
  }, [scope, search, labelId, kindFilter, sort, maintenance, _]);

  useEffect(() => {
    if (!user) return;
    // Debounce typing in the search box.
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [user, load]);

  const chooseScope = (next: LaterScope) => {
    setScope(next);
    setSelected(new Set());
    setDrawerOpen(false);
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Runs a bulk action on the selection, then refreshes and clears it.
  const bulk = async (action: (ids: string[]) => Promise<void>) => {
    if (bulkBusy || selected.size === 0) return;
    setBulkBusy(true);
    try {
      // Only what is still on screen: a changed filter may have hidden some.
      await action([...selected].filter((id) => items?.some((item) => item.id === id)));
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setBulkBusy(false);
    }
  };

  const selectedItems = (items ?? []).filter((item) => selected.has(item.id));

  const bulkLabel = (name: string) =>
    bulk(async (ids) => {
      if (!user) return;
      const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      const label = existing ?? (await createLabel(user.id, name));
      await bulkAddLabel(ids, label.id);
    });

  const applySavedSearch = (saved: SavedSearch) => {
    const query = saved.query;
    setScope(query.scope ?? { kind: 'inbox' });
    setSearch(query.search ?? '');
    setLabelId(query.labelId ?? null);
    setKindFilter(query.kind ?? null);
    setMaintenance(query.maintenance ?? null);
    setSelected(new Set());
    setDrawerOpen(false);
  };

  const saveCurrentSearch = async () => {
    if (!user) return;
    const name = window.prompt(_('Name for this view'))?.trim();
    if (!name) return;
    try {
      await createSavedSearch(user.id, name, {
        scope,
        search,
        labelId,
        kind: kindFilter,
        maintenance,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    }
  };

  const removeSavedSearch = async (id: string) => {
    try {
      await deleteSavedSearch(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    }
  };

  const customView = Boolean(search.trim() || labelId || kindFilter || maintenance);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      // A link pasted while a collection is open lands in that collection.
      await saveArticle(url, scope.kind === 'collection' ? scope.id : null);
      setUrl('');
      if (scope.kind === 'archive' || scope.kind === 'trash') setScope({ kind: 'inbox' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not save the article'));
    } finally {
      setSaving(false);
    }
  };

  // Fetches the article text of imported links; the list refreshes as it goes.
  const loadWaiting = async () => {
    if (loadProgress) return;
    setLoadProgress({ done: 0, total: pending });
    try {
      let lastRefresh = 0;
      await loadPending((done, total) => {
        setLoadProgress({ done, total });
        if (done - lastRefresh >= 10) {
          lastRefresh = done;
          void load();
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setLoadProgress(null);
      await load();
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

  const scopeTitle = (() => {
    switch (scope.kind) {
      case 'inbox':
        return _('Inbox');
      case 'all':
        return _('All articles');
      case 'unsorted':
        return _('Unsorted');
      case 'archive':
        return _('Archive');
      case 'trash':
        return _('Trash');
      case 'collection':
        return collections.find((c) => c.id === scope.id)?.name ?? '';
    }
  })();
  const activeLabel = labels.find((l) => l.id === labelId);

  const kindFilters: {
    id: string;
    label: string;
    kind: ItemKind | null;
    maintenance: 'failed' | 'unlabeled' | null;
  }[] = [
    { id: 'all', label: _('All types'), kind: null, maintenance: null },
    { id: 'article', label: _('Articles'), kind: 'article', maintenance: null },
    { id: 'link', label: _('Links'), kind: 'link', maintenance: null },
    { id: 'video', label: _('Videos'), kind: 'video', maintenance: null },
    { id: 'document', label: _('Documents'), kind: 'document', maintenance: null },
    { id: 'unlabeled', label: _('No label'), kind: null, maintenance: 'unlabeled' },
    { id: 'failed', label: _('Broken links'), kind: null, maintenance: 'failed' },
  ];
  const kindLabel: Record<ItemKind, string | null> = {
    article: null,
    link: _('link'),
    video: _('video'),
    document: _('document'),
  };

  const sidebar = (
    <Sidebar
      scope={scope}
      onScope={chooseScope}
      counts={counts}
      collections={collections}
      labels={labels}
      labelId={labelId}
      onLabel={(id) => {
        setLabelId(id);
        setDrawerOpen(false);
      }}
      savedSearches={savedSearches}
      onSavedSearch={applySavedSearch}
      onDeleteSavedSearch={(id) => void removeSavedSearch(id)}
      userId={user?.id}
      onChanged={load}
      onError={setError}
    />
  );

  return (
    <div className='bg-base-100 text-base-content min-h-dvh'>
      <header className='flex items-center justify-between gap-2 px-4 py-3'>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={() => setDrawerOpen(true)}
            className='btn btn-ghost btn-circle btn-sm lg:hidden'
            aria-label={_('Open the collections menu')}
          >
            <IoMenuOutline className='h-6 w-6' />
          </button>
          <AppSwitcher />
        </div>
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

      {drawerOpen && (
        <div className='fixed inset-0 z-40 flex lg:hidden'>
          <aside className='bg-base-100 h-full w-72 max-w-[85vw] overflow-y-auto p-4 shadow-xl'>
            <div className='mb-3 flex justify-end'>
              <button
                type='button'
                onClick={() => setDrawerOpen(false)}
                className='btn btn-ghost btn-circle btn-sm'
                aria-label={_('Close')}
              >
                <IoClose className='h-5 w-5' />
              </button>
            </div>
            {sidebar}
          </aside>
          <button
            type='button'
            aria-label={_('Close')}
            onClick={() => setDrawerOpen(false)}
            className='bg-base-content/30 flex-1 cursor-default'
          />
        </div>
      )}

      <div className='mx-auto flex max-w-5xl gap-8 px-4 pb-10'>
        <aside className='hidden w-60 shrink-0 lg:block'>{sidebar}</aside>

        <main className='flex min-w-0 max-w-2xl flex-1 flex-col gap-4'>
          <form onSubmit={handleSave} className='join w-full'>
            <input
              type='url'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                scope.kind === 'collection'
                  ? _('Paste a link to save in "{{name}}"', { name: scopeTitle })
                  : _('Paste a link to save')
              }
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
          <Maintenance onDone={() => void load()} />
          <ImportRaindrop
            onImported={() => {
              setScope({ kind: 'inbox' });
              void load().then(loadWaiting);
            }}
          />

          {pending > 0 && (
            <div className='bg-base-200/60 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm'>
              <span>
                {loadProgress
                  ? _('Loading articles {{done}} / {{total}}', loadProgress)
                  : _('{{count}} saved links are waiting for their text.', { count: pending })}
              </span>
              {!loadProgress && (
                <button type='button' className='btn btn-sm' onClick={loadWaiting}>
                  {_('Load now')}
                </button>
              )}
            </div>
          )}

          <div className='flex flex-wrap items-center gap-2'>
            <h1 className='min-w-0 truncate text-lg font-semibold'>{scopeTitle}</h1>
            {activeLabel && (
              <span className='badge badge-primary badge-lg gap-1 pe-1'>
                {activeLabel.name}
                <button
                  type='button'
                  onClick={() => setLabelId(null)}
                  className='btn btn-ghost btn-circle btn-xs h-5 min-h-5 w-5'
                  aria-label={_('Remove label filter')}
                >
                  <IoClose className='h-3.5 w-3.5' />
                </button>
              </span>
            )}
            <input
              type='search'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={_('Search')}
              className='input input-bordered input-sm ms-auto min-w-0 flex-1 sm:max-w-56'
              aria-label={_('Search articles')}
            />
          </div>

          <div className='flex flex-wrap gap-1.5' role='group' aria-label={_('Filter by type')}>
            {kindFilters.map((f) => {
              const active = f.kind === kindFilter && f.maintenance === maintenance;
              return (
                <button
                  key={f.id}
                  type='button'
                  onClick={() => {
                    setKindFilter(f.kind);
                    setMaintenance(f.maintenance);
                  }}
                  className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost bg-base-200/60'}`}
                  aria-pressed={active}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className='flex flex-wrap items-center gap-2 text-sm'>
            {items && items.length > 0 && (
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              >
                {selecting ? _('Done') : _('Select')}
              </button>
            )}
            {selecting && items && items.length > 0 && (
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() =>
                  setSelected(
                    selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
                  )
                }
              >
                {selected.size === items.length ? _('Select none') : _('Select all')}
              </button>
            )}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as LaterSort)}
              className='select select-ghost select-xs'
              aria-label={_('Sort by')}
            >
              <option value='newest'>{_('Newest first')}</option>
              <option value='oldest'>{_('Oldest first')}</option>
              <option value='title'>{_('Title')}</option>
              <option value='longest'>{_('Longest read')}</option>
              <option value='shortest'>{_('Shortest read')}</option>
            </select>
            {customView && (
              <button
                type='button'
                className='btn btn-ghost btn-xs ms-auto'
                onClick={() => void saveCurrentSearch()}
              >
                {_('Save this view')}
              </button>
            )}
          </div>

          {scope.kind === 'trash' && (
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

          {error && (
            <p className='text-error text-sm' role='alert'>
              {error}
            </p>
          )}
          {items === null && !error && <span className='loading loading-dots loading-md' />}
          {items?.length === 0 && (
            <p className='text-base-content/60 text-sm'>
              {search || labelId || kindFilter || maintenance
                ? _('No articles match.')
                : scope.kind === 'trash'
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
                    onClick={(event) => {
                      if (!selecting) return;
                      event.preventDefault();
                      toggleSelected(item.id);
                    }}
                    className={`hover:bg-base-200 flex items-center gap-3 px-4 py-3 ${
                      selected.has(item.id) ? 'bg-base-300/60' : ''
                    }`}
                  >
                    {selecting && (
                      <input
                        type='checkbox'
                        className='checkbox checkbox-sm shrink-0'
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={_('Select {{title}}', { title: item.title })}
                      />
                    )}
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
                          item.fetch_state === 'pending'
                            ? _('not loaded yet')
                            : item.fetch_state === 'failed'
                              ? _('could not be loaded')
                              : null,
                          item.state === 'archived' && scope.kind !== 'archive'
                            ? _('archived')
                            : null,
                          kindLabel[item.kind],
                          item.site_name ?? hostOf(item.url),
                          item.kind === 'article'
                            ? `${Math.max(1, Math.round(item.word_count / 220))} min`
                            : null,
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

      {selecting && (
        <>
          <div className='h-20' />
          <BulkBar
            count={selected.size}
            inTrash={scope.kind === 'trash'}
            allArchived={
              selectedItems.length > 0 && selectedItems.every((i) => i.state === 'archived')
            }
            collections={collections}
            labels={labels}
            busy={bulkBusy}
            onArchive={() =>
              void bulk((ids) =>
                bulkSetState(
                  ids,
                  selectedItems.length > 0 && selectedItems.every((i) => i.state === 'archived')
                    ? 'unread'
                    : 'archived',
                ),
              )
            }
            onTrash={() => void bulk((ids) => bulkTrash(ids, true))}
            onRestore={() => void bulk((ids) => bulkTrash(ids, false))}
            onDeleteForGood={() => {
              if (
                !window.confirm(_('Delete {{count}} articles for good?', { count: selected.size }))
              )
                return;
              void bulk(bulkDelete);
            }}
            onMove={(collectionId) => void bulk((ids) => bulkSetCollection(ids, collectionId))}
            onAddLabel={(name) => void bulkLabel(name)}
            onDone={stopSelecting}
          />
        </>
      )}
    </div>
  );
};

export default LaterPage;
