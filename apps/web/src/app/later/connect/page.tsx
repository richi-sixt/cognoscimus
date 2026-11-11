'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { createExtensionToken, deleteExtensionToken } from '@/libs/later/client';

// Messages exchanged with the content script of the browser extension, which
// runs on this page only. The page never shows the token; it goes to the
// extension through that script.
const HELLO = 'cognoscimus-later:hello';
const PRESENT = 'cognoscimus-later:present';
const TOKEN = 'cognoscimus-later:token';
const STORED = 'cognoscimus-later:stored';
const REPLY_TIMEOUT_MS = 3000;

type Reply = { type?: unknown; name?: unknown; ok?: unknown };

// Posts a message to the extension and waits for its answer of the given type.
const ask = (message: object, replyType: string): Promise<Reply | null> =>
  new Promise((resolve) => {
    const finish = (reply: Reply | null) => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(reply);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Reply | null;
      if (data?.type === replyType) finish(data);
    };
    const timer = window.setTimeout(() => finish(null), REPLY_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.postMessage(message, window.location.origin);
  });

type Status = 'looking' | 'no-extension' | 'ready' | 'connecting' | 'connected' | 'failed';

// Opened by the browser extension. The signed-in person confirms, the server
// creates a token for the extension and this page hands it over.
const ConnectPage = () => {
  const _ = useTranslation();
  const { user } = useAuth();
  useTheme();

  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>('looking');
  const [browser, setBrowser] = useState('Browser');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    if (!user) {
      const back = `/later/connect${window.location.search}`;
      window.location.assign(`/auth?redirect=${encodeURIComponent(back)}`);
      return;
    }
    void ask({ type: HELLO }, PRESENT).then((reply) => {
      if (!reply) return setStatus('no-extension');
      if (typeof reply.name === 'string' && reply.name) setBrowser(reply.name.slice(0, 80));
      setStatus('ready');
    });
  }, [mounted, user]);

  const connect = async () => {
    setError(null);
    setStatus('connecting');
    try {
      const created = await createExtensionToken(browser);
      const reply = await ask({ type: TOKEN, token: created.token }, STORED);
      if (reply?.ok === true) return setStatus('connected');
      // The extension did not take the token, so it must not stay valid.
      await deleteExtensionToken(created.id).catch(() => undefined);
      setStatus('failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Something went wrong'));
      setStatus('failed');
    }
  };

  return (
    <div className='bg-base-100 text-base-content flex min-h-dvh items-center justify-center px-4'>
      <div className='bg-base-200/60 flex w-full max-w-md flex-col gap-4 rounded-2xl p-6 text-sm'>
        <h1 className='text-lg font-semibold'>{_('Connect browser extension')}</h1>
        {status === 'looking' && <span className='loading loading-spinner loading-md' />}
        {status === 'no-extension' && (
          <p>
            {_(
              'The extension did not answer. Open this page with the "Connect" button of the extension.',
            )}
          </p>
        )}
        {(status === 'ready' || status === 'connecting') && (
          <>
            <p>
              {_(
                'Let the extension in this browser ({{browser}}) save pages to your Later library? It can save links, and set their note, collection and labels. It cannot read your library or change your account.',
                { browser },
              )}
            </p>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={() => void connect()}
                disabled={status === 'connecting'}
                className='btn btn-primary btn-sm'
              >
                {_('Connect')}
              </button>
              <a href='/later' className='btn btn-ghost btn-sm'>
                {_('Cancel')}
              </a>
            </div>
          </>
        )}
        {status === 'connected' && (
          <p className='font-medium'>{_('Connected. You can close this tab.')}</p>
        )}
        {status === 'failed' && (
          <>
            <p className='text-error' role='alert'>
              {error ?? _('The extension could not be connected.')}
            </p>
            <button type='button' onClick={() => setStatus('ready')} className='btn btn-sm w-fit'>
              {_('Try again')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ConnectPage;
