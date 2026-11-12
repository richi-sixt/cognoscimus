-- Printed books: library entries without a file (books.format = 'PHYSICAL').
-- They need no column of their own; how a book is owned travels in the synced
-- metadata (`physical.owned`, `physical.location`). This migration adds what the
-- server has to know: who a printed book is lent to, and it teaches the shared
-- library about printed books and the wishlist. Run once, after 0024.

-- A printed book handed to someone. Created when the owner accepts a borrow
-- request for a printed book, or by hand (also for people without an account).
CREATE TABLE IF NOT EXISTS public.book_loans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  book_hash text NOT NULL,
  -- Display snapshot, like book_grants.
  book_title text NOT NULL,
  book_author text NULL,
  -- Set when the borrower has an account; the name is what the owner sees.
  borrower_id uuid NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  borrower_name text NOT NULL,
  lent_at timestamp with time zone NOT NULL DEFAULT now(),
  due_at timestamp with time zone NULL,
  returned_at timestamp with time zone NULL,
  CONSTRAINT book_loans_pkey PRIMARY KEY (id),
  CONSTRAINT book_loans_name_len CHECK (char_length(borrower_name) BETWEEN 1 AND 80),
  CONSTRAINT book_loans_not_self CHECK (borrower_id IS NULL OR borrower_id <> owner_id)
);

-- One copy, one borrower: a book is lent again only after it came back.
CREATE UNIQUE INDEX IF NOT EXISTS idx_book_loans_open
  ON public.book_loans (owner_id, book_hash) WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_book_loans_borrower
  ON public.book_loans (borrower_id) WHERE borrower_id IS NOT NULL;

ALTER TABLE public.book_loans ENABLE ROW LEVEL SECURITY;

-- Reads only; the server (service role) checks ownership and writes.
CREATE POLICY book_loans_select_own ON public.book_loans
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id OR (SELECT auth.uid()) = borrower_id);

REVOKE ALL ON public.book_loans FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.book_loans FROM authenticated;

-- Whether a book row is a wish: a printed entry its owner does not own yet. The
-- metadata column holds either an object or the same object as a JSON string.
CREATE OR REPLACE FUNCTION public.book_is_wish(p_format text, p_metadata json)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  doc json := p_metadata;
BEGIN
  IF upper(coalesce(p_format, '')) <> 'PHYSICAL' OR doc IS NULL THEN
    RETURN false;
  END IF;
  IF json_typeof(doc) = 'string' THEN
    doc := (doc #>> '{}')::json;
  END IF;
  RETURN coalesce(doc #>> '{physical,owned}', '') = 'false';
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.book_is_wish(text, json) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_is_wish(text, json) TO authenticated, service_role;

-- The wishlist is private: it is neither counted nor listed for followers.
CREATE OR REPLACE FUNCTION public.library_following_overview()
RETURNS TABLE (user_id uuid, handle text, display_name text, shared_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.handle, p.display_name,
    (SELECT count(*) FROM public.books b
      WHERE b.user_id = p.user_id AND b.deleted_at IS NULL
        AND NOT public.book_is_wish(b.format, b.metadata)
        AND NOT EXISTS (SELECT 1 FROM public.library_hidden h
                        WHERE h.user_id = b.user_id AND h.book_hash = b.book_hash))
  FROM public.follows f
  JOIN public.profiles p ON p.user_id = f.followee_id
  WHERE f.follower_id = auth.uid() AND f.status = 'accepted' AND p.library_shared
  ORDER BY p.handle;
$$;

-- The return type grows by two columns, so the function is created anew.
DROP FUNCTION IF EXISTS public.library_shared_books(uuid, text, integer, text, text);

-- One page of a shared library. `is_physical`: a printed book, handed over in
-- person. `lent`: that printed book is with someone right now.
CREATE FUNCTION public.library_shared_books(
  p_owner uuid,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 24,
  p_after_title text DEFAULT NULL,
  p_after_hash text DEFAULT NULL
)
RETURNS TABLE (
  book_hash text,
  title text,
  author text,
  format text,
  cover_hash text,
  has_file boolean,
  is_physical boolean,
  lent boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.book_hash, coalesce(b.title, ''), b.author, b.format, b.cover_hash,
         b.uploaded_at IS NOT NULL,
         upper(coalesce(b.format, '')) = 'PHYSICAL',
         upper(coalesce(b.format, '')) = 'PHYSICAL'
           AND EXISTS (SELECT 1 FROM public.book_loans l
                       WHERE l.owner_id = b.user_id AND l.book_hash = b.book_hash
                         AND l.returned_at IS NULL)
  FROM public.books b
  WHERE public.library_visible_to_caller(p_owner)
    AND b.user_id = p_owner AND b.deleted_at IS NULL
    AND NOT public.book_is_wish(b.format, b.metadata)
    AND NOT EXISTS (SELECT 1 FROM public.library_hidden h
                    WHERE h.user_id = b.user_id AND h.book_hash = b.book_hash)
    AND (p_query IS NULL OR p_query = ''
         OR b.title ILIKE '%' || replace(replace(p_query, '%', ''), '_', '') || '%'
         OR b.author ILIKE '%' || replace(replace(p_query, '%', ''), '_', '') || '%')
    AND (p_after_hash IS NULL
         OR (coalesce(b.title, ''), b.book_hash) > (coalesce(p_after_title, ''), p_after_hash))
  ORDER BY coalesce(b.title, ''), b.book_hash
  LIMIT greatest(1, least(coalesce(p_limit, 24), 60));
$$;

REVOKE ALL ON FUNCTION public.library_following_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.library_shared_books(uuid, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_following_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.library_shared_books(uuid, text, integer, text, text) TO authenticated;
