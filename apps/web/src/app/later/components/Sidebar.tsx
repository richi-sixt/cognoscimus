'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { type KeyboardEvent, useState } from 'react';
import {
  IoArchiveOutline,
  IoChevronDown,
  IoClose,
  IoPeopleOutline,
  IoSearchOutline,
  IoChevronForward,
  IoEllipsisHorizontal,
  IoFolderOutline,
  IoLayersOutline,
  IoPricetagsOutline,
  IoTimeOutline,
  IoTrashOutline,
  IoAddCircleOutline,
  IoFileTrayOutline,
} from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createCollection,
  deleteCollection,
  moveCollection,
  renameCollection,
  type LaterLabel,
  type LaterScope,
  type SavedSearch,
  type SidebarCounts,
} from '@/libs/later/client';
import {
  buildCollectionTree,
  collectionWithDescendants,
  flattenCollectionTree,
  type CollectionNode,
  type LaterCollection,
  subtreeCount,
} from '@/libs/later/collections';

interface Props {
  scope: LaterScope;
  onScope: (scope: LaterScope) => void;
  counts: SidebarCounts | null;
  collections: LaterCollection[];
  labels: LaterLabel[];
  labelId: string | null;
  onLabel: (id: string | null) => void;
  /** Follow requests waiting for an answer. */
  requests: number;
  savedSearches: SavedSearch[];
  onSavedSearch: (saved: SavedSearch) => void;
  onDeleteSavedSearch: (id: string) => void;
  userId: string | undefined;
  /** Called after a collection was created, renamed or deleted. */
  onChanged: () => Promise<void> | void;
  onError: (message: string) => void;
}

type Editing = { mode: 'new'; parentId: string | null } | { mode: 'rename'; id: string };

const isSameScope = (a: LaterScope, b: LaterScope) =>
  a.kind === b.kind && (a.kind !== 'collection' || (b.kind === 'collection' && a.id === b.id));

