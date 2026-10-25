-- Account-bound, time-limited book grants. Replaces the anonymous share links
-- of 0004: a book is shared with one signed-in user until `expires_at`, and the
-- owner can revoke earlier. Run once, after 0006.

DROP FUNCTION IF EXISTS public.increment_book_share_download(text, timestamp with time zone);
DROP TABLE IF EXISTS public.book_shares;

CREATE TABLE IF NOT EXISTS public.book_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  grantee_id uuid NOT NULL,
  book_hash text NOT NULL,
  -- Snapshot of the book's display data, so the grantee's list needs no access
  -- to the owner's library rows.
  book_title text NOT NULL,
  book_author text NULL,
  book_format text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT book_grants_pkey PRIMARY KEY (id),
  -- Sharing the same book with the same person again renews this row.
  CONSTRAINT book_grants_unique UNIQUE (owner_id, grantee_id, book_hash),
  CONSTRAINT book_grants_owner_fkey FOREIGN KEY (owner_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT book_grants_grantee_fkey FOREIGN KEY (grantee_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT book_grants_not_self CHECK (owner_id <> grantee_id)
);

CREATE INDEX IF NOT EXISTS idx_book_grants_grantee ON public.book_grants (grantee_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_book_grants_owner ON public.book_grants (owner_id, created_at DESC);

ALTER TABLE public.book_grants ENABLE ROW LEVEL SECURITY;

-- Reads only. Every write goes through the server (service role), which checks
-- ownership and quotas, so there are deliberately no write policies.
CREATE POLICY book_grants_select_owner ON public.book_grants
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY book_grants_select_grantee ON public.book_grants
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = grantee_id AND revoked_at IS NULL AND expires_at > now());

REVOKE ALL ON public.book_grants FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.book_grants FROM authenticated;

-- Resolve an invited user by email. Server only: exposing this to the API roles
-- would let anyone enumerate accounts.
CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO service_role;
