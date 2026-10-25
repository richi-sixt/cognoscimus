import clsx from 'clsx';
import React from 'react';
import { MdChevronRight } from 'react-icons/md';
import { RiCloudFill } from 'react-icons/ri';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isCognoscimusCloudEnabled } from '@/services/sync/cloudSyncProvider';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { SectionTitle, SettingLabel } from './primitives';

/**
 * Sync panel. Cognoscimus Cloud is the only sync target; the row switches
 * library sync on or off for this device and opens the account page.
 */
const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig } = useEnv();
  const { user } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const enabled = isCognoscimusCloudEnabled(settings);

  const handleToggle = (next: boolean) => {
    const updated = {
      ...settings,
      cognoscimusCloud: {
        ...settings.cognoscimusCloud,
        enabled: next,
        // Anchors "when did this device stop writing rows" for a later resume.
        disabledAt: next ? undefined : Date.now(),
      },
    };
    setSettings(updated);
    void saveSettings(envConfig, updated);
  };

  const status = !user
    ? _('Sign in to sync')
    : enabled
      ? _('Syncing your library, progress, and highlights')
      : _('Off');

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Sync')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Sync your library, reading progress, and highlights across your devices.')}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.cloudSync'>
        <SectionTitle className='mb-2'>{_('Cloud Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='group flex w-full items-center gap-3 px-4 py-3'>
            <button
              type='button'
              onClick={() => (user ? navigateToProfile(router) : navigateToLogin(router))}
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-3 text-left',
                'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset',
              )}
            >
              <span
                className={clsx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  'bg-base-200 text-base-content/70',
                  'transition-colors duration-150',
                  'group-hover:bg-base-300/70',
                )}
              >
                <RiCloudFill className='h-5 w-5' />
              </span>
              <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <SettingLabel>{_('Cognoscimus Cloud')}</SettingLabel>
                <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
              </div>
            </button>
            <input
              type='checkbox'
              className='checkbox checkbox-sm shrink-0'
              checked={!!user && enabled}
              disabled={!user}
              onChange={(e) => handleToggle(e.target.checked)}
              aria-label={_('Sync with Cognoscimus Cloud')}
              title={_('Sync with Cognoscimus Cloud')}
            />
            <MdChevronRight className='text-base-content/50 h-5 w-5 shrink-0' />
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntegrationsPanel;
