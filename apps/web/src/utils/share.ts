import { writeTextToClipboard } from '@/utils/clipboard';

/**
 * Whether the selected text can be shared by the Web Share API. Used to gate
 * the Share tool's visibility in the selection toolbar and its customizer. Kept
 * next to `shareSelectedText` so the two stay in sync.
 */
export const canShareText = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * Open the browser share sheet for `text`, with a clipboard fallback.
 *
 * `navigator.share`: a rejection means the user dismissed the sheet — respect
 * it, don't silently copy. Clipboard, as a last resort when no share method
 * exists.
 */
export const shareSelectedText = async (text: string): Promise<void> => {
  if (!text) return;

  if (canShareText()) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      // Only respect a user cancel (AbortError). Other failures — e.g.
      // NotAllowedError when a quick action fires without a user gesture —
      // fall through to the clipboard so the user still gets the text.
      if (err instanceof Error && err.name === 'AbortError') return;
    }
  }

  await writeTextToClipboard(text);
};
