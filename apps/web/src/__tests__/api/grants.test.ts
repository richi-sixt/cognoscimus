import { describe, it, expect, vi, beforeEach } from 'vitest';

// Access to a granted book is decided on the server: only the grantee, only
// while the grant is neither revoked nor expired. The tests drive the routes
// against a small in-memory stand-in for the database.

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
const users: Record<string, string> = {}; // email (lower case) -> id

const table = (name: string) => {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'upsert' | 'update' = 'select';
  let payload: Row = {};
  let head = false;
  const rows = () => (db[name] ??= []);
  const matched = () => rows().filter((r) => filters.every((f) => f(r)));
  const exec = (single: boolean) => {
    if (op === 'upsert') {
      const key = (r: Row) => `${r['owner_id']}|${r['grantee_id']}|${r['book_hash']}`;
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
    upsert: (p: Row) => {
      op = 'upsert';
      payload = p;
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
    gt: (c: string, v: string) => {
      filters.push((r) => String(r[c]) > v);
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
  createSupabaseAdminClient: () => ({
    from: (name: string) => table(name),
    rpc: async (fn: string, args: { p_email: string }) =>
      fn === 'find_user_id_by_email'
        ? { data: users[args.p_email.toLowerCase()] ?? null, error: null }
        : { data: null, error: { message: 'unknown rpc' } },
  }),
}));

const OWNER = '11111111-1111-4111-8111-111111111111';
const GRANTEE = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';

const asUser = (id: string, email = 'x@example.com') =>
  validateUserAndTokenMock.mockResolvedValue({ user: { id, email }, token: 't' });

const grantRow = (over: Row = {}): Row => ({
  id: GRANT_ID,
  owner_id: OWNER,
  grantee_id: GRANTEE,
  book_hash: 'h1',
  book_title: 'A Book',
  book_author: null,
  book_format: 'epub',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  revoked_at: null,
  created_at: new Date().toISOString(),
  ...over,
});

const req = (body?: unknown) =>
  new Request('http://localhost/api/grants', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(users)) delete users[k];
  vi.clearAllMocks();
  getDownloadSignedUrlMock.mockResolvedValue('https://bucket.example/signed');
  db['files'] = [
    {
      user_id: OWNER,
      book_hash: 'h1',
      file_key: `${OWNER}/Cognoscimus/Books/h1/cover.png`,
      file_size: 1,
      deleted_at: null,
    },
    {
      user_id: OWNER,
      book_hash: 'h1',
      file_key: `${OWNER}/Cognoscimus/Books/h1/h1.epub`,
      file_size: 9,
      deleted_at: null,
    },
  ];
});

describe('GET /api/grants/[id]/download', () => {
  const call = async (id = GRANT_ID) => {
    const { GET } = await import('@/app/api/grants/[id]/download/route');
    return GET(req(), { params: Promise.resolve({ id }) });
  };

  it('signs the owner’s book file (not the cover) for the grantee', async () => {
    db['book_grants'] = [grantRow()];
    asUser(GRANTEE);
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://bucket.example/signed');
    expect(getDownloadSignedUrlMock).toHaveBeenCalledWith(
      `${OWNER}/Cognoscimus/Books/h1/h1.epub`,
      300,
    );
  });

  it('refuses a revoked grant', async () => {
    db['book_grants'] = [grantRow({ revoked_at: new Date().toISOString() })];
    asUser(GRANTEE);
    const res = await call();
    expect(res.status).toBe(403);
    expect(getDownloadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('refuses an expired grant', async () => {
    db['book_grants'] = [grantRow({ expires_at: new Date(Date.now() - 1000).toISOString() })];
    asUser(GRANTEE);
    expect((await call()).status).toBe(403);
    expect(getDownloadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('answers 404 to anyone but the grantee, owner included', async () => {
    db['book_grants'] = [grantRow()];
    for (const id of [STRANGER, OWNER]) {
      asUser(id);
      expect((await call()).status).toBe(404);
    }
    expect(getDownloadSignedUrlMock).not.toHaveBeenCalled();
  });

  it('requires a signed-in user and a valid id', async () => {
    validateUserAndTokenMock.mockResolvedValue({});
    expect((await call()).status).toBe(401);
    asUser(GRANTEE);
    expect((await call('not-a-uuid')).status).toBe(400);
  });
});

describe('POST /api/grants/[id]/revoke', () => {
  const call = async () => {
    const { POST } = await import('@/app/api/grants/[id]/revoke/route');
    return POST(req(), { params: Promise.resolve({ id: GRANT_ID }) });
  };

  it('lets the owner revoke, and nobody else', async () => {
    db['book_grants'] = [grantRow()];
    asUser(GRANTEE);
    expect((await call()).status).toBe(404);
    expect(db['book_grants']![0]!['revoked_at']).toBeNull();

    asUser(OWNER);
    expect((await call()).status).toBe(204);
    expect(db['book_grants']![0]!['revoked_at']).not.toBeNull();
  });
});

describe('POST /api/grants/create', () => {
  const call = async (body: unknown) => {
    const { POST } = await import('@/app/api/grants/create/route');
    return POST(req(body));
  };

  beforeEach(() => {
    users['reader@example.com'] = GRANTEE;
    db['books'] = [
      {
        user_id: OWNER,
        book_hash: 'h1',
        title: 'A Book',
        author: 'Someone',
        format: 'EPUB',
        deleted_at: null,
      },
    ];
    db['book_grants'] = [];
    asUser(OWNER, 'owner@example.com');
  });

  it('creates a grant that expires after the chosen days', async () => {
    const res = await call({
      bookHash: 'h1',
      granteeEmail: 'Reader@Example.com',
      expirationDays: 7,
    });
    expect(res.status).toBe(200);
    const row = db['book_grants']![0]!;
    expect(row['grantee_id']).toBe(GRANTEE);
    expect(row['book_format']).toBe('epub');
    const days = (new Date(String(row['expires_at'])).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it('renews instead of duplicating, and clears a revocation', async () => {
    await call({ bookHash: 'h1', granteeEmail: 'reader@example.com', expirationDays: 1 });
    db['book_grants']![0]!['revoked_at'] = new Date().toISOString();
    await call({ bookHash: 'h1', granteeEmail: 'reader@example.com', expirationDays: 30 });
    expect(db['book_grants']).toHaveLength(1);
    expect(db['book_grants']![0]!['revoked_at']).toBeNull();
  });

  it.each([
    [
      'unknown user',
      { bookHash: 'h1', granteeEmail: 'nobody@example.com', expirationDays: 7 },
      404,
    ],
    ['yourself', { bookHash: 'h1', granteeEmail: 'owner@example.com', expirationDays: 7 }, 400],
    [
      'bad expiry',
      { bookHash: 'h1', granteeEmail: 'reader@example.com', expirationDays: 365 },
      400,
    ],
    ['bad email', { bookHash: 'h1', granteeEmail: 'nope', expirationDays: 7 }, 400],
    [
      'a book you do not have',
      { bookHash: 'other', granteeEmail: 'reader@example.com', expirationDays: 7 },
      404,
    ],
  ])('rejects %s', async (_name, body, status) => {
    expect((await call(body)).status).toBe(status);
    expect(db['book_grants']).toHaveLength(0);
  });

  it('asks for an upload first when the file is not in storage', async () => {
    db['files'] = [];
    const res = await call({
      bookHash: 'h1',
      granteeEmail: 'reader@example.com',
      expirationDays: 7,
    });
    expect(res.status).toBe(409);
  });
});
