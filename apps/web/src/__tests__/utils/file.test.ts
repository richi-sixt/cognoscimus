import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteFile } from '@/utils/file';

// cognoscimus#5918: a cached chunk covers [chunkStart, chunkStart + byteLength - 1].
// The cache-hit test used to accept an inclusive `end` one byte past that, and
// `ArrayBuffer.slice` clamps instead of throwing — so the caller got a buffer
// one byte short with no error. A short PalmDOC record read corrupts every
// byte offset after it in a MOBI/AZW3 book.
describe('RemoteFile chunk cache', () => {
  const TOTAL = 1024 * 1024;
  let data: Uint8Array;

  beforeEach(() => {
    data = new Uint8Array(TOTAL);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const range = headers['Range'];
      if (!range) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': String(TOTAL) }),
          arrayBuffer: async () => data.buffer.slice(0),
        } as unknown as Response;
      }
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const body = data.slice(Number(s), Math.min(Number(e) + 1, TOTAL));
      return {
        ok: true,
        status: 206,
        headers: new Headers({ 'content-range': `bytes ${s}-${e}/${TOTAL}` }),
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never serves fewer bytes than requested from a cached chunk', async () => {
    const f = new RemoteFile('http://example.test/book.azw3', 'book.azw3');
    Object.defineProperty(f, 'size', { value: TOTAL, configurable: true });

    // Seed a chunk: a small read caches [start - 1024, start - 1024 + 131071].
    const seedStart = 200_000;
    await f.slice(seedStart, seedStart + 4096).arrayBuffer();
    const chunkStart = seedStart - 1024;
    const bufferSize = 1024 * 128;

    // Request a window whose last byte sits exactly one past the cached chunk.
    const start = chunkStart + 127_000;
    const endExclusive = chunkStart + bufferSize + 1;
    const got = new Uint8Array(await f.slice(start, endExclusive).arrayBuffer());

    expect(got.length).toBe(endExclusive - start);
    expect(Array.from(got)).toEqual(Array.from(data.subarray(start, endExclusive)));
  });
});

describe('RemoteFile fetcher injection', () => {
  const url = 'http://abs.local/api/items/i1/ebook?token=t1';

  const makeFetcher = () => {
    const calls: Array<{ self: unknown; input: unknown; init?: RequestInit }> = [];
    // A plain function (not vi.fn) so the `this` it observes is exactly what
    // RemoteFile invoked it with.
    const fetcher = async function (this: unknown, input: unknown, init?: RequestInit) {
      calls.push({ self: this, input, init });
      const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
      const body = new Uint8Array(range ? 4 : 0);
      return {
        ok: true,
        status: range ? 206 : 200,
        headers: new Headers({
          'Content-Length': '4096',
          'Content-Range': range ? 'bytes 0-3/4096' : '',
          'Content-Type': 'application/epub+zip',
        }),
        arrayBuffer: async () => body.buffer,
      } as unknown as Response;
    } as unknown as typeof fetch;
    return { fetcher, calls };
  };

  it('opens and reads ranges through the injected fetcher', async () => {
    const { fetcher, calls } = makeFetcher();
    const file = new RemoteFile(url, 'book.epub', '', 0, fetcher);
    await file.open();
    expect(file.size).toBe(4096);
    await file.fetchRangePart(0, 3);
    expect(calls.map((c) => c.input)).toEqual([url, url]);
    expect(calls[0]!.init).toEqual({ method: 'HEAD' });
    expect(calls[1]!.init?.headers).toEqual({ Range: 'bytes=0-3' });
  });

  it('calls the fetcher unbound so a native window.fetch default is not an illegal invocation', async () => {
    const { fetcher, calls } = makeFetcher();
    const file = new RemoteFile(url, 'book.epub', '', 0, fetcher);
    await file.open();
    await file.fetchRangePart(0, 3);
    // Chromium/WebKit throw "Illegal invocation" when window.fetch runs with a
    // non-Window `this`, which is exactly what `this.#fetch(...)` passes.
    expect(calls.map((c) => c.self)).toEqual([undefined, undefined]);
  });
});

describe('RemoteFile multi-chunk fetchRange', () => {
  it('keeps chunk order and caps in-flight requests when responses resolve out of order', async () => {
    const SIZE = 10 * 1024 * 1000;
    let inFlight = 0;
    let maxInFlight = 0;
    const fetcher = (async (_input: unknown, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
      if (!range) {
        return { ok: true, headers: new Headers({ 'Content-Length': String(SIZE) }) } as Response;
      }
      const [start, end] = range.replace('bytes=', '').split('-').map(Number) as [number, number];
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Later chunks resolve first.
      await new Promise((r) => setTimeout(r, (SIZE - start) / 1024 / 1000));
      inFlight--;
      const body = new Uint8Array(end - start + 1);
      for (let i = 0; i < body.length; i++) body[i] = (start + i) & 0xff;
      return { ok: true, arrayBuffer: async () => body.buffer } as unknown as Response;
    }) as unknown as typeof fetch;

    const file = await new RemoteFile(
      'http://example.test/book.epub',
      'book.epub',
      '',
      0,
      fetcher,
    ).open();
    const start = 100;
    const end = SIZE - 100;
    const bytes = new Uint8Array(await file.fetchRange(start, end));

    expect(bytes.length).toBe(end - start + 1);
    expect(bytes.every((b, i) => b === ((start + i) & 0xff))).toBe(true);
    expect(maxInFlight).toBe(RemoteFile.MAX_PARALLEL_RANGE_FETCHES);
  });
});
