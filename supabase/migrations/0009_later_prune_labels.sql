-- A label that no article carries any more is removed automatically: when the
-- last article leaves it (the article is deleted or the label is taken off).
-- Run once, after 0008.

CREATE OR REPLACE FUNCTION public.later_prune_orphan_label()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.later_labels l
  WHERE l.id = OLD.label_id
    AND NOT EXISTS (SELECT 1 FROM public.later_item_labels il WHERE il.label_id = l.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS later_item_labels_prune ON public.later_item_labels;
CREATE TRIGGER later_item_labels_prune
  AFTER DELETE ON public.later_item_labels
  FOR EACH ROW EXECUTE FUNCTION public.later_prune_orphan_label();

-- Labels left behind before this trigger existed.
DELETE FROM public.later_labels l
WHERE NOT EXISTS (SELECT 1 FROM public.later_item_labels il WHERE il.label_id = l.id);
