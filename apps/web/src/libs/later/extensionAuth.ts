import { createHash, randomBytes } from 'node:crypto';
import { validateUserAndToken } from '@/utils/access';
import { createSupabaseAdminClient } from '@/utils/supabase';

// The browser extension signs in with a token of its own instead of a session.
// Only its hash is stored. The token is random and long, so a plain SHA-256 is
// enough; there is nothing to guess.

const PREFIX = 'cgl_';
const TOKEN_RE = /^cgl_[A-Za-z0-9_-]{43}$/;

/** Tokens one person may hold, one per connected browser. */
export const EXTENSION_TOKENS_MAX = 10;

export const newExtensionToken = () => `${PREFIX}${randomBytes(32).toString('base64url')}`;

export const isExtensionToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_RE.test(value);

export const hashExtensionToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const bearer = (request: Request) =>
  (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');

/** The owner of an extension token, or null when the request carries none that is valid. */
export const extensionTokenOwner = async (
  request: Request,
): Promise<{ userId: string; tokenId: string } | null> => {
  const token = bearer(request);
  if (!isExtensionToken(token)) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('later_extension_tokens')
    .select('id, user_id')
    .eq('token_hash', hashExtensionToken(token))
    .maybeSingle();
  if (error || !data) return null;
  // Shown in the settings so an unused connection can be spotted and removed.
  await supabase
    .from('later_extension_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);
  return { userId: data.user_id as string, tokenId: data.id as string };
};

/**
 * Who is asking, for the Later routes the extension may use: the owner of an
 * extension token, or the signed-in user of the web app.
 */
export const authenticateLater = async (request: Request): Promise<{ userId: string } | null> => {
  const owner = await extensionTokenOwner(request);
  if (owner) return { userId: owner.userId };
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  return user && token ? { userId: user.id } : null;
};
