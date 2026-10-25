import { mergeBookshelfStates } from '@/services/bookshelves/state';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';

/**
 * Cross-window global-settings sync.
 *
 * On desktop the app runs multiple windows (one library + one per open book),
 * and each keeps its own in-memory settings loaded once at window open. Global
 * settings persist to a single shared `settings.json`, and every window writes
 * the whole object on save. A window that loaded before the user customized a
 * global setting therefore clobbers that change with its own stale (often
 * default) value the next time it saves — e.g. a reader window reverting
 * "Click to Paginate" back to the default on close (issue #4580).
 *
 * To keep windows consistent, the persisting window broadcasts its global
 * setting blobs and every other window adopts them, so a later save no longer
 * carries stale globals. Only `globalViewSettings` / `globalReadSettings` —
 * the truly-global objects edited in the Settings dialog — are synced; every
 * device/window-local field (filesystem paths, `lastOpenBooks`, sync cursors,
 * screen brightness, ...) is left untouched on the receiving window.
 */
export const SETTINGS_SYNC_EVENT = 'global-settings-window-sync';

/**
 * Minimal cloud-sync selection payload: only the Cognoscimus Cloud switch,
 * never credentials. Absent when the source window has never had the slice
 * written; `enabled` is itself optional because `undefined` is meaningful
 * (on by default), and coercing it to `false` would silently switch sync off on
 * the receiver.
 */
export interface CloudSyncProviderFlags {
  cognoscimusCloud?: { enabled?: boolean; disabledAt?: number };
}

export interface SettingsSyncPayload {
  bookshelves?: SystemSettings['bookshelves'];
  /** Label of the window that persisted the change, so receivers ignore their own echo. */
  sourceLabel: string;
  globalViewSettings: SystemSettings['globalViewSettings'];
  globalReadSettings: SystemSettings['globalReadSettings'];
  /**
   * Present only on provider-switch broadcasts (see
   * `persistCloudProviderEnabled`), NOT on routine saves — so a stale
   * window's ordinary settings write can never carry stale flags that
   * revert someone else's switch.
   */
  cloudSyncProviders?: CloudSyncProviderFlags;
}

/**
 * Merge the global setting blobs broadcast by another window into this window's
 * settings, preserving every device/window-local field on the local copy.
 */
export const mergeSyncedGlobalSettings = (
  local: SystemSettings,
  payload: Pick<
    SettingsSyncPayload,
    'globalViewSettings' | 'globalReadSettings' | 'cloudSyncProviders' | 'bookshelves'
  >,
): SystemSettings => {
  const merged: SystemSettings = {
    ...local,
    globalViewSettings: payload.globalViewSettings,
    globalReadSettings: payload.globalReadSettings,
  };
  if (payload.bookshelves)
    merged.bookshelves = mergeBookshelfStates(local.bookshelves, payload.bookshelves);
  if (payload.cloudSyncProviders) {
    if (payload.cloudSyncProviders.cognoscimusCloud) {
      merged.cognoscimusCloud = {
        ...local.cognoscimusCloud,
        ...payload.cloudSyncProviders.cognoscimusCloud,
      };
    }
  }
  return merged;
};

/**
 * Broadcast this window's global settings to all other windows after a
 * settings write. Fire-and-forget and a no-op off Tauri.
 */
export const broadcastGlobalSettings = async (
  settings: SystemSettings,
  opts: { includeCloudSyncProviders?: boolean } = {},
): Promise<void> => {
  if (!isTauriAppPlatform()) return;
  if (!settings.globalViewSettings || !settings.globalReadSettings) return;
  try {
    const payload: SettingsSyncPayload = {
      sourceLabel: getCurrentWindow().label,
      bookshelves: settings.bookshelves,
      globalViewSettings: settings.globalViewSettings,
      globalReadSettings: settings.globalReadSettings,
    };
    if (opts.includeCloudSyncProviders) {
      payload.cloudSyncProviders = {};
      if (settings.cognoscimusCloud) {
        payload.cloudSyncProviders.cognoscimusCloud = {
          enabled: settings.cognoscimusCloud.enabled,
          disabledAt: settings.cognoscimusCloud.disabledAt,
        };
      }
    }
    await emit(SETTINGS_SYNC_EVENT, payload);
  } catch (err) {
    console.warn('Failed to broadcast settings to other windows', err);
  }
};

/**
 * Subscribe to global-settings broadcasts from other windows. The callback is
 * invoked only for events emitted by a different window. Returns an unlisten
 * function (a no-op resolver off Tauri).
 */
export const subscribeSettingsSync = async (
  onReceive: (payload: SettingsSyncPayload) => void,
): Promise<UnlistenFn> => {
  if (!isTauriAppPlatform()) return () => {};
  const currentLabel = getCurrentWindow().label;
  return listen<SettingsSyncPayload>(SETTINGS_SYNC_EVENT, ({ payload }) => {
    if (!payload || payload.sourceLabel === currentLabel) return;
    onReceive(payload);
  });
};
