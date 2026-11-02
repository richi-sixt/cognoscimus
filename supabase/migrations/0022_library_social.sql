-- Library for followers: followed people can browse a shared library (title,
-- author, format, cover) and ask to borrow a book. The owner decides each
-- request; accepting creates an ordinary book_grants row (0007) in the server.
-- Reuses profiles/follows (0016). Run once, after 0021.

-- A library is private until its owner switches it on.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS library_shared boolean NOT NULL DEFAULT false;

-- Books the owner keeps out of the shared view. Separate from `books`, which the
-- sync API writes, so the sync needs no change.
CREATE TABLE IF NOT EXISTS public.library_hidden (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  book_hash text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT library_hidden_pkey PRIMARY KEY (user_id, book_hash)
);

ALTER TABLE public.library_hidden ENABLE ROW LEVEL SECURITY;
CREATE POLICY library_hidden_own ON public.library_hidden
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.library_hidden FROM anon;

-- Whether the caller may see this person's shared library: an accepted follow
-- and the owner's opt-in. Used by the RPCs below and by the cover route.
CREATE OR REPLACE FUNCTION public.library_visible_to_caller(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.later_is_follower_of(p_owner)
    AND EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_owner AND library_shared);
$$;

REVOKE ALL ON FUNCTION public.library_visible_to_caller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_visible_to_caller(uuid) TO authenticated, service_role;

-- The people the caller follows (accepted) who share a library, with a count.
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
        AND NOT EXISTS (SELECT 1 FROM public.library_hidden h
                        WHERE h.user_id = b.user_id AND h.book_hash = b.book_hash))
  FROM public.follows f
  JOIN public.profiles p ON p.user_id = f.followee_id
  WHERE f.follower_id = auth.uid() AND f.status = 'accepted' AND p.library_shared
  ORDER BY p.handle;
$$;

-- One page of a shared library, ordered by title. Only display data leaves the
-- database: no progress, reading status or metadata. `has_file` tells whether the
-- book can be borrowed. The cursor is the last (title, hash) of the previous page.
CREATE OR REPLACE FUNCTION public.library_shared_books(
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
  has_file boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.book_hash, coalesce(b.title, ''), b.author, b.format, b.cover_hash,
         b.uploaded_at IS NOT NULL
  FROM public.books b
  WHERE public.library_visible_to_caller(p_owner)
    AND b.user_id = p_owner AND b.deleted_at IS NULL
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

-- A request to borrow a book. One row per person and book: asking again after a
-- decline (the server waits 30 days) reuses it. Accepting creates the grant.
CREATE TABLE IF NOT EXISTS public.book_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  book_hash text NOT NULL,
  -- Display snapshot, like book_grants, so lists need no access to the library.
  book_title text NOT NULL,
  book_author text NULL,
  book_format text NOT NULL,
  message text NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  answered_at timestamp with time zone NULL,
  CONSTRAINT book_requests_pkey PRIMARY KEY (id),
  CONSTRAINT book_requests_unique UNIQUE (owner_id, requester_id, book_hash),
  CONSTRAINT book_requests_status CHECK (status IN ('pending', 'accepted', 'declined')),
  CONSTRAINT book_requests_not_self CHECK (owner_id <> requester_id),
  CONSTRAINT book_requests_message_len CHECK (message IS NULL OR char_length(message) <= 300)
);

CREATE INDEX IF NOT EXISTS idx_book_requests_owner ON public.book_requests (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_book_requests_requester ON public.book_requests (requester_id, status);

ALTER TABLE public.book_requests ENABLE ROW LEVEL SECURITY;

-- Reads only; the server (service role) checks follow, visibility and limits.
CREATE POLICY book_requests_select_own ON public.book_requests
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id OR (SELECT auth.uid()) = requester_id);

REVOKE ALL ON public.book_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.book_requests FROM authenticated;
