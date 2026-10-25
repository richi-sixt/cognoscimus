import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { formatSyncTimeFromNow } from '@/utils/time';
import { isCognoscimusCloudEnabled } from '@/services/sync/cloudSyncProvider';

/** One provider's health. Cognoscimus Cloud is the only provider. */
export interface CloudSyncProviderStatus {
  kind: 'cognoscimus';
  /** Product name — deliberately untranslated. */
  name: string;
  /** Newest successful sync, or 0 when it never synced. */
  lastSyncedAt: number;
  syncing: boolean;
  failed: boolean;
}

export interface CloudSyncStatus {
  /** The providers that sync right now: Cognoscimus Cloud, unless switched off. */
  providers: CloudSyncProviderStatus[];
  /** True while a sync run is in flight. */
  syncing: boolean;
  /** True when the last run ended in a terminal error. */
  failed: boolean;
  /** Newest successful sync, or 0 when it never synced. */
  lastSyncedAt: number;
  /** True when sync is on but there is no account to sync with. */
  needsSignIn: boolean;
  /** Ready-to-render status line for a menu row. */
  label: string;
}

/**
 * Sync health for the library Settings menu and the reader's View menu.
 *
 * `nativeLastSyncedAt` is Cognoscimus Cloud's own "last synced" for the calling
 * surface: the per-book config/notes stamps in the reader, the global cursors
 * in the library. It is only reported while sync is enabled, since those
 * cursors freeze rather than reset when the user turns it off.
 *
 * `bookKey` is kept for call-site compatibility; the status is global.
 */
export const useCloudSyncStatus = (nativeLastSyncedAt = 0, _bookKey?: string): CloudSyncStatus => {
  const _ = useTranslation();
  const { user } = useAuth();
  const settings = useSettingsStore((state) => state.settings);

  return useMemo(() => {
    const enabled = isCognoscimusCloudEnabled(settings);
    const lastSyncedAt = enabled ? nativeLastSyncedAt : 0;
    const needsSignIn = enabled && !user;

    const label = needsSignIn
      ? _('Sign in to Sync')
      : !enabled
        ? _('Sync is off')
        : lastSyncedAt
          ? _('Synced {{time}}', { time: formatSyncTimeFromNow(lastSyncedAt) })
          : _('Never synced');

    const providers: CloudSyncProviderStatus[] = enabled
      ? [
          {
            kind: 'cognoscimus',
            name: 'Cognoscimus Cloud',
            lastSyncedAt,
            syncing: false,
            failed: false,
          },
        ]
      : [];

    return { providers, syncing: false, failed: false, lastSyncedAt, needsSignIn, label };
  }, [_, user, settings, nativeLastSyncedAt]);
};

export default useCloudSyncStatus;
