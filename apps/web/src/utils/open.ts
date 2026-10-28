/** Open an external URL in a new browser tab. */
export const openExternalUrl = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};
