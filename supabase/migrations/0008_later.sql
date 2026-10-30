-- Read-later: saved web articles with labels and full-text search. Run once,
-- after 0007.
--
-- Articles are fetched and sanitised by the server (service role) and stored
-- as HTML that the reader renders. A client must never be able to insert that
-- HTML itself, so there is deliberately no INSERT policy and the update grant is
-- limited to the reading state.

CREATE TABLE IF NOT EXISTS public.later_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  author text NULL,
  site_name text NULL,
  excerpt text NULL,
  content_html text NOT NULL,
  content_text text NOT NULL DEFAULT '',
  thumbnail text NULL,
  word_count integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'unread',
  progress real NOT NULL DEFAULT 0,
  saved_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone NULL,
  -- 'simple' keeps the index language-neutral: saved articles are German and
  -- English alike.
  tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(author, '') || ' ' || coalesce(content_text, ''))
  ) STORED,
  CONSTRAINT later_items_pkey PRIMARY KEY (id),
  CONSTRAINT later_items_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Saving the same URL twice refreshes the row instead of adding a duplicate.
  CONSTRAINT later_items_user_url_unique UNIQUE (user_id, url),
  CONSTRAINT later_items_state_check CHECK (state IN ('unread', 'reading', 'archived')),
  CONSTRAINT later_items_progress_check CHECK (progress >= 0 AND progress <= 1)
);

CREATE INDEX IF NOT EXISTS idx_later_items_user_state ON public.later_items (user_id, state, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_later_items_tsv ON public.later_items USING gin (tsv);

ALTER TABLE public.later_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_items_select_own ON public.later_items
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY later_items_update_own ON public.later_items
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY later_items_delete_own ON public.later_items
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.later_items FROM anon;
REVOKE INSERT, UPDATE ON public.later_items FROM authenticated;
GRANT UPDATE (state, progress, archived_at) ON public.later_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.later_labels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_labels_pkey PRIMARY KEY (id),
  CONSTRAINT later_labels_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_labels_name_check CHECK (char_length(name) BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_later_labels_user_name ON public.later_labels (user_id, lower(name));

ALTER TABLE public.later_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_labels_own ON public.later_labels
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.later_labels FROM anon;

CREATE TABLE IF NOT EXISTS public.later_item_labels (
  item_id uuid NOT NULL,
  label_id uuid NOT NULL,
  CONSTRAINT later_item_labels_pkey PRIMARY KEY (item_id, label_id),
  CONSTRAINT later_item_labels_item_fkey FOREIGN KEY (item_id) REFERENCES public.later_items (id) ON DELETE CASCADE,
  CONSTRAINT later_item_labels_label_fkey FOREIGN KEY (label_id) REFERENCES public.later_labels (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_later_item_labels_label ON public.later_item_labels (label_id);

ALTER TABLE public.later_item_labels ENABLE ROW LEVEL SECURITY;

-- A link is the user's own only if both the article and the label are.
CREATE POLICY later_item_labels_own ON public.later_item_labels
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.later_items i WHERE i.id = item_id AND i.user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.later_items i WHERE i.id = item_id AND i.user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.later_labels l WHERE l.id = label_id AND l.user_id = (SELECT auth.uid()))
  );

REVOKE ALL ON public.later_item_labels FROM anon;
