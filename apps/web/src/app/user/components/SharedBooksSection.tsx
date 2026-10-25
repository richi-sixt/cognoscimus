'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { listGrants, revokeGrant, type BookGrant } from '@/libs/grants';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type GrantState = 'active' | 'expired' | 'revoked';

const stateOf = (g: BookGrant): GrantState =>
  g.revoked_at ? 'revoked' : new Date(g.expires_at).getTime() > Date.now() ? 'active' : 'expired';

// Books the signed-in user has shared with other accounts, with the option to
// withdraw access before it runs out.
const SharedBooksSection: React.FC = () => {
  const _ = useTranslation();
  const [grants, setGrants] = useState<BookGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGrants(await listGrants('owner'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not load shared books'));
    }
  }, [_]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await revokeGrant(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Could not revoke access'));
    } finally {
      setRevokingId(null);
    }
  };

  const stateLabel: Record<GrantState, string> = {
    active: _('Active'),
    expired: _('Expired'),
    revoked: _('Revoked'),
  };

  return (
    <section className='flex flex-col gap-4'>
      <h2 className='text-lg font-semibold'>{_('Shared Books')}</h2>
      {error && (
        <p className='text-error text-sm' role='alert'>
          {error}
        </p>
      )}
      {grants === null && !error && <span className='loading loading-dots loading-md' />}
      {grants?.length === 0 && (
        <p className='text-base-content/60 text-sm'>
          {_('You have not shared any books yet. Use the Share action on a book.')}
        </p>
      )}
      {grants && grants.length > 0 && (
        <ul className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
          {grants.map((grant) => {
            const state = stateOf(grant);
            return (
              <li key={grant.id} className='flex items-center justify-between gap-3 px-4 py-3'>
                <div className='min-w-0'>
                  <div className='truncate font-medium'>{grant.book_title}</div>
                  <div className='text-base-content/60 truncate text-xs'>
                    {grant.grantee_email ?? _('Unknown user')} · {stateLabel[state]}
                    {state === 'active' &&
                      ` · ${_('Until {{date}}', { date: formatDate(grant.expires_at) })}`}
                  </div>
                </div>
                {state === 'active' && (
                  <button
                    type='button'
                    onClick={() => handleRevoke(grant.id)}
                    disabled={revokingId === grant.id}
                    className='link link-error shrink-0 text-sm'
                  >
                    {revokingId === grant.id ? _('Revoking…') : _('Revoke')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default SharedBooksSection;
