-- Read-later: tell articles apart from plain bookmarks. Run once, after 0013.
--
-- A saved link is an 'article' (text worth reading, kept in full), or a
-- bookmark without text: 'link' (shops, repositories, tools), 'video' or
-- 'document' (PDF and similar). The server decides when it fetches the page;
-- the client cannot change it, so the UPDATE grant stays as it is.

ALTER TABLE public.later_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'article';

ALTER TABLE public.later_items
  DROP CONSTRAINT IF EXISTS later_items_kind_check;
ALTER TABLE public.later_items
  ADD CONSTRAINT later_items_kind_check CHECK (kind IN ('article', 'link', 'video', 'document'));

CREATE INDEX IF NOT EXISTS idx_later_items_kind
  ON public.later_items (user_id, kind) WHERE deleted_at IS NULL;
