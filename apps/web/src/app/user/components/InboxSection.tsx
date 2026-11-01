'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';

// Set at build time; without it the inbox is not offered.
const INBOX_ADDRESS = process.env['NEXT_PUBLIC_LATER_INBOX_ADDRESS'];

/**
 * The address to mail links and newsletters to, and the sender addresses that
 * count as this account: the sign-in e-mail always does, extra ones (an alias, a
 * second mailbox) are added here.
 */
export function InboxSection() {
  const _ = useTranslation();
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('later_inbox_addresses')
      .select('email')
      .order('created_at');
    if (loadError) setError(loadError.message);
    else setAddresses((data ?? []).map((row) => row.email as string));
  }, []);

  useEffect(() => {
    if (user && INBOX_ADDRESS) void load();
  }, [user, load]);

  if (!INBOX_ADDRESS || !user) return null;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const { error: addError } = await supabase
      .from('later_inbox_addresses')
      .insert({ user_id: user.id, email: email.trim().toLowerCase() });
    if (addError) {
      setError(
        addError.code === '23505'
          ? _('This address is already in use.')
          : addError.code === '23514'
            ? _('This is not a valid e-mail address.')
            : addError.message,
      );
      return;
    }
    setEmail('');
    await load();
  };

  const remove = async (address: string) => {
    const { error: removeError } = await supabase
      .from('later_inbox_addresses')
      .delete()
      .eq('email', address);
    if (removeError) setError(removeError.message);
    else await load();
  };

  return (
    <div className='flex flex-col gap-3'>
      <h3 className='text-base-content text-lg font-semibold'>{_('Mail inbox')}</h3>
      <p className='text-base-content/70 text-sm'>
        {_(
          'Mail a link to this address and it lands in your Later library. A longer mail is saved as an article. Put @username on its own line to offer the item to someone.',
        )}
      </p>
      <p className='font-mono text-sm'>{INBOX_ADDRESS}</p>
      <p className='text-base-content/70 text-sm'>
        {_(
          'Mail counts as yours when it comes from your sign-in address or one of these, and the sending domain vouches for it.',
        )}
      </p>
      {addresses.length > 0 && (
        <ul className='flex flex-col gap-1 text-sm'>
          {addresses.map((address) => (
            <li key={address} className='flex items-center gap-2'>
              <span className='flex-1 truncate'>{address}</span>
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => remove(address)}
              >
                {_('Remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className='flex gap-2'>
        <input
          type='email'
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={_('Another sender address')}
          className='input eink-bordered w-full rounded-lg'
        />
        <button type='submit' className='btn btn-primary rounded-lg'>
          {_('Add')}
        </button>
      </form>
      {error && <p className='text-error text-sm'>{error}</p>}
    </div>
  );
}
