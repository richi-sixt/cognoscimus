-- Erinnern: flashcards with spaced repetition (FSRS). A card has a question and
-- an answer (the answer may still be empty for a word sent from a book), any
-- number of sources and any number of groups. A book is a group of its own
-- (kind 'book', linked by book_hash); other groups are made by hand. Sending
-- the same question twice adds a source instead of a second card. Run once,
-- after 0026.

CREATE TABLE IF NOT EXISTS public.card_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  -- Soft link to books (user_id, book_hash), only for kind 'book'.
  book_hash text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT card_groups_pkey PRIMARY KEY (id),
  CONSTRAINT card_groups_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT card_groups_kind_check CHECK (kind IN ('book', 'custom')),
  CONSTRAINT card_groups_name_check CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT card_groups_book_check CHECK ((kind = 'book') = (book_hash IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_groups_book ON public.card_groups (user_id, book_hash) WHERE book_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_groups_name ON public.card_groups (user_id, lower(name)) WHERE kind = 'custom';

CREATE TABLE IF NOT EXISTS public.cards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'card',
  front text NOT NULL,
  back text NOT NULL DEFAULT '',
  front_norm text GENERATED ALWAYS AS (public.quote_norm(front)) STORED,
  quote_id uuid NULL,
  -- FSRS state (ts-fsrs): when it is due and how well it is remembered.
  due_at timestamp with time zone NOT NULL DEFAULT now(),
  stability double precision NOT NULL DEFAULT 0,
  difficulty double precision NOT NULL DEFAULT 0,
  scheduled_days integer NOT NULL DEFAULT 0,
  learning_steps integer NOT NULL DEFAULT 0,
  reps integer NOT NULL DEFAULT 0,
  lapses integer NOT NULL DEFAULT 0,
  state smallint NOT NULL DEFAULT 0,
  last_review_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cards_pkey PRIMARY KEY (id),
  CONSTRAINT cards_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT cards_quote_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes (id) ON DELETE SET NULL,
  CONSTRAINT cards_kind_check CHECK (kind IN ('card', 'word', 'sentence', 'quote')),
  CONSTRAINT cards_front_check CHECK (char_length(front) BETWEEN 1 AND 5000),
  CONSTRAINT cards_back_check CHECK (char_length(back) <= 5000),
  CONSTRAINT cards_state_check CHECK (state BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_user_front ON public.cards (user_id, md5(front_norm));
CREATE INDEX IF NOT EXISTS idx_cards_user_due ON public.cards (user_id, due_at);

CREATE TABLE IF NOT EXISTS public.card_group_members (
  card_id uuid NOT NULL,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  CONSTRAINT card_group_members_pkey PRIMARY KEY (card_id, group_id),
  CONSTRAINT card_group_members_card_fkey FOREIGN KEY (card_id) REFERENCES public.cards (id) ON DELETE CASCADE,
  CONSTRAINT card_group_members_group_fkey FOREIGN KEY (group_id) REFERENCES public.card_groups (id) ON DELETE CASCADE,
  CONSTRAINT card_group_members_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_card_group_members_group ON public.card_group_members (group_id);

CREATE TABLE IF NOT EXISTS public.card_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  book_hash text NULL,
  later_item_id uuid NULL,
  title text NULL,
  author text NULL,
  cfi text NULL,
  url text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT card_sources_pkey PRIMARY KEY (id),
  CONSTRAINT card_sources_card_fkey FOREIGN KEY (card_id) REFERENCES public.cards (id) ON DELETE CASCADE,
  CONSTRAINT card_sources_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT card_sources_later_fkey FOREIGN KEY (later_item_id) REFERENCES public.later_items (id) ON DELETE SET NULL,
  CONSTRAINT card_sources_kind_check CHECK (kind IN ('book', 'later', 'manual', 'quote')),
  CONSTRAINT card_sources_text_check CHECK (
    char_length(coalesce(title, '')) <= 500
    AND char_length(coalesce(author, '')) <= 500
    AND char_length(coalesce(cfi, '')) <= 2000
    AND char_length(coalesce(url, '')) <= 2000
  )
);

CREATE INDEX IF NOT EXISTS idx_card_sources_card ON public.card_sources (card_id);

-- One row per answer, for statistics later.
CREATE TABLE IF NOT EXISTS public.card_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL,
  user_id uuid NOT NULL,
  rating smallint NOT NULL,
  state smallint NOT NULL,
  reviewed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT card_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT card_reviews_card_fkey FOREIGN KEY (card_id) REFERENCES public.cards (id) ON DELETE CASCADE,
  CONSTRAINT card_reviews_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT card_reviews_rating_check CHECK (rating BETWEEN 1 AND 4)
);

CREATE INDEX IF NOT EXISTS idx_card_reviews_user_time ON public.card_reviews (user_id, reviewed_at DESC);

ALTER TABLE public.card_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY card_groups_own ON public.card_groups
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- A card may only point at the user's own quote.
CREATE POLICY cards_own ON public.cards
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (quote_id IS NULL OR EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.user_id = (SELECT auth.uid())))
  );

-- Card and group must both be the user's own.
CREATE POLICY card_group_members_own ON public.card_group_members
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.cards c WHERE c.id = card_id AND c.user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.card_groups g WHERE g.id = group_id AND g.user_id = (SELECT auth.uid()))
  );

CREATE POLICY card_sources_own ON public.card_sources
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.cards c WHERE c.id = card_id AND c.user_id = (SELECT auth.uid()))
  );

CREATE POLICY card_reviews_own ON public.card_reviews
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.cards c WHERE c.id = card_id AND c.user_id = (SELECT auth.uid()))
  );

REVOKE ALL ON public.card_groups FROM anon;
REVOKE ALL ON public.cards FROM anon;
REVOKE ALL ON public.card_group_members FROM anon;
REVOKE ALL ON public.card_sources FROM anon;
REVOKE ALL ON public.card_reviews FROM anon;

-- The caller's card with the same question (after normalisation), if any.
CREATE OR REPLACE FUNCTION public.find_card_by_front(p_front text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = public
  AS $$
    SELECT c.id FROM public.cards c
    WHERE c.user_id = (SELECT auth.uid()) AND c.front_norm = public.quote_norm(p_front)
    LIMIT 1
  $$;

REVOKE ALL ON FUNCTION public.find_card_by_front(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_card_by_front(text) TO authenticated;
