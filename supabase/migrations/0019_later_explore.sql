-- Context for shared articles, and an explore feed. Run once, after 0018.
--
-- Every item can carry a private-by-default-on note ("share_note" lets followers
-- and recipients read it). Followers now see the kind, source address, site,
-- excerpt and note of what is shared with them, and can copy an item into their
-- own library. Labels and unshared collections stay hidden.

ALTER TABLE public.later_items
  ADD COLUMN IF NOT EXISTS note text NULL,
  ADD COLUMN IF NOT EXISTS share_note boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT later_items_note_check CHECK (note IS NULL OR char_length(note) <= 2000);

GRANT UPDATE (state, progress, archived_at, deleted_at, collection_id, visibility, note, share_note)
  ON public.later_items TO authenticated;

ALTER TABLE public.later_shares
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'article',
  ADD COLUMN IF NOT EXISTS note text NULL;

DROP FUNCTION IF EXISTS public.later_shared_items(uuid);
DROP FUNCTION IF EXISTS public.later_shared_item(uuid);
DROP FUNCTION IF EXISTS public.later_incoming_shares();

-- Whether the item is shared with followers, on its own or through a collection.
CREATE OR REPLACE FUNCTION public.later_item_is_shared(i public.later_items)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.visibility = 'followers'
    OR (i.collection_id IS NOT NULL AND public.later_collection_shared(i.collection_id));
$$;

REVOKE ALL ON FUNCTION public.later_item_is_shared(public.later_items) FROM PUBLIC, anon, authenticated;

