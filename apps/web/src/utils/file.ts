class DeferredBlob extends Blob {
  #dataPromise: Promise<ArrayBuffer>;
  #type: string;

  constructor(dataPromise: Promise<ArrayBuffer>, type: string) {
    super();
    this.#dataPromise = dataPromise;
    this.#type = type;
  }

  override async arrayBuffer() {
    const data = await this.#dataPromise;
    return data;
  }

  override async text() {
    const data = await this.#dataPromise;
    return new TextDecoder().decode(data);
  }

  override stream() {
    return new ReadableStream({
      start: async (controller) => {
        const data = await this.#dataPromise;
        const reader = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(data));
            controller.close();
          },
        }).getReader();
        const pump = () =>
          reader.read().then(({ done, value }): Promise<void> => {
            if (done) {
              controller.close();
              return Promise.resolve();
            }
            controller.enqueue(value);
            return pump();
          });
        return pump();
      },
    });
  }

  override get type() {
    return this.#type;
  }
}

export interface ClosableFile extends File {
  open(): Promise<this>;
  close(): Promise<void>;
}

export class RemoteFile extends File implements ClosableFile {
  url: string;
  #fetch: typeof fetch;
  #name: string;
  #lastModified: number;
  #size: number = -1;
  #type: string = '';
  #order: number[] = [];
  #cache: Map<number, ArrayBuffer> = new Map(); // LRU cache
  #pendingFetches: Map<string, Promise<ArrayBuffer>> = new Map();

  static MAX_CACHE_CHUNK_SIZE = 1024 * 128;
  static MAX_CACHE_ITEMS_SIZE: number = 128;
  // Bounded concurrency for multi-chunk fetchRange() reads (see fetchRange).
  static MAX_PARALLEL_RANGE_FETCHES = 4;

  constructor(url: string, name?: string, type = '', lastModified = Date.now(), fetcher = fetch) {
    const basename = url.split('/').pop() || 'remote-file';
    super([], name || basename, { type, lastModified });
    this.url = url;
    this.#fetch = fetcher;
    this.#name = name || basename;
    this.#type = type;
    this.#lastModified = lastModified;
  }

