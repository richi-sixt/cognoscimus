import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  buildAnchor,
  clearMarks,
  findAnchor,
  rangeOffsets,
  wrapOffsets,
} from '@/libs/later/anchor';
import {
  createHighlight,
  deleteHighlight,
  HIGHLIGHT_MARK_CLASS,
  HIGHLIGHT_QUOTE_MAX,
  type Highlight,
  type HighlightColor,
  listHighlights,
  restoreHighlight,
  updateHighlight,
} from '@/libs/later/highlights';

const UNDO_MS = 6000;
const SELECTION_DEBOUNCE_MS = 150;

interface Options {
  rootRef: RefObject<HTMLElement | null>;
  itemId: string | null;
  userId: string | undefined;
  /** The article HTML; marks are laid over it again whenever it changes. */
  html: string;
  onError: (message: string) => void;
}

// Highlights of one article: loads them, lays <mark>s over the rendered text,
// follows the text selection, and edits, deletes (with undo) and restores.
export const useHighlights = ({ rootRef, itemId, userId, html, onError }: Options) => {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [lost, setLost] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Highlight | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fail = useCallback(
    (err: unknown) => onError(err instanceof Error ? err.message : 'Something went wrong'),
    [onError],
  );

  useEffect(() => {
    if (!itemId) return;
    listHighlights(itemId).then(setHighlights, fail);
  }, [itemId, fail]);

  // Lay the marks over the text. They are rebuilt from scratch each time, which
  // is cheap and keeps the DOM free of stale marks.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    clearMarks(root);
    const text = root.textContent ?? '';
    const notFound = new Set<string>();
    for (const h of highlights) {
      const at = findAnchor(text, h);
      if (at) {
        wrapOffsets(root, at[0], at[1], { id: h.id, className: HIGHLIGHT_MARK_CLASS[h.color] });
      } else {
        notFound.add(h.id);
      }
    }
    setLost(notFound);
    // `html` is a dependency because a new article body replaces the DOM.
  }, [highlights, html, rootRef]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const root = rootRef.current;
        const sel = document.getSelection();
        if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null);
        setSelection(rangeOffsets(root, sel.getRangeAt(0)));
      }, SELECTION_DEBOUNCE_MS);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onChange);
    };
  }, [rootRef]);

  // Tapping a highlight opens it for editing (unless the tap ended a selection).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      if (!document.getSelection()?.isCollapsed) return;
      const mark = (event.target as Element).closest?.('mark[data-highlight-id]');
      const id = mark?.getAttribute('data-highlight-id');
      if (id) setActiveId(id);
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [rootRef, html]);

  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const create = useCallback(
    async (color: HighlightColor): Promise<string | null> => {
      const root = rootRef.current;
      if (!root || !itemId || !userId || !selection) return null;
      const anchor = buildAnchor(root.textContent ?? '', selection[0], selection[1]);
      if (anchor.quote.length > HIGHLIGHT_QUOTE_MAX) {
        onError(`A highlight can hold up to ${HIGHLIGHT_QUOTE_MAX} characters.`);
        return null;
      }
      try {
        const created = await createHighlight(userId, itemId, anchor, color);
        setHighlights((all) => [...all, created]);
        document.getSelection()?.removeAllRanges();
        setSelection(null);
        return created.id;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [rootRef, itemId, userId, selection, onError, fail],
  );

  const update = useCallback(
    async (id: string, patch: { annotation?: string | null; color?: HighlightColor }) => {
      const before = highlights;
      setHighlights((all) => all.map((h) => (h.id === id ? { ...h, ...patch } : h)));
      try {
        await updateHighlight(id, patch);
      } catch (err) {
        setHighlights(before);
        fail(err);
      }
    },
    [highlights, fail],
  );

  const remove = useCallback(
    async (id: string) => {
      const target = highlights.find((h) => h.id === id);
      if (!target) return;
      try {
        await deleteHighlight(id);
      } catch (err) {
        return fail(err);
      }
      setHighlights((all) => all.filter((h) => h.id !== id));
      setActiveId(null);
      setUndoable(target);
      clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoable(null), UNDO_MS);
    },
    [highlights, fail],
  );

  const undo = useCallback(async () => {
    if (!undoable || !userId) return;
    clearTimeout(undoTimer.current);
    try {
      await restoreHighlight(userId, undoable);
      setHighlights((all) =>
        [...all, undoable].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      );
    } catch (err) {
      fail(err);
    }
    setUndoable(null);
  }, [undoable, userId, fail]);

  const jumpTo = useCallback(
    (id: string) => {
      rootRef.current
        ?.querySelector(`mark[data-highlight-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [rootRef],
  );

  return {
    highlights,
    lost,
    hasSelection: selection !== null,
    activeId,
    setActiveId,
    undoable,
    create,
    update,
    remove,
    undo,
    jumpTo,
  };
};

export type HighlightsApi = ReturnType<typeof useHighlights>;