-- What the people the caller follows share, newest first. p_owner narrows it to one.
CREATE OR REPLACE FUNCTION public.later_shared_feed(p_owner uuid DEFAULT NULL)
RETURNS TABLE (id uuid, owner_id uuid, owner_handle text, owner_name text, title text, kind text,
               site_name text, excerpt text, word_count integer, note text,
               collection_name text, saved_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.user_id, p.handle, p.display_name, i.title, i.kind, i.site_name, i.excerpt,
    i.word_count,
    CASE WHEN i.share_note THEN i.note END,
    CASE WHEN i.collection_id IS NOT NULL AND public.later_collection_shared(i.collection_id)
         THEN (SELECT c.name FROM public.later_collections c WHERE c.id = i.collection_id) END,
    i.saved_at
  FROM public.later_items i
  JOIN public.profiles p ON p.user_id = i.user_id
  WHERE (p_owner IS NULL OR i.user_id = p_owner)
    AND public.later_is_follower_of(i.user_id)
    AND i.deleted_at IS NULL
    AND public.later_item_is_shared(i)
  ORDER BY i.saved_at DESC
  LIMIT 200;
$$;

-- One shared item with its text and source.
CREATE OR REPLACE FUNCTION public.later_shared_item(p_id uuid)
RETURNS TABLE (id uuid, owner_id uuid, owner_handle text, owner_name text, title text, kind text,
               url text, author text, site_name text, content_html text, note text,
               saved_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.user_id, p.handle, p.display_name, i.title, i.kind, i.url, i.author, i.site_name,
    i.content_html, CASE WHEN i.share_note THEN i.note END, i.saved_at
  FROM public.later_items i
  JOIN public.profiles p ON p.user_id = i.user_id
  WHERE i.id = p_id AND i.deleted_at IS NULL
    AND public.later_is_follower_of(i.user_id)
    AND public.later_item_is_shared(i);
$$;

-- Copies a shared item into the caller's library, marked "from @handle". Returns the
-- new id, or null when the caller already has that address.
CREATE OR REPLACE FUNCTION public.later_save_shared(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  it public.later_items%ROWTYPE;
  owner_handle text;
  new_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO it FROM public.later_items WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.later_is_follower_of(it.user_id) OR NOT public.later_item_is_shared(it) THEN
    RETURN NULL;
  END IF;
  SELECT handle INTO owner_handle FROM public.profiles WHERE user_id = it.user_id;
  INSERT INTO public.later_items
    (user_id, url, title, author, site_name, excerpt, content_html, content_text, word_count,
     fetch_state, kind, shared_from, note)
  VALUES
    (me, it.url, it.title, it.author, it.site_name, it.excerpt, it.content_html, it.content_text,
     it.word_count, 'ready', it.kind, owner_handle, CASE WHEN it.share_note THEN it.note END)
  ON CONFLICT (user_id, url) DO NOTHING
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Sending now carries the kind and, when the sender allows it, the note.
CREATE OR REPLACE FUNCTION public.later_send(p_item uuid, p_handle text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  target uuid;
  it public.later_items%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = me) THEN
    RETURN 'profile_required';
  END IF;
  SELECT * INTO it FROM public.later_items
    WHERE id = p_item AND user_id = me AND deleted_at IS NULL AND fetch_state = 'ready';
  IF NOT FOUND THEN
    RETURN 'no_article';
  END IF;
  SELECT user_id INTO target FROM public.profiles
    WHERE handle = lower(trim(p_handle)) AND discoverable AND user_id <> me;
  IF target IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = me AND followee_id = target AND status = 'blocked'
  ) THEN
    RETURN 'sent';
  END IF;
  INSERT INTO public.later_shares
    (sender_id, recipient_id, url, title, author, site_name, excerpt, content_html, content_text,
     word_count, kind, note)
  VALUES
    (me, target, it.url, it.title, it.author, it.site_name, it.excerpt, it.content_html,
     it.content_text, it.word_count, it.kind, CASE WHEN it.share_note THEN it.note END)
  ON CONFLICT ON CONSTRAINT later_shares_once DO NOTHING;
  RETURN 'sent';
END;
$$;

CREATE OR REPLACE FUNCTION public.later_incoming_shares()
RETURNS TABLE (id uuid, title text, kind text, site_name text, excerpt text, word_count integer,
               note text, created_at timestamp with time zone, sender_handle text, sender_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.title, s.kind, s.site_name, s.excerpt, s.word_count, s.note, s.created_at,
    p.handle, p.display_name
  FROM public.later_shares s
  JOIN public.profiles p ON p.user_id = s.sender_id
  WHERE s.recipient_id = auth.uid()
  ORDER BY s.created_at DESC;
$$;

-- One offer in full, to read before deciding.
CREATE OR REPLACE FUNCTION public.later_incoming_share(p_id uuid)
RETURNS TABLE (id uuid, title text, kind text, url text, author text, site_name text,
               content_html text, note text, created_at timestamp with time zone,
               sender_handle text, sender_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.title, s.kind, s.url, s.author, s.site_name, s.content_html, s.note, s.created_at,
    p.handle, p.display_name
  FROM public.later_shares s
  JOIN public.profiles p ON p.user_id = s.sender_id
  WHERE s.id = p_id AND s.recipient_id = auth.uid();
$$;

-- Saving an offer copies it with its kind and note.
CREATE OR REPLACE FUNCTION public.later_answer_share(p_id uuid, p_accept boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  s public.later_shares%ROWTYPE;
  sender text;
  new_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO s FROM public.later_shares WHERE id = p_id AND recipient_id = me;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p_accept THEN
    SELECT handle INTO sender FROM public.profiles WHERE user_id = s.sender_id;
    INSERT INTO public.later_items
      (user_id, url, title, author, site_name, excerpt, content_html, content_text, word_count,
       fetch_state, kind, shared_from, note)
    VALUES
      (me, s.url, s.title, s.author, s.site_name, s.excerpt, s.content_html, s.content_text,
       s.word_count, 'ready', s.kind, sender, s.note)
    ON CONFLICT (user_id, url) DO NOTHING
    RETURNING id INTO new_id;
  END IF;
  DELETE FROM public.later_shares WHERE id = p_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.later_shared_feed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_shared_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_save_shared(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_incoming_shares() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_incoming_share(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.later_shared_feed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_shared_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_save_shared(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_incoming_shares() TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_incoming_share(uuid) TO authenticated;
