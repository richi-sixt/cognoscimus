import clsx from 'clsx';
import React, { useState } from 'react';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { lookupSeries } from '@/libs/seriesLookup';
import {
  SeriesIndexMode,
  SeriesSuggestionValue,
  applyBookSeriesEdits,
  getLibrarySeries,
} from '../utils/libraryUtils';

interface SeriesModalProps {
  libraryBooks: Book[];
  // The selected books, with any selected groups already expanded.
  bookHashes: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

// Nothing is written until Confirm; the preview shows what each book would get.
const SeriesModal: React.FC<SeriesModalProps> = ({
  libraryBooks,
  bookHashes,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setLibrary } = useLibraryStore();

  const [librarySeries] = useState(() => getLibrarySeries(libraryBooks));
  const [series, setSeries] = useState('');
  const [indexMode, setIndexMode] = useState<SeriesIndexMode>('fromTitle');

  const [suggestions, setSuggestions] = useState<Record<string, SeriesSuggestionValue>>({});
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'error'>('idle');

  const handleLookup = async () => {
    setLookupState('loading');
    try {
      const found = await lookupSeries(
        libraryBooks
          .filter((book) => bookHashes.includes(book.hash))
          .map((book) => ({ hash: book.hash, title: book.title })),
      );
      setSuggestions(
        Object.fromEntries(
          found.map((s) => [s.hash, { series: s.series, seriesIndex: s.seriesIndex }]),
        ),
      );
      setLookupState('idle');
    } catch {
      setLookupState('error');
    }
  };

  const updatedBooks = applyBookSeriesEdits(libraryBooks, bookHashes, {
    series,
    indexMode,
    suggestions,
  });
  const selected = libraryBooks.filter((book) => bookHashes.includes(book.hash));
  const preview = selected.map((book, i) => {
    const next = updatedBooks.find((b) => b.hash === book.hash) ?? book;
    return { book, next, changed: next !== book, key: `${book.hash}-${i}` };
  });
  const hasChanges = preview.some((row) => row.changed);

  const handleConfirm = () => {
    if (!hasChanges) return;
    setLibrary(updatedBooks);
    appService?.saveLibraryBooks(updatedBooks);
    onConfirm();
  };

  const divRef = useKeyDownActions({ onCancel, onConfirm: handleConfirm });

  const modes: { value: SeriesIndexMode; label: string }[] = [
    { value: 'fromTitle', label: _('Number from title') },
    { value: 'sequential', label: _('Number 1, 2, 3 …') },
    { value: 'keep', label: _('Keep current number') },
  ];

  return (
    <div className='fixed inset-0 flex items-center justify-center'>
      <div
        ref={divRef}
        className={clsx(
          'modal-box bg-base-100 overflow-y-auto rounded-2xl shadow-xl',
          'max-h-[85%] w-[95%] min-w-64 max-w-[560px] p-6 sm:w-[70%]',
        )}
      >
        <h2 className='text-center text-lg font-bold'>{_('Set Series')}</h2>

        <input
          type='text'
          list='series-suggestions'
          value={series}
          placeholder={_('Series name (empty keeps current)')}
          onChange={(e) => setSeries(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className='input input-bordered mt-4 w-full text-base sm:text-sm'
        />
        <datalist id='series-suggestions'>
          {librarySeries.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <div role='radiogroup' className='mt-4 flex flex-col gap-1 text-base sm:text-sm'>
          {modes.map((mode) => (
            <label key={mode.value} className='flex items-center gap-2 p-1'>
              <input
                type='radio'
                name='series-index-mode'
                checked={indexMode === mode.value}
                onChange={() => setIndexMode(mode.value)}
                className='radio radio-sm'
              />
              {mode.label}
            </label>
          ))}
        </div>

        <div className='mt-4 flex items-center gap-3 text-sm'>
          <button
            onClick={handleLookup}
            disabled={lookupState === 'loading'}
            className='text-blue-500 disabled:opacity-50'
          >
            {lookupState === 'loading' ? _('Looking up …') : _('Look up online (Hardcover)')}
          </button>
          {lookupState === 'error' && (
            <span className='text-red-500'>{_('Lookup failed or not configured')}</span>
          )}
          {Object.keys(suggestions).length > 0 && (
            <>
              <span>{_('{{count}} matches', { count: Object.keys(suggestions).length })}</span>
              <button onClick={() => setSuggestions({})} className='text-neutral-content'>
                {_('Discard')}
              </button>
            </>
          )}
        </div>

        <ul className='mt-4 max-h-56 overflow-y-auto text-sm'>
          {preview.map(({ book, next, changed, key }) => (
            <li key={key} className='flex justify-between gap-2 py-1'>
              <span className='min-w-0 truncate'>{book.title}</span>
              <span className={clsx('shrink-0', changed ? 'text-blue-500' : 'opacity-50')}>
                {next.metadata?.series ?? '—'} #{next.metadata?.seriesIndex ?? '—'}
              </span>
            </li>
          ))}
        </ul>

        <div className='mt-6 flex justify-end gap-x-8 p-2'>
          <button onClick={onCancel} className='flex items-center'>
            {_('Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!hasChanges}
            className={clsx(
              'flex items-center text-blue-500',
              !hasChanges && 'btn-disabled opacity-50',
            )}
          >
            {_('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SeriesModal;
