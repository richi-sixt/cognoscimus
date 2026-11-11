'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';
import { START_APP_KEY, type StartApp, startAppOf } from '@/utils/startApp';

/** Which part of the app opens after signing in and when the app is started. */
export function StartAppSection() {
  const _ = useTranslation();
  const { user } = useAuth();
  const [choice, setChoice] = useState<StartApp>(() => startAppOf(user));
  const [error, setError] = useState('');

  useEffect(() => setChoice(startAppOf(user)), [user]);

  if (!user) return null;

  const choose = async (next: StartApp) => {
    const previous = choice;
    setChoice(next);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({
      data: { [START_APP_KEY]: next },
    });
    if (updateError) {
      setChoice(previous);
      setError(updateError.message);
    }
  };

  const options: { value: StartApp; label: string }[] = [
    { value: 'library', label: _('Library') },
    { value: 'later', label: 'Later' },
  ];

  return (
    <div className='flex flex-col gap-3'>
      <h3 className='text-base-content text-lg font-semibold'>{_('Start with')}</h3>
      <p className='text-base-content/70 text-sm'>
        {_('The part that opens after you sign in and when you start the app, on every device.')}
      </p>
      <div className='flex gap-4 text-sm' role='radiogroup' aria-label={_('Start with')}>
        {options.map((option) => (
          <label key={option.value} className='flex items-center gap-2'>
            <input
              type='radio'
              name='start-app'
              className='radio radio-sm'
              checked={choice === option.value}
              onChange={() => void choose(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && (
        <p className='text-error text-sm' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
}
