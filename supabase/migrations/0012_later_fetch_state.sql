-- Imported links are stored first and their article text is fetched afterwards.
-- `fetch_state` tells which ones still wait for it. Run once, after 0011.

ALTER TABLE public.later_items
  ADD COLUMN IF NOT EXISTS fetch_state text NOT NULL DEFAULT 'ready';

ALTER TABLE public.later_items
  ADD CONSTRAINT later_items_fetch_state_check CHECK (fetch_state IN ('ready', 'pending', 'failed'));

CREATE INDEX IF NOT EXISTS idx_later_items_unfetched ON public.later_items (user_id)
  WHERE fetch_state <> 'ready';

-- Folder paths imported as labels ("Coding/Python/Scanning") need more room.
ALTER TABLE public.later_labels DROP CONSTRAINT IF EXISTS later_labels_name_check;
ALTER TABLE public.later_labels
  ADD CONSTRAINT later_labels_name_check CHECK (char_length(name) BETWEEN 1 AND 80);
