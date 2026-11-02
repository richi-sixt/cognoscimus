import { getAPIBaseUrl } from '@/services/environment';
import { EXPLORE_PAGE_SIZE } from '@/services/constants';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';
import type { Person } from './social';

/** A followed person who shares a library, with how many books it shows. */
export interface LibraryOwner extends Person {
  shared_count: number;
}

/** One book of a shared library: display data only. */
export interface SharedBook {
  book_hash: string;
  title: string;
  author: string | null;
  format: string | null;
  cover_hash: string | null;
  /** Whether the file is uploaded, so the book can be borrowed. */
  has_file: boolean;
}

export const listLibraryOwners = async (): Promise<LibraryOwner[]> => {
  const { data, error } = await supabase.rpc('library_following_overview');
  if (error) throw error;
  return ((data ?? []) as (Person & { shared_count: number | string })[]).map((p) => ({
    ...p,
    shared_count: Number(p.shared_count),
  }));
};

/** One page of a shared library, ordered by title; pass the last book as `after`. */
export const listSharedBooks = async (
  ownerId: string,
  options: { query?: string; after?: SharedBook | null } = {},
): Promise<SharedBook[]> => {
  const { data, error } = await supabase.rpc('library_shared_books', {
    p_owner: ownerId,
    p_query: options.query?.trim() || null,
    p_limit: EXPLORE_PAGE_SIZE,
    p_after_title: options.after?.title ?? null,
    p_after_hash: options.after?.book_hash ?? null,
  });
  if (error) throw error;
  return (data ?? []) as SharedBook[];
};

export class ExploreApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ExploreApiError';
  }
}

// Like libs/grants: fetchWithAuth throws on a non-2xx response and would hide
// the error code the UI shows.
const call = async (path: string, init?: RequestInit): Promise<Response> => {
  const token = await getAccessToken();
  if (!token) throw new ExploreApiError(401, undefined, 'Not authenticated');
  const response = await fetch(`${getAPIBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let code: string | undefined;
    let message = response.statusText || 'Request failed';
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      // Not JSON; keep the default message.
    }
    throw new ExploreApiError(response.status, code, message);
  }
  return response;
};

const post = (path: string, body: unknown) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Signed cover URLs for a page of a shared library, keyed by book hash. */
export const getSharedCovers = async (
  ownerId: string,
  hashes: string[],
): Promise<Record<string, string>> => {
  if (hashes.length === 0) return {};
  const response = await post('/explore/covers', { ownerId, hashes });
  return ((await response.json()) as { urls: Record<string, string> }).urls;
};

export interface BookRequest {
  id: string;
  owner_id: string;
  requester_id: string;
  book_hash: string;
  book_title: string;
  book_author: string | null;
  book_format: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  answered_at: string | null;
  other_handle: string;
  other_name: string;
}

/** `owner`: requests for my books. `requester`: the requests I sent. */
export const listBookRequests = async (role: 'owner' | 'requester'): Promise<BookRequest[]> => {
  const response = await call(`/requests/list?role=${role}`);
  return ((await response.json()) as { requests: BookRequest[] }).requests;
};

export const requestBook = async (input: {
  ownerId: string;
  bookHash: string;
  message?: string;
}): Promise<void> => {
  await post('/requests/create', input);
};

export const answerBookRequest = async (
  id: string,
  answer: { accept: false } | { accept: true; expirationDays: number },
): Promise<void> => {
  await post(`/requests/${id}/answer`, answer);
};

/** Books I keep out of my shared library. */
export const listHiddenBooks = async (userId: string): Promise<Set<string>> => {
  const { data, error } = await supabase
    .from('library_hidden')
    .select('book_hash')
    .eq('user_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.book_hash as string));
};

export const setBookHidden = async (userId: string, bookHash: string, hidden: boolean) => {
  const { error } = hidden
    ? await supabase
        .from('library_hidden')
        .upsert({ user_id: userId, book_hash: bookHash }, { onConflict: 'user_id,book_hash' })
    : await supabase
        .from('library_hidden')
        .delete()
        .eq('user_id', userId)
        .eq('book_hash', bookHash);
  if (error) throw error;
};
