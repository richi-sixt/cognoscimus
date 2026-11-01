// Kept apart from client.ts so the server route does not pull in the browser
// Supabase client.
export const TRASH_RETENTION_DAYS = 30;

/** Most links one import request may carry; the client sends smaller batches. */
export const IMPORT_MAX_ENTRIES = 200;
export const IMPORT_BATCH_SIZE = 100;
/** How many articles are fetched at the same time after an import. */
export const FETCH_CONCURRENCY = 3;

/** Feeds one person may follow. */
export const FEEDS_MAX = 100;
/** Feeds fetched per run of the scheduled job, and how many at once. */
export const FEED_POLL_BATCH = 20;
export const FEED_POLL_CONCURRENCY = 3;
/** Entries that are no longer new are forgotten after this many days. */
export const FEED_ENTRY_RETENTION_DAYS = 30;
export const FEED_MAX_ERRORS = 10;

/** Items that came by mail have no page; their url is "mail:" plus a hash. */
export const isMailUrl = (url: string) => url.startsWith('mail:');
