import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { assertPublicHttpUrl, FetchBlockedError, isPrivateAddress } from './ssrf';

// A fetch that cannot be sent to a private address by DNS tricks. The check and
// the connection share one lookup, so a host that answers with a public address
// first and a private one second never gets through (DNS rebinding). Node skips
// the lookup for a host given as an IP address, so `assertPublicHttpUrl` runs
// here as well. Redirects are not followed: the caller decides, and checks every hop.

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new FetchBlockedError('This address cannot be saved'), '', 0);
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

const decoderFor = (encoding: string | undefined) => {
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
  if (encoding === 'deflate') return createInflate();
  if (encoding === 'br') return createBrotliDecompress();
  return null;
};

export const safeFetch = async (
  url: URL,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> => {
  await assertPublicHttpUrl(url);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: { 'Accept-Encoding': 'gzip, deflate, br', ...init.headers },
        lookup: guardedLookup,
        signal: init.signal,
      },
      (res) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(name, v);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = res.statusCode ?? 0;
        // These answers carry no body (a redirect's is not needed).
        if (status === 204 || status === 205 || (status >= 300 && status < 400)) {
          res.resume();
          return resolve(new Response(null, { status, headers }));
        }
        const decoder = decoderFor(headers.get('content-encoding')?.trim().toLowerCase());
        if (decoder) {
          headers.delete('content-encoding');
          headers.delete('content-length');
          res.on('error', (error) => decoder.destroy(error));
        }
        const source = decoder ? res.pipe(decoder) : res;
        resolve(new Response(Readable.toWeb(source) as ReadableStream, { status, headers }));
      },
    );
    request.on('error', reject);
    request.end();
  });
};
