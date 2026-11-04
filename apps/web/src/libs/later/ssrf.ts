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

/** The eight 16-bit groups of an IPv6 address, or null when it does not parse. */
const ipv6Groups = (ip: string): number[] | null => {
  let text = ip.toLowerCase().split('%')[0]!;
  // A dotted IPv4 tail ("::ffff:1.2.3.4") is the last two groups.
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = ipv4Parts(tail[1]!);
    text = `${text.slice(0, -tail[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...rest,
  ].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
};

const isPrivateIPv6 = (ip: string): boolean => {
  const g = ipv6Groups(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) =>
    isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8) || (zeros(7) && g[7] === 1)) return true; // :: and ::1
  if (zeros(5) && g[5] === 0xffff) return v4(g[6]!, g[7]!); // IPv4-mapped, either spelling
  if (zeros(6)) return v4(g[6]!, g[7]!); // IPv4-compatible
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address that decides
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return v4(g[6]!, g[7]!);
  }
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!);
  const first = g[0]!;
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // site-local fec0::/10
    (first & 0xff00) === 0xff00 // multicast
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
 * This check alone leaves a gap: DNS is resolved here and again when the request
 * connects, and a host can flip its answer between the two. `safeFetch` closes it
 * by checking the address the connection really uses; this call stays for the
 * early, readable error and for hosts given as an IP address.
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
