import { beforeEach, describe, expect, it, vi } from 'vitest';

// The list of loans names the other person by name and username when they have a
// profile, and only falls back to the e-mail address when they have none. The
// address of someone who is only known by username must never reach the client.

const validateUserAndTokenMock = vi.fn();
const getUserByIdMock = vi.fn();

vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...a: unknown[]) => validateUserAndTokenMock(...a),
}));

const grants = [
  { id: 'g1', owner_id: 'me', grantee_id: 'with-profile', book_title: 'A' },
  { id: 'g2', owner_id: 'me', grantee_id: 'named', book_title: 'B' },
  { id: 'g3', owner_id: 'me', grantee_id: 'no-profile', book_title: 'C' },
];
const profiles = [
  { user_id: 'with-profile', handle: 'mirko', display_name: '' },
  { user_id: 'named', handle: 'anna', display_name: 'Anna' },
];

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (name: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        is: () => b,
        gt: () => b,
        in: () => Promise.resolve({ data: profiles, error: null }),
        order: () => b,
        limit: () => Promise.resolve({ data: name === 'book_grants' ? grants : [], error: null }),
      };
      return b;
    },
    auth: { admin: { getUserById: (id: string) => getUserByIdMock(id) } },
  }),
}));

import { GET } from '@/app/api/grants/list/route';

const call = async (role: string) => {
  const response = await GET(
    new Request(`http://x/api/grants/list?role=${role}`, {
      headers: { authorization: 'Bearer t' },
    }),
  );
  return (await response.json()) as { grants: Record<string, unknown>[] };
};

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockResolvedValue({ user: { id: 'me' }, token: 't' });
  getUserByIdMock
    .mockReset()
    .mockImplementation(async (id: string) => ({ data: { user: { email: `${id}@example.com` } } }));
});

describe('GET /api/grants/list — who a loan is with', () => {
  it('names people with a profile and keeps their address on the server', async () => {
    const { grants: list } = await call('owner');

    expect(list[0]).toMatchObject({ grantee_label: '@mirko', grantee_email: null });
    expect(list[1]).toMatchObject({ grantee_label: 'Anna (@anna)', grantee_email: null });
    expect(JSON.stringify(list.slice(0, 2))).not.toContain('example.com');
  });

  it('falls back to the address for someone without a profile', async () => {
    const { grants: list } = await call('owner');

    expect(list[2]).toMatchObject({
      grantee_label: 'no-profile@example.com',
      grantee_email: 'no-profile@example.com',
    });
    expect(getUserByIdMock).toHaveBeenCalledTimes(1);
  });
});
