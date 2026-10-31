-- Read-later: saved searches (a named combination of scope, search text, label
-- and type filters). Run once, after 0014.
--
-- `query` is only what the client needs to restore the view; it holds ids and
-- search text, never article content, so the user may write it directly.

CREATE TABLE IF NOT EXISTS public.later_saved_searches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  query jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_saved_searches_pkey PRIMARY KEY (id),
  CONSTRAINT later_saved_searches_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_saved_searches_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT later_saved_searches_query_check
    CHECK (jsonb_typeof(query) = 'object' AND pg_column_size(query) < 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_later_saved_searches_user_name
  ON public.later_saved_searches (user_id, lower(name));

ALTER TABLE public.later_saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_saved_searches_own ON public.later_saved_searches
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.later_saved_searches FROM anon;
