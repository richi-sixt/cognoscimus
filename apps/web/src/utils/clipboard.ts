/**
 * Write `text` to the system clipboard: `navigator.clipboard` with an
 * `execCommand('copy')` fallback for older browsers / non-secure contexts.
 *
 * Resolves to `true` when the write succeeded, `false` otherwise.
 */
export const writeTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof text !== 'string') return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('[clipboard] navigator.clipboard.writeText failed, falling back', err);
    }
  }

  // Last-resort fallback for non-secure contexts / older browsers.
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      console.warn('[clipboard] execCommand fallback failed', err);
    }
  }

  return false;
};

/** Read on a user gesture; return null when the platform denies clipboard access. */
export const readTextFromClipboard = async (): Promise<string | null> => {
  try {
    return (await navigator.clipboard?.readText()) ?? null;
  } catch (err) {
    console.warn('[clipboard] navigator.clipboard.readText failed', err);
    return null;
  }
};
