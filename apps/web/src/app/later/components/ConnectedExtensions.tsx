'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  deleteExtensionToken,
  type ExtensionToken,
  listExtensionTokens,
} from '@/libs/later/client';

const day = (value: string) => new Date(value).toLocaleDateString();

// The browser extensions that may save to this account. Each one holds a token
// of its own; disconnecting removes it, and the extension has to connect again.
const ConnectedExtensions = () => {
  const _ = useTranslation();
  const [tokens, setTokens] = useState<ExtensionToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await listExtensionTokens());
    } catch {
      setError(_('Something went wrong'));
    }
  }, [_]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (id: string) => {
    setError(null);
    try {
      await deleteExtensionToken(id);
      await load();
    } catch {
      setError(_('Something went wrong'));
    }
  };

  return (
    <section className='bg-base-200/60 rounded-2xl px-4 py-3 text-sm'>
      <h2 className='font-medium'>{_('Connected browser extensions')}</h2>
      <div className='text-base-content/70 mt-3 flex flex-col gap-3'>
        {tokens?.length === 0 && (
          <p>
            {_(
              'None yet. Click "Connect" in the extension to let it save to your account without a window.',
            )}
          </p>
        )}
        {tokens?.map((token) => (
          <div key={token.id} className='flex items-center justify-between gap-3'>
            <div className='min-w-0'>
              <p className='text-base-content truncate font-medium'>{token.name}</p>
              <p className='text-xs'>
                {_('Connected on {{date}}', { date: day(token.created_at) })}
                {' · '}
                {token.last_used_at
                  ? _('last used on {{date}}', { date: day(token.last_used_at) })
                  : _('not used yet')}
              </p>
            </div>
            <button type='button' onClick={() => void disconnect(token.id)} className='btn btn-sm'>
              {_('Disconnect')}
            </button>
          </div>
        ))}
        {error && (
          <p className='text-error' role='alert'>
            {error}
          </p>
        )}
      </div>
    </section>
  );
};

export default ConnectedExtensions;