  /**
   * Invoke the fetcher unbound. `this.#fetch(...)` would run the default
   * `window.fetch` with this File as `this`, which Chromium and WebKit reject
   * with "Illegal invocation" — the web build and the desktop fast path both
   * rely on that default.
   */
  #call(input: string, init?: RequestInit): Promise<Response> {
    const fetcher = this.#fetch;
    return fetcher(input, init);
  }

  override get name() {
    return this.#name;
  }

  override get type() {
    return this.#type;
  }

  override get size() {
    return this.#size;
  }

  override get lastModified() {
    return this.#lastModified;
  }

  async open() {
    const response = await this.#call(this.url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Failed to fetch file size: ${response.status}`);
    }
    this.#size = Number(response.headers.get('content-length'));
    this.#type = response.headers.get('content-type') || '';
    return this;
  }

  async close(): Promise<void> {
    this.#cache.clear();
    this.#order = [];
  }

  async fetchRangePart(start: number, end: number) {
    start = Math.max(0, start);
    end = Math.min(this.size - 1, end);
    // console.log(`Fetching range: ${start}-${end}, size: ${end - start + 1}`);
    const response = await this.#call(this.url, { headers: { Range: `bytes=${start}-${end}` } });
    if (!response.ok) {
      throw new Error(`Failed to fetch range: ${response.status}`);
    }
    return response.arrayBuffer();
  }

  // inclusive reading of the end: [start, end]
  async fetchRange(start: number, end: number): Promise<ArrayBuffer> {
    const rangeSize = end - start + 1;
    const MAX_RANGE_LEN = 1024 * 1000;

    if (rangeSize > MAX_RANGE_LEN) {
      // The chunks are independent range requests; issue them with bounded
      // concurrency instead of one-by-one. On Android every chunk is a
      // scheme round trip through the WebView network stack, so a multi-MB
      // read (e.g. a large EPUB's central directory) used to serialize N
      // fetches behind each other. Each result is written into its
      // preallocated slot so chunk order is preserved.
      const starts: number[] = [];
      for (let currentStart = start; currentStart <= end; currentStart += MAX_RANGE_LEN) {
        starts.push(currentStart);
      }
      const buffers: ArrayBuffer[] = new Array(starts.length);
      let next = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(RemoteFile.MAX_PARALLEL_RANGE_FETCHES, starts.length) },
          async () => {
            while (next < starts.length) {
              const index = next++;
              const currentStart = starts[index]!;
              const currentEnd = Math.min(currentStart + MAX_RANGE_LEN - 1, end);
              buffers[index] = await this.fetchRangePart(currentStart, currentEnd);
            }
          },
        ),
      );
      const totalSize = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
      const combinedBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const buffer of buffers) {
        combinedBuffer.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
      }
      return combinedBuffer.buffer;
    } else if (rangeSize > RemoteFile.MAX_CACHE_CHUNK_SIZE) {
      return this.fetchRangePart(start, end);
    } else {
      const cachedChunkStart = Array.from(this.#cache.keys()).find((chunkStart) => {
        const buffer = this.#cache.get(chunkStart)!;
        const bufferSize = buffer.byteLength;
        // `end` is inclusive, so the cached chunk's last byte is at
        // `chunkStart + bufferSize - 1`. Accepting `end === chunkStart +
        // bufferSize` here would take the cache branch for a range whose last
        // byte the chunk doesn't hold, and `buffer.slice` clamps rather than
        // throws — the caller silently gets one byte less than it asked for.
        return start >= chunkStart && end < chunkStart + bufferSize;
      });
      if (cachedChunkStart !== undefined) {
        this.#updateAccessOrder(cachedChunkStart);
        const buffer = this.#cache.get(cachedChunkStart)!;
        const offset = start - cachedChunkStart;
        return buffer.slice(offset, offset + rangeSize);
      }

      const fetchKey = `${start}-${end}`;
      const pendingFetch = this.#pendingFetches.get(fetchKey);

      if (pendingFetch) {
        return pendingFetch;
      }

      const fetchPromise = this.#fetchAndCacheChunkSafe(start, end, rangeSize);
      this.#pendingFetches.set(fetchKey, fetchPromise);
      try {
        return await fetchPromise;
      } finally {
        this.#pendingFetches.delete(fetchKey);
      }
    }
  }

  async #fetchAndCacheChunkSafe(
    start: number,
    end: number,
    rangeSize: number,
  ): Promise<ArrayBuffer> {
    const chunkStart = Math.max(0, start - 1024);
    const chunkEnd = Math.max(end, start + RemoteFile.MAX_CACHE_CHUNK_SIZE - 1024 - 1);
    const buffer = await this.fetchRangePart(chunkStart, chunkEnd);

    // Only one thread reaches here per unique range
    this.#cache.set(chunkStart, buffer);
    this.#updateAccessOrder(chunkStart);
    this.#ensureCacheSize();

    const offset = start - chunkStart;
    return buffer.slice(offset, offset + rangeSize);
  }

  #updateAccessOrder(chunkStart: number) {
    const index = this.#order.indexOf(chunkStart);
    if (index > -1) {
      this.#order.splice(index, 1);
    }
    this.#order.unshift(chunkStart);
  }

  #ensureCacheSize() {
    while (this.#cache.size > RemoteFile.MAX_CACHE_ITEMS_SIZE) {
      const oldestKey = this.#order.pop();
      if (oldestKey !== undefined) {
        this.#cache.delete(oldestKey);
      }
    }
  }

  override slice(start = 0, end = this.size, contentType = this.type): Blob {
    // console.log(`Slicing: ${start}-${end}, size: ${end - start}`);
    const dataPromise = this.fetchRange(start, end - 1);

    return new DeferredBlob(dataPromise, contentType);
  }

  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const CHUNK_SIZE = 1024 * 1024;
    let offset = 0;

    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull: async (controller) => {
        if (offset >= this.size) {
          controller.close();
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, this.size);
        const buffer = await this.fetchRange(offset, end - 1);

        controller.enqueue(new Uint8Array(buffer));
        offset = end;
      },
    });
  }

  override async text() {
    const blob = this.slice(0, this.size);
    return blob.text();
  }

  override async arrayBuffer() {
    const blob = this.slice(0, this.size);
    return blob.arrayBuffer();
  }
}
