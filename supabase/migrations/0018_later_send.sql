-- Sending an article to a person. Run once, after 0017.
--
-- The sender picks one of their articles and the exact handle of a discoverable
-- profile. Nothing reaches the recipient's library until they accept: the offer
-- is a snapshot held in `later_shares`, and accepting copies it into their
-- library with a note "from @handle". Declining deletes it. Both tables are
-- written only through the functions below.

ALTER TABLE public.later_items ADD COLUMN IF NOT EXISTS shared_from text NULL;

CREATE TABLE IF NOT EXISTS public.later_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  author text NULL,
  site_name text NULL,
  excerpt text NULL,
  content_html text NOT NULL,
  content_text text NOT NULL DEFAULT '',
  word_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_shares_pkey PRIMARY KEY (id),
  CONSTRAINT later_shares_sender_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  CONSTRAINT later_shares_recipient_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  CONSTRAINT later_shares_once UNIQUE (sender_id, recipient_id, url)
);

CREATE INDEX IF NOT EXISTS idx_later_shares_recipient ON public.later_shares (recipient_id, created_at DESC);

ALTER TABLE public.later_shares ENABLE ROW LEVEL SECURITY;

-- The recipient reads their offers. The sender gets no read access: what was sent
-- is the recipient's to answer, and a sender cannot tell whether it is still open.
CREATE POLICY later_shares_select_recipient ON public.later_shares
  FOR SELECT TO authenticated
  USING (recipient_id = (SELECT auth.uid()));

REVOKE ALL ON public.later_shares FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.later_shares FROM authenticated;

-- Sends one of the caller's articles to the discoverable profile with this exact
-- handle. Returns 'sent', 'profile_required', 'not_found' (no such handle, not
-- discoverable, or yourself) or 'no_article' (not the caller's, or still unfetched).
-- A person who blocked the sender looks like a successful send.
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
    (sender_id, recipient_id, url, title, author, site_name, excerpt, content_html, content_text, word_count)
  VALUES
    (me, target, it.url, it.title, it.author, it.site_name, it.excerpt, it.content_html, it.content_text, it.word_count)
  ON CONFLICT ON CONSTRAINT later_shares_once DO NOTHING;
  RETURN 'sent';
END;
$$;

-- The offers waiting for the caller, with who sent them (no text, for the list).
CREATE OR REPLACE FUNCTION public.later_incoming_shares()
RETURNS TABLE (id uuid, title text, word_count integer, created_at timestamp with time zone,
               sender_handle text, sender_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.title, s.word_count, s.created_at, p.handle, p.display_name
  FROM public.later_shares s
  JOIN public.profiles p ON p.user_id = s.sender_id
  WHERE s.recipient_id = auth.uid()
  ORDER BY s.created_at DESC;
$$;

-- Accepts (copies into the caller's library) or declines an offer. Returns the new
-- article's id, or null when declined or when the caller already had that address.
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
       fetch_state, kind, shared_from)
    VALUES
      (me, s.url, s.title, s.author, s.site_name, s.excerpt, s.content_html, s.content_text,
       s.word_count, 'ready', 'article', sender)
    ON CONFLICT (user_id, url) DO NOTHING
    RETURNING id INTO new_id;
  END IF;
  DELETE FROM public.later_shares WHERE id = p_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.later_send(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_incoming_shares() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.later_answer_share(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.later_send(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_incoming_shares() TO authenticated;
GRANT EXECUTE ON FUNCTION public.later_answer_share(uuid, boolean) TO authenticated;
