// Kept apart from client.ts so the server route does not pull in the browser
// Supabase client.
export const TRASH_RETENTION_DAYS = 30;

/** Most links one import request may carry; the client sends smaller batches. */
export const IMPORT_MAX_ENTRIES = 200;
export const IMPORT_BATCH_SIZE = 100;
/** How many articles are fetched at the same time after an import. */
export const FETCH_CONCURRENCY = 3;
