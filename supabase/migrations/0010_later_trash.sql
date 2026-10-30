-- Trash for read-later: deleting an article moves it here first. `deleted_at`
-- is set while it sits in the trash; it can be restored or deleted for good.
-- Run once, after 0009.

ALTER TABLE public.later_items ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone NULL;

CREATE INDEX IF NOT EXISTS idx_later_items_trash ON public.later_items (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- The reading-state grant of 0008 grows by this one column.
GRANT UPDATE (state, progress, archived_at, deleted_at) ON public.later_items TO authenticated;
