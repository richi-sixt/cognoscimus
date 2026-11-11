import type { User } from '@supabase/supabase-js';

/** The part of the app a signed-in person lands in. */
export type StartApp = 'library' | 'later';

// Kept in the account's user metadata: it is part of the session, so the start
// page can decide without a request, and it follows the person to every device.
export const START_APP_KEY = 'start_app';

export const startAppOf = (user: Pick<User, 'user_metadata'> | null | undefined): StartApp =>
  user?.user_metadata?.[START_APP_KEY] === 'later' ? 'later' : 'library';

export const startPathOf = (user: Pick<User, 'user_metadata'> | null | undefined) =>
  startAppOf(user) === 'later' ? '/later' : '/library';
