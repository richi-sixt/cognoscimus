import type { SupabaseClient } from '@supabase/supabase-js';

export interface BookLoanRow {
  id: string;
  owner_id: string;
  book_hash: string;
  book_title: string;
  book_author: string | null;
  borrower_id: string | null;
  borrower_name: string;
  lent_at: string;
  due_at: string | null;
  returned_at: string | null;
}

export const LOAN_COLUMNS =
  'id, owner_id, book_hash, book_title, book_author, borrower_id, borrower_name, lent_at, due_at, returned_at';

export const LOAN_NAME_MAX = 80;

/** The synced metadata of a `books` row: an object, or the same as a JSON string. */
const physicalOf = (metadata: unknown): { owned?: unknown } | null => {
  let doc = metadata;
  if (typeof doc === 'string') {
    try {
      doc = JSON.parse(doc);
    } catch {
      return null;
    }
  }
  const physical = (doc as { physical?: unknown } | null)?.physical;
  return physical && typeof physical === 'object' ? (physical as { owned?: unknown }) : null;
};

export const isPhysicalFormat = (format: unknown): boolean =>
  typeof format === 'string' && format.toUpperCase() === 'PHYSICAL';

/** A printed entry its owner does not own yet. Mirrors `book_is_wish` of 0025. */
export const isWish = (format: unknown, metadata: unknown): boolean =>
  isPhysicalFormat(format) && physicalOf(metadata)?.owned === false;

/** Whether there is a printed copy to hand over: a printed entry, or a file book marked so. */
export const hasPrintedCopy = (format: unknown, metadata: unknown): boolean =>
  isPhysicalFormat(format)
    ? physicalOf(metadata)?.owned !== false
    : physicalOf(metadata)?.owned === true;

/** The borrower's name as the owner typed it, or null when it is empty or too long. */
export const readBorrowerName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= LOAN_NAME_MAX ? name : null;
};

/**
 * An optional return date (`YYYY-MM-DD`). `undefined` means the value is
 * invalid; `null` means none was given.
 */
export const readDueDate = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const time = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(time)) return undefined;
  // Date.parse accepts 2026-02-31 and rolls it over; keep only real days.
  return new Date(time).toISOString().slice(0, 10) === value
    ? new Date(time).toISOString()
    : undefined;
};

export type CreateLoanResult =
  | { loan: BookLoanRow }
  | { error: { status: number; code: string; message: string } };

/**
 * Notes that the owner's printed book is with someone. The book must be the
 * owner's, live, and have a printed copy; one copy is lent to one person.
 */
export const createLoan = async (
  supabase: SupabaseClient,
  input: {
    ownerId: string;
    bookHash: string;
    borrowerId: string | null;
    borrowerName: string;
    dueAt: string | null;
  },
): Promise<CreateLoanResult> => {
  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('title, author, format, metadata')
    .eq('user_id', input.ownerId)
    .eq('book_hash', input.bookHash)
    .is('deleted_at', null)
    .maybeSingle();
  if (bookError) throw bookError;
  if (!book) return { error: { status: 404, code: 'book_not_found', message: 'Book not found' } };
  if (!hasPrintedCopy(book.format, book.metadata)) {
    return {
      error: { status: 409, code: 'no_printed_copy', message: 'There is no printed copy to lend' },
    };
  }

  const { data, error } = await supabase
    .from('book_loans')
    .insert({
      owner_id: input.ownerId,
      book_hash: input.bookHash,
      book_title: book.title || 'Untitled',
      book_author: book.author || null,
      borrower_id: input.borrowerId,
      borrower_name: input.borrowerName,
      due_at: input.dueAt,
    })
    .select(LOAN_COLUMNS)
    .single();
  if (error) {
    // The partial unique index of 0025: the copy is still with someone.
    if (error.code === '23505') {
      return { error: { status: 409, code: 'already_lent', message: 'This book is lent already' } };
    }
    throw error;
  }
  return { loan: data as BookLoanRow };
};

/** Whether the owner's printed book is with someone right now. */
export const isLent = async (
  supabase: SupabaseClient,
  ownerId: string,
  bookHash: string,
): Promise<boolean> => {
  const { count, error } = await supabase
    .from('book_loans')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('book_hash', bookHash)
    .is('returned_at', null);
  if (error) throw error;
  return (count ?? 0) > 0;
};
