-- Profiles and follows for the read-later reader. Run once, after 0015.
--
-- A profile gives a person a handle to be found by; the e-mail address is never
-- shown. Nobody can list profiles: a stranger is found only by the exact handle
-- and only if the owner switched "discoverable" on. A follow starts as a
-- request that the followed person accepts, declines or blocks.

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid NOT NULL,
  handle text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  discoverable boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT profiles_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT profiles_handle_check CHECK (handle ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  CONSTRAINT profiles_display_name_check CHECK (char_length(display_name) <= 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON public.profiles (handle);

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id uuid NOT NULL,
  followee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT follows_pkey PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT follows_follower_fkey FOREIGN KEY (follower_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  CONSTRAINT follows_followee_fkey FOREIGN KEY (followee_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  CONSTRAINT follows_status_check CHECK (status IN ('pending', 'accepted', 'blocked')),
  CONSTRAINT follows_not_self_check CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON public.follows (followee_id, status);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- A follow is visible to both sides, except that a blocked person sees nothing:
-- from their side the request just stays unanswered.
CREATE POLICY follows_select ON public.follows
  FOR SELECT TO authenticated
  USING (
    followee_id = (SELECT auth.uid())
    OR (follower_id = (SELECT auth.uid()) AND status <> 'blocked')
  );

-- The followed person accepts or blocks; only the status can change.
CREATE POLICY follows_update_followee ON public.follows
  FOR UPDATE TO authenticated
  USING (followee_id = (SELECT auth.uid()))
  WITH CHECK (followee_id = (SELECT auth.uid()) AND status IN ('accepted', 'blocked'));

-- Either side can end a follow, but a block stays until the blocker lifts it.
CREATE POLICY follows_delete ON public.follows
  FOR DELETE TO authenticated
  USING (
    followee_id = (SELECT auth.uid())
    OR (follower_id = (SELECT auth.uid()) AND status <> 'blocked')
  );

REVOKE ALL ON public.follows FROM anon;
REVOKE INSERT, UPDATE ON public.follows FROM authenticated;
GRANT UPDATE (status) ON public.follows TO authenticated;

-- Own profile, plus the profile of anyone in a follow with me, so lists can show
-- handles and names.
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.follows f
      WHERE (f.follower_id = (SELECT auth.uid()) AND f.followee_id = profiles.user_id)
         OR (f.followee_id = (SELECT auth.uid()) AND f.follower_id = profiles.user_id)
    )
  );
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.profiles FROM anon;

-- Sends a follow request to the discoverable profile with this exact handle.
-- Returns 'requested', 'profile_required' (the caller has no profile yet) or
-- 'not_found' (no such handle, or the owner is not discoverable: the two look
-- the same on purpose). Asking again, or after a block, changes nothing.
CREATE OR REPLACE FUNCTION public.later_follow(p_handle text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  target uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = me) THEN
    RETURN 'profile_required';
  END IF;
  SELECT user_id INTO target FROM public.profiles
    WHERE handle = lower(trim(p_handle)) AND discoverable AND user_id <> me;
  IF target IS NULL THEN
    RETURN 'not_found';
  END IF;
  INSERT INTO public.follows (follower_id, followee_id) VALUES (me, target)
    ON CONFLICT DO NOTHING;
  RETURN 'requested';
END;
$$;

REVOKE ALL ON FUNCTION public.later_follow(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.later_follow(text) TO authenticated;
