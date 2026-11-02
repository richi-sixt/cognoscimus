'use client';

import { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibrary } from '@/hooks/useLibrary';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { Book } from '@/types/book';
import { formatBytes } from '@/utils/book';

const BATCH = 20;

interface Result {
  shrunk: number;
  saved: number;
  notUploaded: number;
}

/**
 * Covers taken from imported books are often 1-2 MB. This scales the ones on
 * this device down to card size and replaces their cloud copies, so every
 * device (and everyone browsing the library) loads far less. Idempotent: covers
 * that are already small are skipped.
 */
const CoverOptimizer = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { libraryLoaded } = useLibrary();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const run = async () => {
    if (!appService || running) return;
    const { library, updateBooks } = useLibraryStore.getState();
    const candidates = library.filter((b) => !b.deletedAt && b.coverHash);
    cancelled.current = false;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress({ done: 0, total: candidates.length });
    const outcome: Result = { shrunk: 0, saved: 0, notUploaded: 0 };
    let changed: Book[] = [];
    const commit = async () => {
      if (changed.length === 0) return;
      await updateBooks(envConfig, changed);
      changed = [];
    };
    try {
      for (const [index, book] of candidates.entries()) {
        if (cancelled.current) break;
        try {
          const sizes = await appService.optimizeBookCover(book);
          if (sizes) {
            const coverHash = await appService.computeCoverHash(book);
            const updated: Book = { ...book, coverHash };
            let uploaded = true;
            if (book.uploadedAt) {
              try {
                await appService.uploadBookCover(updated);
              } catch {
                uploaded = false;
                outcome.notUploaded++;
              }
            }
            // Peers re-download the cover only when the new version is in the cloud.
            if (uploaded) updated.coverUpdatedAt = Date.now();
            changed.push(updated);
            outcome.shrunk++;
            outcome.saved += sizes.before - sizes.after;
          }
        } catch {
          // A cover that cannot be read or decoded stays as it is.
        }
        setProgress({ done: index + 1, total: candidates.length });
        if (changed.length >= BATCH) await commit();
      }
      await commit();
      setResult(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className='flex flex-col gap-3'>
      <h3 className='text-base-content text-lg font-semibold'>{_('Shrink covers')}</h3>
      <p className='text-base-content/70 text-sm'>
        {_(
          'Covers of imported books are often 1 to 2 MB. This scales the covers on this device down and replaces their cloud copies, so the library loads faster everywhere. It can take a few minutes.',
        )}
      </p>
      <div className='flex items-center gap-3'>
        <button
          type='button'
          className='btn btn-primary btn-sm w-fit rounded-lg'
          disabled={running || !libraryLoaded || !appService}
          onClick={() => void run()}
        >
          {running ? _('Working…') : _('Shrink covers')}
        </button>
        {running && (
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            onClick={() => {
              cancelled.current = true;
            }}
          >
            {_('Stop')}
          </button>
        )}
        {progress && running && (
          <span className='text-base-content/70 text-sm'>
            {progress.done} / {progress.total}
          </span>
        )}
      </div>
      {result && (
        <p className='text-success text-sm'>
          {result.shrunk === 0
            ? _('All covers are already small.')
            : _('{{count}} covers shrunk, {{size}} saved.', {
                count: result.shrunk,
                size: formatBytes(result.saved),
              })}
          {result.notUploaded > 0 &&
            ` ${_('{{count}} could not be uploaded.', { count: result.notUploaded })}`}
        </p>
      )}
      {error && <p className='text-error text-sm'>{error}</p>}
    </div>
  );
};

export default CoverOptimizer;
