// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '@/libs/later/safeFetch';
import { FetchBlockedError } from '@/libs/later/ssrf';

// The connection itself refuses a private address, whatever the host name says at
// the time it is checked. A host given as an IP address skips the lookup, which is
// what lets these tests reach a server on this machine. The check of the URL that
// safeFetch runs first is switched off here; ssrf.test.ts covers it.
vi.mock('@/libs/later/ssrf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/libs/later/ssrf')>()),
  assertPublicHttpUrl: vi.fn(async () => undefined),
}));

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/gzip') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync('<p>hello</p>'));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/gzip' });
      res.end('moved');
    } else if (req.url === '/same') {
      res.writeHead(304, { etag: '"x"' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['a=1', 'b=2'] });
      res.end('plain');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('safeFetch', () => {
  it('reads a plain answer with its headers', async () => {
    const response = await safeFetch(new URL(`${base}/`));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('plain');
    expect(response.headers.get('content-type')).toBe('text/plain');
  });

  it('unpacks a compressed answer like fetch does', async () => {
    const response = await safeFetch(new URL(`${base}/gzip`));

    expect(await response.text()).toBe('<p>hello</p>');
    expect(response.headers.get('content-encoding')).toBeNull();
  });

  it('hands a redirect back instead of following it', async () => {
    const response = await safeFetch(new URL(`${base}/redirect`));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/gzip');
  });

  it('returns 304 without a body', async () => {
    const response = await safeFetch(new URL(`${base}/same`), {
      headers: { 'If-None-Match': '"x"' },
    });

    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it('refuses a name that resolves to a private address when it connects', async () => {
    const port = new URL(base).port;

    await expect(safeFetch(new URL(`http://localhost:${port}/`))).rejects.toBeInstanceOf(
      FetchBlockedError,
    );
  });

  it('stops when cancelled', async () => {
    await expect(
      safeFetch(new URL(`${base}/`), { signal: AbortSignal.abort() }),
    ).rejects.toBeTruthy();
  });
});
