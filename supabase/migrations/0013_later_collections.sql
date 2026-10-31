-- Collections for read-later: nested folders, an article lives in at most one.
-- Run once, after 0012.

CREATE TABLE IF NOT EXISTS public.later_collections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  parent_id uuid NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_collections_pkey PRIMARY KEY (id),
  CONSTRAINT later_collections_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_collections_parent_fkey FOREIGN KEY (parent_id) REFERENCES public.later_collections (id) ON DELETE SET NULL,
  CONSTRAINT later_collections_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT later_collections_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_later_collections_user ON public.later_collections (user_id, parent_id);

ALTER TABLE public.later_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_collections_own ON public.later_collections
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.later_collections FROM anon;

-- A parent must be the same user's and must not be one of the collection's own
-- descendants, which would close a loop.
CREATE OR REPLACE FUNCTION public.later_check_collection_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.later_collections WHERE id = NEW.parent_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'parent collection not found';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM public.later_collections WHERE id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id FROM public.later_collections c JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a collection cannot move into itself';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER later_collections_parent_check
  BEFORE INSERT OR UPDATE OF parent_id ON public.later_collections
  FOR EACH ROW EXECUTE FUNCTION public.later_check_collection_parent();

-- Deleting a collection leaves its sub-collections at the top level (the foreign
-- key above) and its articles unsorted (the one below). The app moves
-- sub-collections up one level first. That cannot be a trigger here: deleting a
-- whole account removes many collections in one statement, and a trigger that
-- updates sibling rows then fails.

ALTER TABLE public.later_items ADD COLUMN IF NOT EXISTS collection_id uuid NULL;
ALTER TABLE public.later_items
  ADD CONSTRAINT later_items_collection_fkey
  FOREIGN KEY (collection_id) REFERENCES public.later_collections (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_later_items_collection ON public.later_items (user_id, collection_id)
  WHERE deleted_at IS NULL;

GRANT UPDATE (state, progress, archived_at, deleted_at, collection_id) ON public.later_items TO authenticated;

-- The collection an article is put into must belong to the same user.
CREATE OR REPLACE FUNCTION public.later_check_item_collection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.collection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.later_collections WHERE id = NEW.collection_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'collection not found';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER later_items_collection_check
  BEFORE INSERT OR UPDATE OF collection_id ON public.later_items
  FOR EACH ROW EXECUTE FUNCTION public.later_check_item_collection();

-- All numbers the sidebar shows, in one round trip. Row-level security limits
-- every count to the caller's own rows.
CREATE OR REPLACE FUNCTION public.later_sidebar_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'all', count(*) FILTER (WHERE deleted_at IS NULL),
    'inbox', count(*) FILTER (WHERE deleted_at IS NULL AND state <> 'archived'),
    'archive', count(*) FILTER (WHERE deleted_at IS NULL AND state = 'archived'),
    'trash', count(*) FILTER (WHERE deleted_at IS NOT NULL),
    'unsorted', count(*) FILTER (WHERE deleted_at IS NULL AND collection_id IS NULL),
    'collections', COALESCE((
      SELECT jsonb_object_agg(collection_id, n) FROM (
        SELECT collection_id, count(*) AS n FROM public.later_items
        WHERE deleted_at IS NULL AND collection_id IS NOT NULL GROUP BY collection_id
      ) c
    ), '{}'::jsonb),
    'labels', COALESCE((
      SELECT jsonb_object_agg(il.label_id, n) FROM (
        SELECT il.label_id, count(*) AS n
        FROM public.later_item_labels il JOIN public.later_items i ON i.id = il.item_id
        WHERE i.deleted_at IS NULL GROUP BY il.label_id
      ) il
    ), '{}'::jsonb)
  )
  FROM public.later_items;
$$;

REVOKE ALL ON FUNCTION public.later_sidebar_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.later_sidebar_counts() TO authenticated;
