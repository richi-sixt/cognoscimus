import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';

const GRANTS_API = getAPIBaseUrl() + '/grants';

export interface BookGrant {
  id: string;
  owner_id: string;
  grantee_id: string;
  book_hash: string;
  book_title: string;
  book_author: string | null;
  book_format: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  grantee_email: string | null;
  owner_email: string | null;
}

export interface GrantDownload {
  url: string;
  bookHash: string;
  title: string;
  author: string | null;
  format: string;
  expiresAt: string;
}

export class GrantApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'GrantApiError';
  }
}

const parseError = async (response: Response): Promise<GrantApiError> => {
  let code: string | undefined;
  let message = response.statusText || 'Request failed';
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    if (body?.error) message = body.error;
    if (body?.code) code = body.code;
  } catch {
    // Body wasn't JSON; keep the default message.
  }
  return new GrantApiError(response.status, code, message);
};

// fetchWithAuth throws on a non-2xx response, which would hide the error code
// the UI needs. These helpers call the API without that wrapper's throw.
const call = async (path: string, init?: RequestInit): Promise<Response> => {
  const token = await getAccessToken();
  if (!token) throw new GrantApiError(401, undefined, 'Not authenticated');
  const response = await fetch(`${GRANTS_API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await parseError(response);
  return response;
};

export const createGrant = async (input: {
  bookHash: string;
  granteeEmail: string;
  expirationDays: number;
}): Promise<BookGrant> => {
  const response = await call('/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return ((await response.json()) as { grant: BookGrant }).grant;
};

export const listGrants = async (role: 'owner' | 'grantee'): Promise<BookGrant[]> => {
  const response = await call(`/list?role=${role}`);
  return ((await response.json()) as { grants: BookGrant[] }).grants;
};

export const revokeGrant = async (id: string): Promise<void> => {
  await call(`/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
};

export const getGrantDownload = async (id: string): Promise<GrantDownload> => {
  const response = await call(`/${encodeURIComponent(id)}/download`);
  return (await response.json()) as GrantDownload;
};
