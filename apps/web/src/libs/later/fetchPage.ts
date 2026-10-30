import { assertPublicHttpUrl, FetchBlockedError } from './ssrf';

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class FetchPageError extends Error {
  constructor(
    public readonly code: 'fetch_failed' | 'not_html' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'FetchPageError';
  }
}

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_eid$|mc_cid$|igshid$)/i;

/** Normalises a user-supplied link: http(s) only, no fragment, no tracking params. */
export const normalizeUrl = (input: string): URL => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new FetchBlockedError('This is not a valid link');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchBlockedError('Only http and https links can be saved');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return url;
};

const readLimited = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > FETCH_MAX_BYTES) {
      await reader.cancel();
      throw new FetchPageError('too_large', 'This page is too large to save');
    }
    chunks.push(value);
  }
  const charset = /charset=([^;]+)/i.exec(response.headers.get('content-type') ?? '')?.[1]?.trim();
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(Buffer.concat(chunks));
};

/**
 * Downloads an HTML page. Redirects are followed by hand so every hop passes the
 * public-address check; size and time are capped.
 */
export const fetchPage = async (start: URL): Promise<{ html: string; finalUrl: URL }> => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(url);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CognoscimusLater/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch {
      throw new FetchPageError('fetch_failed', 'The page could not be loaded');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new FetchPageError('fetch_failed', 'The page could not be loaded');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      throw new FetchPageError('fetch_failed', `The page answered with status ${response.status}`);
    }
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new FetchPageError('not_html', 'This link is not a web page');
    }
    return { html: await readLimited(response), finalUrl: url };
  }
  throw new FetchPageError('fetch_failed', 'Too many redirects');
};
