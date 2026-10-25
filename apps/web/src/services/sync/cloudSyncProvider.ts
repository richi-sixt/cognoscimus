import type { SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';

/**
 * Whether Cognoscimus Cloud syncs the library channels (book rows, progress,
 * notes, files) on this device. On unless the user switched it off.
 */
export const isCognoscimusCloudEnabled = (settings: SystemSettings | null | undefined): boolean =>
  settings?.cognoscimusCloud?.enabled ?? true;

/**
 * Whether Cognoscimus Cloud storage may be written to (book file uploads and the
 * native book/progress/note rows). Whether book *files* also go there is
 * governed separately by the Manage Sync "book" toggle and the transfer queue.
 */
export const isCognoscimusCloudStorageActive = (
  settings: SystemSettings | null | undefined,
  _plan?: UserPlan,
): boolean => isCognoscimusCloudEnabled(settings);

/**
 * `isCloudSyncAllowed` needs the UserPlan, which comes from the async
 * auth JWT — non-React modules (transferManager, syncCategories) cannot
 * resolve it synchronously. The plan-resolution flow (auth / quota
 * refresh) writes the latest plan here; gate checks read it back.
 * Defaults to 'free', the most restrictive plan.
 */
let cachedUserPlan: UserPlan = 'free';

export const setCachedUserPlan = (plan: UserPlan | undefined): void => {
  cachedUserPlan = plan ?? 'free';
};

export const getCachedUserPlan = (): UserPlan => cachedUserPlan;

let cachedCustomizationPurchased = false;

export const setCachedCustomizationPurchased = (purchased: boolean | undefined): void => {
  cachedCustomizationPurchased = purchased ?? false;
};

export const getCachedCustomizationPurchased = (): boolean => cachedCustomizationPurchased;
