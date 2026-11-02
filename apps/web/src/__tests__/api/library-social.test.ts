import { beforeEach, describe, expect, it, vi } from 'vitest';

// Browsing a followed person's library and asking to borrow a book are decided on
// the server: only an accepted follower of an owner who shares the library, never
// hidden books, and only the owner answers. The tests drive the routes against a
// small in-memory stand-in for the database.

const validateUserAndTokenMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));
vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: (...a: unknown[]) => getDownloadSignedUrlMock(...a),
}));

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

const table = (name: string) => {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'upsert' | 'update' = 'select';
  let payload: Row = {};
  let conflict: string[] = [];
  let head = false;
  const rows = () => (db[name] ??= []);
  const matched = () => rows().filter((r) => filters.every((f) => f(r)));
  const exec = (single: boolean) => {
    if (op === 'upsert') {
      const key = (r: Row) => conflict.map((c) => r[c]).join('|');
      const existing = rows().find((r) => key(r) === key(payload));
      const row = existing
        ? Object.assign(existing, payload)
        : {
            id: `00000000-0000-4000-8000-${String(rows().length + 1).padStart(12, '0')}`,
            ...payload,
          };
      if (!existing) rows().push(row);
      return { data: row, error: null };
    }
    if (op === 'update') {
      matched().forEach((r) => Object.assign(r, payload));
      return { data: null, error: null };
    }
    const found = matched();
    if (head) return { count: found.length, data: null, error: null };
    return { data: single ? (found[0] ?? null) : found, error: null };
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, opts?: { head?: boolean }) => {
      head = !!opts?.head;
      return b;
    },
    upsert: (p: Row, opts?: { onConflict?: string }) => {
      op = 'upsert';
      payload = p;
      conflict = (opts?.onConflict ?? 'id').split(',');
      return b;
    },
    update: (p: Row) => {
      op = 'update';
      payload = p;
      return b;
    },
    eq: (c: string, v: unknown) => {
      filters.push((r) => r[c] === v);
      return b;
    },
    is: (c: string, v: unknown) => {
      filters.push((r) => (r[c] ?? null) === v);
      return b;
    },
    in: (c: string, values: unknown[]) => {
      filters.push((r) => values.includes(r[c]));
      return b;
    },
    gt: (c: string, v: string) => {
      filters.push((r) => String(r[c]) > v);
      return b;
    },
    like: (c: string, pattern: string) => {
      const suffix = pattern.replace(/^%/, '');
      filters.push((r) => String(r[c]).endsWith(suffix));
      return b;
    },
    order: () => b,
    limit: () => b,
    maybeSingle: async () => exec(true),
    single: async () => exec(true),
    // biome-ignore lint/suspicious/noThenProperty: the query builder is awaited like supabase-js's
    then: (resolve: (v: unknown) => unknown) => resolve(exec(false)),
  };
  return b;
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: (name: string) => table(name) }),
}));

const OWNER = '11111111-1111-4111-8111-111111111111';
const FOLLOWER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';

const asUser = (id: string) =>
  validateUserAndTokenMock.mockResolvedValue({ user: { id, email: 'x@example.com' }, token: 't' });

const req = (body?: unknown, url = 'http://localhost/api') =>
  new Request(url, {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  vi.clearAllMocks();
  getDownloadSignedUrlMock.mockResolvedValue('https://bucket.example/signed');
  db['profiles'] = [{ user_id: OWNER, library_shared: true }];
  db['follows'] = [{ follower_id: FOLLOWER, followee_id: OWNER, status: 'accepted' }];
  db['books'] = [
    {
      user_id: OWNER,
      book_hash: 'h1',
      title: 'Alpha',
      author: 'A',
      format: 'EPUB',
      deleted_at: null,
    },
    {
      user_id: OWNER,
      book_hash: 'h2',
      title: 'Beta',
      author: null,
      format: 'PDF',
      deleted_at: null,
    },
  ];
  db['library_hidden'] = [{ user_id: OWNER, book_hash: 'h2' }];
  db['files'] = [
    {
      user_id: OWNER,
      book_hash: 'h1',
      file_key: `${OWNER}/B/h1/cover.png`,
      file_size: 1,
      deleted_at: null,
    },
    {
      user_id: OWNER,
      book_hash: 'h1',
      file_key: `${OWNER}/B/h1/h1.epub`,
      file_size: 9,
      deleted_at: null,
    },
    {
      user_id: OWNER,
      book_hash: 'h2',
      file_key: `${OWNER}/B/h2/cover.png`,
      file_size: 1,
      deleted_at: null,
    },
    {
      user_id: OWNER,
      book_hash: 'h2',
      file_key: `${OWNER}/B/h2/h2.pdf`,
      file_size: 9,
      deleted_at: null,
    },
  ];
  db['book_requests'] = [];
  db['book_grants'] = [];
});

