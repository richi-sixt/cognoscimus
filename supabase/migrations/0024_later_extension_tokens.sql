-- Browser extension tokens for the read-later reader. Run once, after 0023.
--
-- The extension saves pages without an open session, so it carries a token of
-- its own. A person creates one by confirming "Connect" on /later/connect while
-- signed in; the server hands the token to the extension once and keeps only its
-- SHA-256 hash. A token is accepted by the Later routes the extension uses
-- (save, list collections and labels, set note/collection/labels) and by
-- nothing else. The owner sees and removes tokens in the Later settings.

CREATE TABLE IF NOT EXISTS public.later_extension_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone NULL,
  CONSTRAINT later_extension_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT later_extension_tokens_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_extension_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT later_extension_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT later_extension_tokens_name_check CHECK (char_length(name) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_later_extension_tokens_user
  ON public.later_extension_tokens (user_id);

ALTER TABLE public.later_extension_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_extension_tokens_select_own ON public.later_extension_tokens
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY later_extension_tokens_delete_own ON public.later_extension_tokens
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Only the server creates tokens, and the hash never leaves it: the owner may
-- read the descriptive columns and delete a row.
REVOKE ALL ON public.later_extension_tokens FROM anon, authenticated;
GRANT SELECT (id, user_id, name, created_at, last_used_at) ON public.later_extension_tokens TO authenticated;
GRANT DELETE ON public.later_extension_tokens TO authenticated;
