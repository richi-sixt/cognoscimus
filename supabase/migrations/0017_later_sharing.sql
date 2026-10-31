-- Sharing for the read-later reader. Run once, after 0016.
--
-- An article is private unless its owner sets it to "followers" or puts it in a
-- collection that is shared (a shared collection includes its sub-collections).
-- Accepted followers read only the title and text through the functions below;
-- they never get a table grant, so labels, collections, highlights, the source
-- address and everything else stay out of reach.

ALTER TABLE public.later_items
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD CONSTRAINT later_items_visibility_check CHECK (visibility IN ('private', 'followers'));

ALTER TABLE public.later_collections
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;

GRANT UPDATE (state, progress, archived_at, deleted_at, collection_id, visibility)
  ON public.later_items TO authenticated;

-- True when the collection, or any collection above it, is shared.
CREATE OR REPLACE FUNCTION public.later_collection_shared(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, shared FROM public.later_collections WHERE id = p_id
    UNION
    SELECT c.id, c.parent_id, c.shared
    FROM public.later_collections c JOIN chain ON c.id = chain.parent_id
  )
  SELECT COALESCE(bool_or(shared), false) FROM chain;
$$;

REVOKE ALL ON FUNCTION public.later_collection_shared(uuid) FROM PUBLIC, anon, authenticated;

-- True when the caller is an accepted follower of the owner.
CREATE OR REPLACE FUNCTION public.later_is_follower_of(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = auth.uid() AND followee_id = p_owner AND status = 'accepted'
  );
$$;

REVOKE ALL ON FUNCTION public.later_is_follower_of(uuid) FROM PUBLIC, anon, authenticated;

-- The people the caller follows (accepted), with how many articles each shares.
CREATE OR REPLACE FUNCTION public.later_following_overview()
RETURNS TABLE (user_id uuid, handle text, display_name text, shared_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.handle, p.display_name,
    (SELECT count(*) FROM public.later_items i
      WHERE i.user_id = p.user_id AND i.deleted_at IS NULL
        AND (i.visibility = 'followers'
             OR (i.collection_id IS NOT NULL AND public.later_collection_shared(i.collection_id))))
  FROM public.follows f
  JOIN public.profiles p ON p.user_id = f.followee_id
  WHERE f.follower_id = auth.uid() AND f.status = 'accepted'
  ORDER BY p.handle;
$$;

-- The titles an accepted follower may see. Nothing for anyone else.
CREATE OR REPLACE FUNCTION public.later_shared_items(p_owner uuid)
RETURNS TABLE (id uuid, title text, word_count integer, saved_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.title, i.word_count, i.saved_at
  FROM public.later_items i
  WHERE public.later_is_follower_of(p_owner)
    AND i.user_id = p_owner AND i.deleted_at IS NULL
    AND (i.visibility = 'followers'
         OR (i.collection_id IS NOT NULL AND public.later_collection_shared(i.collection_id)))
  ORDER BY i.saved_at DESC;
$$;

-- One shared article: title and text only.
CREATE OR REPLACE FUNCTION public.later_shared_item(p_id uuid)
RETURNS TABLE (id uuid, owner_id uuid, title text, content_html text, saved_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.user_id, i.title, i.content_html, i.saved_at
  FROM public.later_items i
  WHERE i.id = p_id AND i.deleted_at IS NULL
    AND public.later_is_follower_of(i.user_id)
    AND (i.visibility = 'followers'
         OR (i.collection_id IS NOT NULL AND public.later_collection_shared(i.collection_id)));
$$;

REVOKE ALL ON FUNCTION public.later_following_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_shared_items(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_shared_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.later_following_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_shared_items(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_shared_item(uuid) TO authenticated;
