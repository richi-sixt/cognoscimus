-- Authorization: who may administer cognoscimus (invite users, manage grants).
-- Pattern from digital-handshake: an email allowlist that the API cannot reach
-- directly (RLS on, no policies), queried only through a SECURITY DEFINER
-- function that compares against the email in the caller's JWT.
--
-- Sign-ups stay disabled in the Supabase dashboard; users are invited there.
-- The first admin email is inserted by a local one-off script
-- (supabase/local/admin_email.sql, gitignored), never committed.

CREATE TABLE IF NOT EXISTS public.admin_emails (
  email text PRIMARY KEY
);

ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: not readable or writable through PostgREST.
REVOKE ALL ON public.admin_emails FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_emails
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
