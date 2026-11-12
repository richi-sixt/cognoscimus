import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';

/** A printed book that is with someone. */
export interface BookLoan {
  id: string;
  book_hash: string;
  borrower_name: string;
  lent_at: string;
  due_at: string | null;
}

export class LoanApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'LoanApiError';
  }
}

const post = async (path: string, body?: unknown): Promise<Response> => {
  const token = await getAccessToken();
  if (!token) throw new LoanApiError(401, 'unauthenticated', 'Not authenticated');
  const response = await fetch(`${getAPIBaseUrl()}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    let code: string | undefined;
    let message = response.statusText || 'Request failed';
    try {
      const json = (await response.json()) as { error?: string; code?: string };
      if (json?.error) message = json.error;
      if (json?.code) code = json.code;
    } catch {
      // Not JSON; keep the default message.
    }
    throw new LoanApiError(response.status, code, message);
  }
  return response;
};

/** Who has my printed copy of this book right now, if anyone. */
export const getOpenLoan = async (ownerId: string, bookHash: string): Promise<BookLoan | null> => {
  const { data, error } = await supabase
    .from('book_loans')
    .select('id, book_hash, borrower_name, lent_at, due_at')
    .eq('owner_id', ownerId)
    .eq('book_hash', bookHash)
    .is('returned_at', null)
    .maybeSingle();
  if (error) throw error;
  return (data as BookLoan | null) ?? null;
};

export const lendBook = async (input: {
  bookHash: string;
  borrowerName: string;
  dueDate?: string;
}): Promise<BookLoan> => {
  const response = await post('/loans/create', input);
  return ((await response.json()) as { loan: BookLoan }).loan;
};

export const returnLoan = async (id: string): Promise<void> => {
  await post(`/loans/${id}/return`);
};