describe('POST /api/explore/covers', () => {
  const call = async (ownerId: string, hashes: string[]) => {
    const { POST } = await import('@/app/api/explore/covers/route');
    return POST(req({ ownerId, hashes }));
  };

  it('signs the covers of visible books for an accepted follower', async () => {
    asUser(FOLLOWER);
    const res = await call(OWNER, ['h1']);
    expect(res.status).toBe(200);
    expect((await res.json()).urls).toEqual({ h1: 'https://bucket.example/signed' });
    expect(getDownloadSignedUrlMock).toHaveBeenCalledWith(`${OWNER}/B/h1/cover.png`, 3600);
  });

  it('never signs the cover of a hidden book', async () => {
    asUser(FOLLOWER);
    const res = await call(OWNER, ['h1', 'h2']);
    expect(Object.keys((await res.json()).urls)).toEqual(['h1']);
  });

  it('answers 404 to a stranger, a pending follower and when sharing is off', async () => {
    asUser(STRANGER);
    expect((await call(OWNER, ['h1'])).status).toBe(404);

    db['follows'] = [{ follower_id: FOLLOWER, followee_id: OWNER, status: 'pending' }];
    asUser(FOLLOWER);
    expect((await call(OWNER, ['h1'])).status).toBe(404);

    db['follows'] = [{ follower_id: FOLLOWER, followee_id: OWNER, status: 'accepted' }];
    db['profiles'] = [{ user_id: OWNER, library_shared: false }];
    expect((await call(OWNER, ['h1'])).status).toBe(404);
    expect(getDownloadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('requires a signed-in user and valid input', async () => {
    validateUserAndTokenMock.mockResolvedValue({});
    expect((await call(OWNER, ['h1'])).status).toBe(401);
    asUser(FOLLOWER);
    expect((await call('nope', ['h1'])).status).toBe(400);
    expect((await call(OWNER, [])).status).toBe(400);
  });
});

describe('POST /api/requests/create', () => {
  const call = async (body: unknown) => {
    const { POST } = await import('@/app/api/requests/create/route');
    return POST(req(body));
  };

  it('stores a pending request with the book’s display data', async () => {
    asUser(FOLLOWER);
    const res = await call({ ownerId: OWNER, bookHash: 'h1', message: 'Please' });
    expect(res.status).toBe(200);
    expect(db['book_requests']?.[0]).toMatchObject({
      owner_id: OWNER,
      requester_id: FOLLOWER,
      book_hash: 'h1',
      book_title: 'Alpha',
      book_format: 'epub',
      message: 'Please',
      status: 'pending',
    });
  });

  it('refuses hidden books, strangers and your own books like missing ones', async () => {
    asUser(FOLLOWER);
    expect((await call({ ownerId: OWNER, bookHash: 'h2' })).status).toBe(404);
    asUser(STRANGER);
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(404);
    asUser(OWNER);
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(400);
    expect(db['book_requests']).toHaveLength(0);
  });

  it('rejects a second open request for the same book', async () => {
    asUser(FOLLOWER);
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(200);
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(409);
  });

  it('blocks asking again right after a decline, allows it after the retry period', async () => {
    asUser(FOLLOWER);
    db['book_requests'] = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        owner_id: OWNER,
        requester_id: FOLLOWER,
        book_hash: 'h1',
        status: 'declined',
        answered_at: new Date().toISOString(),
      },
    ];
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(429);

    db['book_requests'][0]!['answered_at'] = new Date(Date.now() - 31 * 86_400_000).toISOString();
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(200);
    expect(db['book_requests']).toHaveLength(1);
    expect(db['book_requests']?.[0]?.['status']).toBe('pending');
  });

  it('refuses a book whose file is not uploaded', async () => {
    db['files'] = db['files']!.filter((f) => String(f['file_key']).endsWith('cover.png'));
    asUser(FOLLOWER);
    expect((await call({ ownerId: OWNER, bookHash: 'h1' })).status).toBe(409);
  });
});

describe('POST /api/requests/[id]/answer', () => {
  const ID = '44444444-4444-4444-8444-444444444444';
  const call = async (body: unknown, id = ID) => {
    const { POST } = await import('@/app/api/requests/[id]/answer/route');
    return POST(req(body), { params: Promise.resolve({ id }) });
  };
  const pending = (): Row => ({
    id: ID,
    owner_id: OWNER,
    requester_id: FOLLOWER,
    book_hash: 'h1',
    book_title: 'Alpha',
    book_author: 'A',
    book_format: 'epub',
    message: null,
    status: 'pending',
    created_at: new Date().toISOString(),
    answered_at: null,
  });

  it('accepting creates the grant for the requester and marks the request', async () => {
    db['book_requests'] = [pending()];
    asUser(OWNER);
    const res = await call({ accept: true, expirationDays: 7 });
    expect(res.status).toBe(200);
    expect(db['book_grants']?.[0]).toMatchObject({
      owner_id: OWNER,
      grantee_id: FOLLOWER,
      book_hash: 'h1',
    });
    expect(db['book_requests']?.[0]?.['status']).toBe('accepted');
  });

  it('declining creates no grant and keeps the row', async () => {
    db['book_requests'] = [pending()];
    asUser(OWNER);
    expect((await call({ accept: false })).status).toBe(200);
    expect(db['book_grants']).toHaveLength(0);
    expect(db['book_requests']?.[0]?.['status']).toBe('declined');
  });

  it('answers 404 to anyone but the owner', async () => {
    db['book_requests'] = [pending()];
    for (const id of [FOLLOWER, STRANGER]) {
      asUser(id);
      expect((await call({ accept: true, expirationDays: 7 })).status).toBe(404);
    }
    expect(db['book_grants']).toHaveLength(0);
  });

  it('answers a request only once and validates the duration', async () => {
    db['book_requests'] = [{ ...pending(), status: 'declined' }];
    asUser(OWNER);
    expect((await call({ accept: true, expirationDays: 7 })).status).toBe(409);
    db['book_requests'] = [pending()];
    expect((await call({ accept: true, expirationDays: 3 })).status).toBe(400);
    expect((await call({ accept: 'yes' })).status).toBe(400);
  });
});
