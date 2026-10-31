'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { recheckKinds } from '@/libs/later/client';

// Housekeeping that does not belong to any one article.
const Maintenance = ({ onDone }: { onDone: () => void }) => {
  const _ = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const changed = await recheckKinds();
      setMessage(_('{{count}} saved links were filed as bookmarks.', { count: changed }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className='bg-base-200/60 rounded-2xl px-4 py-3 text-sm'>
      <summary className='cursor-pointer font-medium'>{_('Tidy up')}</summary>
      <div className='text-base-content/70 mt-3 flex flex-col gap-3'>
        <p>
          {_(
            'Applies the article or bookmark rules to links saved earlier: shops, repositories, videos, files and pages with very little text become bookmarks. Nothing is deleted.',
          )}
        </p>
        <button type='button' onClick={run} disabled={busy} className='btn btn-sm w-fit'>
          {busy ? <span className='loading loading-spinner loading-xs' /> : _('Re-check types')}
        </button>
        {message && <p className='text-success'>{message}</p>}
        {error && (
          <p className='text-error' role='alert'>
            {error}
          </p>
        )}
      </div>
    </details>
  );
};

export default Maintenance;
