'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';

type Factor = { id: string; friendly_name?: string };
type Pending = { id: string; qr: string; secret: string };

/** Lists, adds and removes the TOTP (authenticator app) factors of the user. */
export function MfaSection() {
  const _ = useTranslation();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp ?? []);
  };

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => setFactors(data?.totp ?? []));
  }, []);

  const handleEnroll = async () => {
    setBusy(true);
    setError('');
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      // Names must be unique per user, so add the time to the date.
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    });
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? _('Setup failed.'));
      return;
    }
    setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const handleVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending) return;
    const code = String(new FormData(event.currentTarget).get('code') || '').trim();
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: pending.id,
      code,
    });
    setBusy(false);
    if (error) {
      setError(_('The code is not correct.'));
      return;
    }
    setPending(null);
    load();
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm(_('Remove this authenticator?'))) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    if (error) setError(error.message);
    load();
  };

  return (
    <div className='flex flex-col gap-3'>
      <h3 className='text-base-content text-lg font-semibold'>{_('Two-factor login')}</h3>
      <p className='text-base-content/70 text-sm'>
        {_(
          'Add an authenticator app (TOTP). Every sign-in then asks for a 6-digit code. There are no backup codes, so add a second device.',
        )}
      </p>
      {factors.length > 0 && (
        <ul className='flex flex-col gap-2 text-sm'>
          {factors.map((factor) => (
            <li key={factor.id} className='flex items-center justify-between gap-3'>
              <span>{factor.friendly_name ?? factor.id}</span>
              <button
                type='button'
                disabled={busy}
                onClick={() => handleRemove(factor.id)}
                className='text-error underline disabled:opacity-60'
              >
                {_('Remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pending ? (
        <form onSubmit={handleVerify} className='flex flex-col gap-3'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pending.qr}
            alt={_('QR code for the authenticator app')}
            className='h-48 w-48 rounded-lg bg-white p-2'
          />
          <p className='text-base-content/60 break-all text-xs'>
            {_('Or enter manually:')} {pending.secret}
          </p>
          <input
            name='code'
            inputMode='numeric'
            pattern='[0-9]{6}'
            maxLength={6}
            required
            autoComplete='one-time-code'
            placeholder={_('6-digit code')}
            className='input eink-bordered w-full rounded-lg'
          />
          <button type='submit' className='btn btn-primary rounded-lg' disabled={busy}>
            {_('Verify')}
          </button>
        </form>
      ) : (
        <button
          type='button'
          className='btn btn-primary rounded-lg'
          disabled={busy}
          onClick={handleEnroll}
        >
          {_('Add authenticator')}
        </button>
      )}
      {error && <p className='text-error text-sm'>{error}</p>}
    </div>
  );
}
