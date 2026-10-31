'use client';

import { useState } from 'react';
import { IoArchiveOutline, IoArrowUndoOutline, IoClose, IoTrashOutline } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import type { LaterLabel } from '@/libs/later/client';
import {
  buildCollectionTree,
  flattenCollectionTree,
  type LaterCollection,
} from '@/libs/later/collections';

interface Props {
  count: number;
  inTrash: boolean;
  /** True when every selected article is archived, so the action becomes "Move to inbox". */
  allArchived: boolean;
  collections: LaterCollection[];
  labels: LaterLabel[];
  busy: boolean;
  onArchive: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForGood: () => void;
  onMove: (collectionId: string | null) => void;
  onAddLabel: (name: string) => void;
  onDone: () => void;
}

const BulkBar = ({
  count,
  inTrash,
  allArchived,
  collections,
  labels,
  busy,
  onArchive,
  onTrash,
  onRestore,
  onDeleteForGood,
  onMove,
  onAddLabel,
  onDone,
}: Props) => {
  const _ = useTranslation();
  const [label, setLabel] = useState('');
  const disabled = busy || count === 0;

  const addLabel = () => {
    const name = label.trim();
    if (!name) return;
    onAddLabel(name);
    setLabel('');
  };

  return (
    <div className='bg-base-100 border-base-300 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 shadow-lg'>
      <div className='mx-auto flex max-w-5xl flex-wrap items-center gap-2'>
        <span className='me-2 text-sm font-medium'>{_('{{count}} selected', { count })}</span>

        {inTrash ? (
          <>
            <button type='button' className='btn btn-sm' disabled={disabled} onClick={onRestore}>
              <IoArrowUndoOutline className='h-4 w-4' />
              {_('Restore')}
            </button>
            <button
              type='button'
              className='btn btn-sm btn-error btn-outline'
              disabled={disabled}
              onClick={onDeleteForGood}
            >
              <IoTrashOutline className='h-4 w-4' />
              {_('Delete for good')}
            </button>
          </>
        ) : (
          <>
            <button type='button' className='btn btn-sm' disabled={disabled} onClick={onArchive}>
              <IoArchiveOutline className='h-4 w-4' />
              {allArchived ? _('Move to inbox') : _('Archive')}
            </button>
            <select
              className='select select-bordered select-sm max-w-44'
              value=''
              disabled={disabled}
              onChange={(e) => {
                const value = e.target.value;
                if (value) onMove(value === '__none' ? null : value);
              }}
              aria-label={_('Move to collection')}
            >
              <option value=''>{_('Move to…')}</option>
              <option value='__none'>{_('Unsorted')}</option>
              {flattenCollectionTree(buildCollectionTree(collections)).map((c) => (
                <option key={c.id} value={c.id}>
                  {`${' '.repeat(c.depth)}${c.name}`}
                </option>
              ))}
            </select>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLabel()}
              list='later-bulk-labels'
              maxLength={80}
              disabled={disabled}
              placeholder={_('Add label')}
              aria-label={_('Add label')}
              className='input input-bordered input-sm w-32'
            />
            <datalist id='later-bulk-labels'>
              {labels.map((l) => (
                <option key={l.id} value={l.name} />
              ))}
            </datalist>
            {label.trim() && (
              <button type='button' className='btn btn-sm' disabled={disabled} onClick={addLabel}>
                {_('Add')}
              </button>
            )}
            <button
              type='button'
              className='btn btn-sm btn-error btn-outline'
              disabled={disabled}
              onClick={onTrash}
            >
              <IoTrashOutline className='h-4 w-4' />
              {_('Move to trash')}
            </button>
          </>
        )}

        <button
          type='button'
          className='btn btn-ghost btn-sm ms-auto'
          onClick={onDone}
          aria-label={_('Done')}
        >
          <IoClose className='h-4 w-4' />
          {_('Done')}
        </button>
      </div>
    </div>
  );
};

export default BulkBar;
