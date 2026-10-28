import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTranslation } from '@/hooks/useTranslation';

interface MfaChallengeProps {
  supabaseClient: SupabaseClient;
}

/** Second login step: any verified TOTP factor upgrades the session to aal2. */
export default function MfaChallenge({ supabaseClient }: MfaChallengeProps) {
  const _ = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') || '').trim();
    setError('');
    setLoading(true);
    try {
      const { data: factors } = await supabaseClient.auth.mfa.listFactors();
      // Several devices may each have their own factor; accept any of them.
      for (const factor of factors?.totp ?? []) {
        const { error } = await supabaseClient.auth.mfa.challengeAndVerify({
          factorId: factor.id,
          code,
        });
        // On success the auth state change signs the user in.
        if (!error) return;
      }
      setError(_('The code is not correct.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className='w-full space-y-4'>
      <p className='text-base-content/70 text-center text-sm leading-relaxed'>
        {_('Enter the 6-digit code from your authenticator app.')}
      </p>
      <input
        name='code'
        inputMode='numeric'
        pattern='[0-9]{6}'
        maxLength={6}
        required
        autoFocus
        autoComplete='one-time-code'
        placeholder={_('6-digit code')}
        className='input eink-bordered w-full rounded-lg text-center tracking-widest placeholder:text-sm'
        disabled={loading}
      />
      <button type='submit' className='btn btn-primary w-full rounded-lg' disabled={loading}>
        {loading && <span className='loading loading-spinner loading-sm' aria-hidden='true' />}
        {_('Verify')}
      </button>
      {error && (
        <div className='eink-bordered border-error/30 bg-error/5 text-error rounded-lg border px-3 py-2.5 text-center text-sm leading-relaxed'>
          {error}
        </div>
      )}
      <div className='flex justify-center pt-1 text-sm'>
        <button
          type='button'
          className='text-base-content/70 hover:text-base-content underline underline-offset-2'
          onClick={() => supabaseClient.auth.signOut({ scope: 'local' })}
        >
          {_('Cancel')}
        </button>
      </div>
    </form>
  );
}
