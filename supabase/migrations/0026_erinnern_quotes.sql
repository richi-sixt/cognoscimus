-- Erinnern: the quote collection. A quote has one text and any number of
-- sources (book passage, saved article, manual entry). Saving a quote that
-- already exists adds a source instead of a second quote. Near-duplicates are
-- found with pg_trgm. Run once, after 0025.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Lower case, punctuation and runs of whitespace collapsed: "Same, quote!" and
-- "same quote" count as the same text.
CREATE OR REPLACE FUNCTION public.quote_norm(p_text text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT btrim(regexp_replace(lower(p_text), '[^[:alnum:]]+', ' ', 'g')) $$;

CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  text text NOT NULL,
  note text NULL,
  text_norm text GENERATED ALWAYS AS (public.quote_norm(text)) STORED,
  tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(text, '') || ' ' || coalesce(note, ''))
  ) STORED,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quotes_pkey PRIMARY KEY (id),
  CONSTRAINT quotes_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT quotes_text_check CHECK (char_length(text) BETWEEN 1 AND 5000),
  CONSTRAINT quotes_note_check CHECK (note IS NULL OR char_length(note) <= 5000)
);

-- One quote per text and user; the client merges instead of inserting twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_user_text ON public.quotes (user_id, md5(text_norm));
CREATE INDEX IF NOT EXISTS idx_quotes_tsv ON public.quotes USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_quotes_trgm ON public.quotes USING gin (text_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotes_user_created ON public.quotes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.quote_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  -- Soft link to books (user_id, book_hash): the source stays readable when
  -- the book is deleted, it just loses its "open in book" link.
  book_hash text NULL,
  later_item_id uuid NULL,
  title text NULL,
  author text NULL,
  cfi text NULL,
  prefix text NOT NULL DEFAULT '',
  suffix text NOT NULL DEFAULT '',
  url text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quote_sources_pkey PRIMARY KEY (id),
  CONSTRAINT quote_sources_quote_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes (id) ON DELETE CASCADE,
  CONSTRAINT quote_sources_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT quote_sources_later_fkey FOREIGN KEY (later_item_id) REFERENCES public.later_items (id) ON DELETE SET NULL,
  CONSTRAINT quote_sources_kind_check CHECK (kind IN ('book', 'later', 'manual')),
  CONSTRAINT quote_sources_text_check CHECK (
    char_length(coalesce(title, '')) <= 500
    AND char_length(coalesce(author, '')) <= 500
    AND char_length(coalesce(cfi, '')) <= 2000
    AND char_length(coalesce(url, '')) <= 2000
    AND char_length(prefix) <= 200
    AND char_length(suffix) <= 200
  )
);

CREATE INDEX IF NOT EXISTS idx_quote_sources_quote ON public.quote_sources (quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_sources_user_book ON public.quote_sources (user_id, book_hash);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY quotes_own ON public.quotes
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- A source must sit on the user's own quote.
CREATE POLICY quote_sources_own ON public.quote_sources
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.user_id = (SELECT auth.uid()))
  );

REVOKE ALL ON public.quotes FROM anon;
REVOKE ALL ON public.quote_sources FROM anon;

-- The caller's quotes that look like p_text (1 = same text after
-- normalisation), best match first. SECURITY INVOKER: row-level security
-- limits it to the caller's own quotes.
CREATE OR REPLACE FUNCTION public.find_similar_quotes(p_text text, p_threshold real DEFAULT 0.6)
  RETURNS TABLE (id uuid, text text, similarity real)
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = public, extensions
  AS $$
    SELECT q.id, q.text, similarity(q.text_norm, public.quote_norm(p_text)) AS similarity
    FROM public.quotes q
    WHERE q.user_id = (SELECT auth.uid())
      AND q.text_norm % public.quote_norm(p_text)
      AND similarity(q.text_norm, public.quote_norm(p_text)) >= p_threshold
    ORDER BY similarity DESC
    LIMIT 5
  $$;

-- Pairs of the caller's quotes that look alike, for the "possible duplicates"
-- view.
CREATE OR REPLACE FUNCTION public.quote_duplicate_pairs(p_threshold real DEFAULT 0.6)
  RETURNS TABLE (a_id uuid, b_id uuid, similarity real)
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = public, extensions
  AS $$
    SELECT a.id, b.id, similarity(a.text_norm, b.text_norm) AS similarity
    FROM public.quotes a
    JOIN public.quotes b ON b.user_id = a.user_id AND a.id < b.id AND a.text_norm % b.text_norm
    WHERE a.user_id = (SELECT auth.uid())
      AND similarity(a.text_norm, b.text_norm) >= p_threshold
    ORDER BY similarity DESC
    LIMIT 200
  $$;

REVOKE ALL ON FUNCTION public.find_similar_quotes(text, real) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quote_duplicate_pairs(real) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_similar_quotes(text, real) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quote_duplicate_pairs(real) TO authenticated;
