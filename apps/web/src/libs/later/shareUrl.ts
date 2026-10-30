const URL_RE = /https?:\/\/[^\s<>"']+/i;

/**
 * The link a share sheet or bookmarklet handed over. Android puts it in `text`
 * ("Title https://…") rather than `url`, so `url` wins and `text` is searched.
 */
export const pickSharedUrl = (params: {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}): string | null => {
  for (const candidate of [params.url, params.text, params.title]) {
    const match = candidate?.match(URL_RE)?.[0];
    if (match) return match.replace(/[.,;:!?)\]]+$/, '');
  }
  return null;
};
