export interface BookRequestRow {
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
}

export const REQUEST_COLUMNS =
  'id, owner_id, requester_id, book_hash, book_title, book_author, book_format, message, status, created_at, answered_at';

/** Whether a declined request may be sent again: not before the retry period is over. */
export const mayAskAgain = (answeredAt: string | null, retryDays: number, now = Date.now()) =>
  !answeredAt || now - new Date(answeredAt).getTime() >= retryDays * 24 * 60 * 60 * 1000;
