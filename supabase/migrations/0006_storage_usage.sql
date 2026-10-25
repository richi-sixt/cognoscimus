-- Storage usage of one user, in bytes: the sum of their live file registry rows.
-- Called by the API server (service role) to enforce the per-user quota.
-- SECURITY DEFINER lets it see all rows; it is not callable through the API
-- by signed-in users or anonymous visitors.

CREATE OR REPLACE FUNCTION public.storage_usage_bytes(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(file_size), 0)::bigint
  FROM public.files
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.storage_usage_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_usage_bytes(uuid) TO service_role;
