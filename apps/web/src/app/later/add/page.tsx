'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { saveArticle } from '@/libs/later/client';
import { pickSharedUrl } from '@/libs/later/shareUrl';

// The browser extension opens this page with ext=<key> and hands over the HTML of
// the page being saved through its content script. Without an answer the link
// is saved as before and the server fetches the page itself.
const HANDOVER_REQUEST = 'cognoscimus-later:request';
const HANDOVER_REPLY = 'cognoscimus-later:html';
const HANDOVER_TIMEOUT_MS = 2000;

const requestCapturedHtml = (): Promise<string | null> =>
  new Promise((resolve) => {
    const finish = (html: string | null) => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(html);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown; html?: unknown } | null;
      if (data?.type !== HANDOVER_REPLY) return;
      finish(typeof data.html === 'string' && data.html ? data.html : null);
    };
    const timer = window.setTimeout(() => finish(null), HANDOVER_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: HANDOVER_REQUEST }, window.location.origin);
  });

type Status =
  | { kind: 'saving' }
  | { kind: 'saved'; id: string }
  | { kind: 'error'; message: string }
  | { kind: 'no-url' };

// Target of the system share sheet (manifest share_target) and of the
// bookmarklet: /later/add?url=… saves the link and offers to read it.
const AddContent = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  const params = useSearchParams();
  useTheme();

  const url = pickSharedUrl({
    url: params?.get('url'),
    text: params?.get('text'),
    title: params?.get('title'),
  });
  const fromExtension = Boolean(params?.get('ext'));
  const [status, setStatus] = useState<Status>(url ? { kind: 'saving' } : { kind: 'no-url' });
  const started = useRef(false);

  useEffect(() => {
    if (!url || started.current) return;
    if (!user) {
      // Back here after signing in. A full page load keeps /later out of the
      // cross-origin isolation the rest of the app runs in.
      const back = `/later/add${window.location.search}`;
      window.location.assign(`/auth?redirect=${encodeURIComponent(back)}`);
      return;
    }
    started.current = true;
    const captured = fromExtension ? requestCapturedHtml() : Promise.resolve(null);
    captured
      .then((html) => saveArticle(url, null, html))
      .then(
        (id) => setStatus({ kind: 'saved', id }),
        (err) =>
          setStatus({
            kind: 'error',
            message: err instanceof Error ? err.message : _('Could not save the article'),
          }),
      );
  }, [url, user, fromExtension, _]);

  const retry = () => {
    started.current = false;
    setStatus({ kind: 'saving' });
    window.location.reload();
  };

  return (
    <div className='bg-base-100 text-base-content flex min-h-dvh items-center justify-center px-4'>
      <div className='bg-base-200/60 flex w-full max-w-md flex-col gap-4 rounded-2xl p-6'>
        {status.kind === 'saving' && (
          <div className='flex items-center gap-3'>
            <span className='loading loading-spinner loading-md' />
            <span>{_('Saving…')}</span>
          </div>
        )}
        {status.kind === 'saved' && (
          <>
            <p className='font-medium'>{_('Saved to Later')}</p>
            <div className='flex gap-2'>
              <a href={`/later/read?id=${status.id}`} className='btn btn-primary btn-sm'>
                {_('Read now')}
              </a>
              <a href='/later' className='btn btn-ghost btn-sm'>
                {_('Open Later')}
              </a>
            </div>
          </>
        )}
        {status.kind === 'error' && (
          <>
            <p className='text-error text-sm' role='alert'>
              {status.message}
            </p>
            <div className='flex gap-2'>
              <button type='button' onClick={retry} className='btn btn-sm'>
                {_('Try again')}
              </button>
              <a href='/later' className='btn btn-ghost btn-sm'>
                {_('Open Later')}
              </a>
            </div>
          </>
        )}
        {status.kind === 'no-url' && (
          <>
            <p className='text-sm'>{_('No link found to save.')}</p>
            <a href='/later' className='btn btn-sm w-fit'>
              {_('Open Later')}
            </a>
          </>
        )}
      </div>
    </div>
  );
};

const AddPage = () => (
  <Suspense fallback={null}>
    <AddContent />
  </Suspense>
);

export default AddPage;