const Sidebar = ({
  scope,
  onScope,
  counts,
  collections,
  labels,
  labelId,
  onLabel,
  requests,
  savedSearches,
  onSavedSearch,
  onDeleteSavedSearch,
  userId,
  onChanged,
  onError,
}: Props) => {
  const _ = useTranslation();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [moving, setMoving] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = buildCollectionTree(collections);

  const fail = (err: unknown) =>
    onError(err instanceof Error ? err.message : _('Something went wrong'));

  const startEdit = (next: Editing, initial = '') => {
    setEditing(next);
    setDraft(initial);
    if (next.mode === 'new' && next.parentId) {
      setCollapsed((set) => {
        const copy = new Set(set);
        copy.delete(next.parentId!);
        return copy;
      });
    }
  };

  const commit = async () => {
    const name = draft.trim();
    const current = editing;
    setEditing(null);
    if (!current || !name || !userId) return;
    try {
      if (current.mode === 'new') {
        const created = await createCollection(userId, name, current.parentId);
        await onChanged();
        onScope({ kind: 'collection', id: created.id });
      } else {
        await renameCollection(current.id, name);
        await onChanged();
      }
    } catch (err) {
      fail(err);
    }
  };

  const move = async (id: string, parentId: string | null) => {
    setMoving(null);
    try {
      await moveCollection(id, parentId);
      await onChanged();
    } catch (err) {
      fail(err);
    }
  };

  // A collection may go to the top level or under any collection except itself
  // and what lies below it.
  const moveTargets = (id: string) => {
    const blocked = new Set(collectionWithDescendants(collections, id));
    return flattenCollectionTree(tree).filter((c) => !blocked.has(c.id));
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') void commit();
    if (event.key === 'Escape') setEditing(null);
  };

  const remove = async (node: CollectionNode) => {
    if (
      !window.confirm(
        _('Delete the collection "{{name}}"? Its articles are kept.', { name: node.name }),
      )
    )
      return;
    try {
      await deleteCollection(node.id);
      if (scope.kind === 'collection' && scope.id === node.id) onScope({ kind: 'inbox' });
      await onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const row = (
    key: string,
    target: LaterScope,
    Icon: typeof IoLayersOutline,
    label: string,
    count: number | undefined,
  ) => (
    <button
      key={key}
      type='button'
      onClick={() => onScope(target)}
      aria-current={isSameScope(scope, target) ? 'page' : undefined}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
        isSameScope(scope, target) ? 'bg-base-300 font-medium' : 'hover:bg-base-200',
      )}
    >
      <Icon className='h-4 w-4 shrink-0' />
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {count !== undefined && <span className='text-base-content/50 text-xs'>{count}</span>}
    </button>
  );

  const editor = (indent: number) => (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => setEditing(null)}
      maxLength={80}
      placeholder={_('Name')}
      aria-label={_('Collection name')}
      style={{ marginLeft: indent }}
      className='input input-bordered input-xs my-0.5 w-[calc(100%-1rem)]'
    />
  );

  const renderNode = (node: CollectionNode) => {
    const target: LaterScope = { kind: 'collection', id: node.id };
    const active = isSameScope(scope, target);
    const isCollapsed = collapsed.has(node.id);
    const renaming = editing?.mode === 'rename' && editing.id === node.id;
    const relocating = moving === node.id;
    const indent = node.depth * 12;

    return (
      <li key={node.id}>
        {renaming ? (
          editor(indent)
        ) : relocating ? (
          <select
            autoFocus
            defaultValue=''
            onChange={(e) => {
              if (e.target.value)
                void move(node.id, e.target.value === '__top' ? null : e.target.value);
            }}
            onBlur={() => setMoving(null)}
            aria-label={_('Move "{{name}}" to', { name: node.name })}
            style={{ marginLeft: indent }}
            className='select select-bordered select-xs my-0.5 w-[calc(100%-1rem)]'
          >
            <option value='' disabled>
              {_('Move "{{name}}" to…', { name: node.name })}
            </option>
            <option value='__top'>{_('Top level')}</option>
            {moveTargets(node.id).map((c) => (
              <option key={c.id} value={c.id}>
                {`${'\u2003'.repeat(c.depth)}${c.name}`}
              </option>
            ))}
          </select>
        ) : (
          <div
            className={clsx(
              'group flex items-center rounded-lg pe-1',
              active ? 'bg-base-300 font-medium' : 'hover:bg-base-200',
            )}
            style={{ paddingLeft: indent }}
          >
            <button
              type='button'
              onClick={() =>
                setCollapsed((set) => {
                  const copy = new Set(set);
                  if (copy.has(node.id)) copy.delete(node.id);
                  else copy.add(node.id);
                  return copy;
                })
              }
              className={clsx(
                'btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0',
                node.children.length === 0 && 'invisible',
              )}
              aria-label={isCollapsed ? _('Expand') : _('Collapse')}
            >
              {isCollapsed ? (
                <IoChevronForward className='h-3.5 w-3.5' />
              ) : (
                <IoChevronDown className='h-3.5 w-3.5' />
              )}
            </button>
            <button
              type='button'
              onClick={() => onScope(target)}
              aria-current={active ? 'page' : undefined}
              className='flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm'
            >
              <IoFolderOutline className='h-4 w-4 shrink-0' />
              <span className='min-w-0 flex-1 truncate'>{node.name}</span>
              <span className='text-base-content/50 text-xs'>
                {subtreeCount(node, counts?.collections ?? {})}
              </span>
            </button>
            <div className='dropdown dropdown-end'>
              <button
                type='button'
                tabIndex={0}
                className='btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0'
                aria-label={_('Collection menu')}
              >
                <IoEllipsisHorizontal className='h-4 w-4' />
              </button>
              <ul
                tabIndex={-1}
                className='menu dropdown-content bg-base-100 z-50 w-52 rounded-box p-2 shadow'
              >
                <li>
                  <button
                    type='button'
                    onClick={() => startEdit({ mode: 'rename', id: node.id }, node.name)}
                  >
                    {_('Rename')}
                  </button>
                </li>
                <li>
                  <button
                    type='button'
                    onClick={() => startEdit({ mode: 'new', parentId: node.id })}
                  >
                    {_('New sub-collection')}
                  </button>
                </li>
                <li>
                  <button type='button' onClick={() => setMoving(node.id)}>
                    {_('Move…')}
                  </button>
                </li>
                <li>
                  <button type='button' className='text-error' onClick={() => void remove(node)}>
                    {_('Delete')}
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}
        {!isCollapsed && (
          <ul>
            {node.children.map(renderNode)}
            {editing?.mode === 'new' && editing.parentId === node.id && (
              <li>{editor(indent + 24)}</li>
            )}
          </ul>
        )}
      </li>
    );
  };

  return (
    <nav aria-label={_('Library of saved articles')} className='flex flex-col gap-4 text-sm'>
      <div className='flex flex-col gap-0.5'>
        {row('inbox', { kind: 'inbox' }, IoTimeOutline, _('Inbox'), counts?.inbox)}
        {row('all', { kind: 'all' }, IoLayersOutline, _('All articles'), counts?.all)}
        {row('unsorted', { kind: 'unsorted' }, IoFileTrayOutline, _('Unsorted'), counts?.unsorted)}
        {row('archive', { kind: 'archive' }, IoArchiveOutline, _('Archive'), counts?.archive)}
        {row('trash', { kind: 'trash' }, IoTrashOutline, _('Trash'), counts?.trash)}
      </div>

      <div className='flex flex-col gap-1'>
        <div className='flex items-center justify-between px-2'>
          <h2 className='text-base-content/60 text-xs font-semibold uppercase'>
            {_('Collections')}
          </h2>
          <button
            type='button'
            onClick={() => startEdit({ mode: 'new', parentId: null })}
            className='btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0'
            aria-label={_('New collection')}
            title={_('New collection')}
          >
            <IoAddCircleOutline className='h-4 w-4' />
          </button>
        </div>
        <ul>
          {tree.map(renderNode)}
          {editing?.mode === 'new' && editing.parentId === null && <li>{editor(0)}</li>}
        </ul>
        {tree.length === 0 && !editing && (
          <p className='text-base-content/50 px-2 text-xs'>{_('No collections yet.')}</p>
        )}
      </div>

      <Link
        href='/later/people'
        className='hover:bg-base-200 flex items-center gap-2 rounded-lg px-2 py-1.5'
      >
        <IoPeopleOutline className='h-4 w-4 shrink-0' />
        <span className='min-w-0 flex-1 truncate'>{_('People')}</span>
        {requests > 0 && <span className='badge badge-primary badge-sm'>{requests}</span>}
      </Link>

      {savedSearches.length > 0 && (
        <div className='flex flex-col gap-1'>
          <h2 className='text-base-content/60 px-2 text-xs font-semibold uppercase'>
            {_('Saved views')}
          </h2>
          <ul>
            {savedSearches.map((saved) => (
              <li key={saved.id} className='group hover:bg-base-200 flex items-center rounded-lg'>
                <button
                  type='button'
                  onClick={() => onSavedSearch(saved)}
                  className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left'
                >
                  <IoSearchOutline className='h-4 w-4 shrink-0' />
                  <span className='min-w-0 flex-1 truncate'>{saved.name}</span>
                </button>
                <button
                  type='button'
                  onClick={() => {
                    if (window.confirm(_('Delete the view "{{name}}"?', { name: saved.name })))
                      onDeleteSavedSearch(saved.id);
                  }}
                  className='btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0'
                  aria-label={_('Delete the view "{{name}}"?', { name: saved.name })}
                >
                  <IoClose className='h-4 w-4' />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {labels.length > 0 && (
        <details open={labelId !== null} className='flex flex-col gap-1'>
          <summary className='text-base-content/60 flex cursor-pointer items-center gap-2 px-2 text-xs font-semibold uppercase'>
            <IoPricetagsOutline className='h-4 w-4' />
            {_('Labels')} ({labels.length})
          </summary>
          <ul className='mt-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto'>
            {labels.map((label) => (
              <li key={label.id}>
                <button
                  type='button'
                  onClick={() => onLabel(labelId === label.id ? null : label.id)}
                  aria-pressed={labelId === label.id}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left',
                    labelId === label.id ? 'bg-base-300 font-medium' : 'hover:bg-base-200',
                  )}
                >
                  <span className='min-w-0 flex-1 truncate'>{label.name}</span>
                  <span className='text-base-content/50 text-xs'>
                    {counts?.labels[label.id] ?? 0}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </nav>
  );
};

export default Sidebar;
