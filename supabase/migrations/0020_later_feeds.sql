-- RSS/Atom feeds for the read-later reader. Run once, after 0019.
--
-- A feed belongs to one person. A scheduled job (see /api/later/feeds/poll)
-- fetches the due feeds and files new entries as "new". The entries are only a
-- title, link and excerpt; saving one turns it into a normal article. Rows are
-- written by the server only (feeds are added through the API, which checks the
-- address); the owner can pause or delete a feed and answer its entries.

CREATE TABLE IF NOT EXISTS public.later_feeds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  site_url text NULL,
  etag text NULL,
  last_modified text NULL,
  check_every_minutes integer NOT NULL DEFAULT 60,
  next_check_at timestamp with time zone NOT NULL DEFAULT now(),
  last_checked_at timestamp with time zone NULL,
  error_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_feeds_pkey PRIMARY KEY (id),
  CONSTRAINT later_feeds_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_feeds_user_url_unique UNIQUE (user_id, url),
  CONSTRAINT later_feeds_every_check CHECK (check_every_minutes BETWEEN 15 AND 1440)
);

CREATE INDEX IF NOT EXISTS idx_later_feeds_due ON public.later_feeds (next_check_at) WHERE active;

CREATE TABLE IF NOT EXISTS public.later_feed_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  feed_id uuid NOT NULL,
  user_id uuid NOT NULL,
  guid text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  excerpt text NULL,
  published_at timestamp with time zone NULL,
  state text NOT NULL DEFAULT 'new',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT later_feed_entries_pkey PRIMARY KEY (id),
  CONSTRAINT later_feed_entries_feed_fkey FOREIGN KEY (feed_id) REFERENCES public.later_feeds (id) ON DELETE CASCADE,
  CONSTRAINT later_feed_entries_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT later_feed_entries_once UNIQUE (feed_id, guid),
  CONSTRAINT later_feed_entries_state_check CHECK (state IN ('new', 'saved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_later_feed_entries_user ON public.later_feed_entries
  (user_id, state, published_at DESC NULLS LAST);

ALTER TABLE public.later_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.later_feed_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY later_feeds_own ON public.later_feeds
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY later_feed_entries_own ON public.later_feed_entries
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.later_feeds FROM anon;
REVOKE ALL ON public.later_feed_entries FROM anon;
REVOKE INSERT, UPDATE ON public.later_feeds FROM authenticated;
REVOKE INSERT, UPDATE ON public.later_feed_entries FROM authenticated;
GRANT UPDATE (active, title) ON public.later_feeds TO authenticated;
GRANT UPDATE (state) ON public.later_feed_entries TO authenticated;
