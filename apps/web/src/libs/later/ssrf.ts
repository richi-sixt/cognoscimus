import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBlockedError';
  }
}

const ipv4Parts = (ip: string) => ip.split('.').map(Number) as [number, number, number, number];

const isPrivateIPv4 = (ip: string): boolean => {
  const [a, b] = ipv4Parts(ip);
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
};

const isPrivateIPv6 = (ip: string): boolean => {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') || // unique local
    lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) || // link-local
    lower.startsWith('ff') // multicast
  );
};

export const isPrivateAddress = (ip: string): boolean => {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
};

/**
 * Throws unless the URL is plain http(s) and its host resolves only to public
 * addresses. Called for every hop of a redirect chain.
 *
 * DNS is resolved here and again by fetch, so a host that flips its answer
 * between the two lookups could still slip through. The save route only returns
 * sanitised article text, never the raw response, which keeps that gap narrow.
 */
export const assertPublicHttpUrl = async (url: URL): Promise<void> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchBlockedError('Only http and https links can be saved');
  }
  if (url.username || url.password) {
    throw new FetchBlockedError('Links with credentials cannot be saved');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new FetchBlockedError('This address cannot be saved');
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchBlockedError('This address cannot be saved');
  }
};
