-- Mail inbox for the read-later reader. Run once, after 0020.
--
-- A person mails a link or a newsletter to the inbox address and it lands in
-- their Later library. The sender address decides whose library: the account's
-- own e-mail address, or one of the extra addresses kept here (an alias, a second
-- mailbox). The server only trusts an address when SPF or DKIM vouch for it; this
-- table just says which addresses belong to whom. Mail items carry a synthetic
-- address "mail:<hash>" as their url, so there is no source page to open.

CREATE TABLE IF NOT EXISTS public.later_inbox_addresses (
  user_id uuid NOT NULL,
  email text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_inbox_addresses_pkey PRIMARY KEY (user_id, email),
  CONSTRAINT later_inbox_addresses_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_inbox_addresses_email_check
    CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(email) <= 254)
);

-- One address belongs to one person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_later_inbox_addresses_email
  ON public.later_inbox_addresses (email);

ALTER TABLE public.later_inbox_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_inbox_addresses_own ON public.later_inbox_addresses
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.later_inbox_addresses FROM anon;

CREATE OR REPLACE FUNCTION public.later_inbox_addresses_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM public.later_inbox_addresses WHERE user_id = NEW.user_id) >= 5 THEN
    RAISE EXCEPTION 'at most 5 extra addresses';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS later_inbox_addresses_limit ON public.later_inbox_addresses;
CREATE TRIGGER later_inbox_addresses_limit
  BEFORE INSERT ON public.later_inbox_addresses
  FOR EACH ROW EXECUTE FUNCTION public.later_inbox_addresses_limit();

-- Which account an address belongs to: the account e-mail first, then the extra
-- addresses. Server only.
CREATE OR REPLACE FUNCTION public.later_inbox_owner(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT id FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1),
    (SELECT user_id FROM public.later_inbox_addresses WHERE email = lower(trim(p_email)))
  );
$$;

REVOKE ALL ON FUNCTION public.later_inbox_owner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.later_inbox_owner(text) TO service_role;

-- Like later_send, but for the server acting for a person whose mail named a
-- handle: the same checks, the offer waits for the recipient to open or delete it.
CREATE OR REPLACE FUNCTION public.later_send_as(p_sender uuid, p_item uuid, p_handle text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
  it public.later_items%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p_sender) THEN
    RETURN 'profile_required';
  END IF;
  SELECT * INTO it FROM public.later_items
    WHERE id = p_item AND user_id = p_sender AND deleted_at IS NULL AND fetch_state = 'ready';
  IF NOT FOUND THEN
    RETURN 'no_article';
  END IF;
  SELECT user_id INTO target FROM public.profiles
    WHERE handle = lower(trim(p_handle)) AND discoverable AND user_id <> p_sender;
  IF target IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = p_sender AND followee_id = target AND status = 'blocked'
  ) THEN
    RETURN 'sent';
  END IF;
  INSERT INTO public.later_shares
    (sender_id, recipient_id, url, title, author, site_name, excerpt, content_html, content_text,
     word_count, kind, note)
  VALUES
    (p_sender, target, it.url, it.title, it.author, it.site_name, it.excerpt, it.content_html,
     it.content_text, it.word_count, it.kind, CASE WHEN it.share_note THEN it.note END)
  ON CONFLICT ON CONSTRAINT later_shares_once DO NOTHING;
  RETURN 'sent';
END;
$$;

REVOKE ALL ON FUNCTION public.later_send_as(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.later_send_as(uuid, uuid, text) TO service_role;
