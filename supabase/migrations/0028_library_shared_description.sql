-- Followers browsing a shared library also see the book's description, so they
-- can tell whether it is worth borrowing or already read. The description is the
-- publisher text of the book's metadata (shortened to 2000 characters), nothing
-- from the owner's notes, progress or reading status. Run once, after 0027.

CREATE OR REPLACE FUNCTION public.book_description(p_metadata json)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  doc json := p_metadata;
BEGIN
  IF doc IS NULL THEN
    RETURN NULL;
  END IF;
  -- Some rows hold the metadata as a JSON string inside the JSON value.
  IF json_typeof(doc) = 'string' THEN
    doc := (doc #>> '{}')::json;
  END IF;
  RETURN nullif(btrim(left(doc ->> 'description', 2000)), '');
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.book_description(json) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_description(json) TO authenticated, service_role;

-- The return type grows by one column, so the function is created anew.
DROP FUNCTION IF EXISTS public.library_shared_books(uuid, text, integer, text, text);

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
  lent boolean,
  description text
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
                         AND l.returned_at IS NULL),
         public.book_description(b.metadata)
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

REVOKE ALL ON FUNCTION public.library_shared_books(uuid, text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_shared_books(uuid, text, integer, text, text) TO authenticated;
