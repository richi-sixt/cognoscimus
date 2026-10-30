-- Highlights and notes inside saved articles. A highlight is found again by its
-- text and the text around it (quote, prefix, suffix), not by a position, so it
-- survives when the stored copy of an article is refreshed. Run once, after 0010.

CREATE TABLE IF NOT EXISTS public.later_highlights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  user_id uuid NOT NULL,
  quote text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  suffix text NOT NULL DEFAULT '',
  annotation text NULL,
  color text NOT NULL DEFAULT 'yellow',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_highlights_pkey PRIMARY KEY (id),
  CONSTRAINT later_highlights_item_fkey FOREIGN KEY (item_id) REFERENCES public.later_items (id) ON DELETE CASCADE,
  CONSTRAINT later_highlights_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_highlights_quote_check CHECK (char_length(quote) BETWEEN 1 AND 2000),
  CONSTRAINT later_highlights_context_check CHECK (char_length(prefix) <= 200 AND char_length(suffix) <= 200),
  CONSTRAINT later_highlights_annotation_check CHECK (annotation IS NULL OR char_length(annotation) <= 5000),
  CONSTRAINT later_highlights_color_check CHECK (color IN ('yellow', 'green', 'blue', 'pink'))
);

CREATE INDEX IF NOT EXISTS idx_later_highlights_item ON public.later_highlights (item_id, created_at);

ALTER TABLE public.later_highlights ENABLE ROW LEVEL SECURITY;

-- The text is always shown as plain text, never as HTML, so the client may write
-- it directly. A highlight must sit on the user's own article.
CREATE POLICY later_highlights_own ON public.later_highlights
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.later_items i WHERE i.id = item_id AND i.user_id = (SELECT auth.uid()))
  );

REVOKE ALL ON public.later_highlights FROM anon;
