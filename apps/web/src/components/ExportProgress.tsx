import clsx from 'clsx';
import React, { useEffect } from 'react';
import { MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { cancelExportJob } from '@/services/exportBooksJob';
import { ExportJob, useExportJobsStore } from '@/store/exportJobsStore';
import { useThemeStore } from '@/store/themeStore';

const DONE_DISMISS_MS = 8000;

const ExportJobCard: React.FC<{ job: ExportJob }> = ({ job }) => {
  const _ = useTranslation();
  const remove = useExportJobsStore((state) => state.remove);
  const finished = job.status === 'done' || job.status === 'error';
  const hasSkipped = job.skipped.length > 0;

  // A clean result clears itself; one that skipped books or failed waits to be read.
  useEffect(() => {
    if (job.status !== 'done' || hasSkipped) return;
    const timer = setTimeout(() => remove(job.id), DONE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [job.id, job.status, hasSkipped, remove]);

  let line: string;
  if (job.status === 'starting') {
    line = job.streaming ? _('Choose where to save the file...') : _('Preparing...');
  } else if (job.status === 'running') {
    line = _('Book {{current}} of {{total}}', { current: job.current, total: job.total });
  } else if (job.status === 'finishing') {
    line = job.streaming
      ? _('Finishing the file...')
      : _('Almost done, the save dialog follows...');
  } else if (job.status === 'error') {
    line = _('Failed to save books as ZIP');
  } else if (hasSkipped) {
    line = _('{{saved}} book(s) saved, {{skipped}} skipped: {{titles}}', {
      saved: job.saved,
      skipped: job.skipped.length,
      titles: job.skipped.slice(0, 5).join(', '),
    });
  } else {
    line = _('Saved {{count}} book(s) as ZIP', { count: job.saved });
  }

  return (
    <div className='bg-base-300 text-base-content pointer-events-auto w-full rounded-lg p-3 text-sm shadow-lg'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='font-medium'>{_('Saving books as ZIP')}</div>
          <div className={clsx('text-xs', job.status === 'error' && 'text-error')}>{line}</div>
          {job.status === 'running' && job.title && (
            <div className='truncate text-xs opacity-70'>{job.title}</div>
          )}
          {job.status === 'error' && job.error && (
            <div className='truncate text-xs opacity-70'>{job.error}</div>
          )}
        </div>
        {finished ? (
          <button
            className='btn btn-ghost btn-xs btn-circle'
            aria-label={_('Close')}
            onClick={() => remove(job.id)}
          >
            <MdClose />
          </button>
        ) : (
          <button className='btn btn-ghost btn-xs' onClick={() => cancelExportJob(job.id)}>
            {_('Cancel')}
          </button>
        )}
      </div>
      {!finished && (
        <progress
          className='progress progress-primary mt-2 w-full'
          // Without a value the bar shows an indeterminate animation.
          value={job.status === 'running' ? job.current - 1 : undefined}
          max={job.total}
        />
      )}
      {!finished && !job.streaming && (
        <div className='mt-1 text-xs opacity-70'>
          {_('This browser builds the file in memory. Keep the selection small or use Chrome.')}
        </div>
      )}
    </div>
  );
};

/** Progress of the books being saved as ZIP. Lives in the app shell so it survives navigation. */
const ExportProgress: React.FC = () => {
  const jobs = useExportJobsStore((state) => state.jobs);
  const safeAreaBottom = useThemeStore((state) => state.safeAreaInsets?.bottom || 0);
  const running = jobs.some((job) => job.status !== 'done' && job.status !== 'error');

  // Closing the tab drops the file that is being written.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  if (jobs.length === 0) return null;
  return (
    <div
      className='pointer-events-none fixed left-0 right-0 z-50 flex flex-col gap-2 px-4 sm:right-auto sm:w-96'
      style={{ bottom: `${safeAreaBottom + 16}px` }}
    >
      {jobs.map((job) => (
        <ExportJobCard key={job.id} job={job} />
      ))}
    </div>
  );
};

export default ExportProgress;
