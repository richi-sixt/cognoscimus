// Checks for what the browser extension sends about a saved item. The limits
// mirror the database constraints, so a bad value is refused before it gets there.

export const NOTE_MAX = 2000;
export const LABEL_NAME_MAX = 40;
export const LABELS_PER_ITEM_MAX = 20;
export const TOKEN_NAME_MAX = 80;

/** A trimmed note, null for an empty one, undefined when the value is unusable. */
export const readNote = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > NOTE_MAX) return undefined;
  return value.trim() || null;
};

/** Label names, trimmed and without repeats (ignoring case); null when unusable. */
export const readLabelNames = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > LABELS_PER_ITEM_MAX) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const name = entry.trim();
    if (!name || name.length > LABEL_NAME_MAX) return null;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
};

/** A display name for a connected browser. */
export const readTokenName = (value: unknown): string => {
  const name = typeof value === 'string' ? value.trim().slice(0, TOKEN_NAME_MAX) : '';
  return name || 'Browser';
};
