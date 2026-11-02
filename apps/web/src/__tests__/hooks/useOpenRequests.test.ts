import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  follow: vi.fn(),
  borrow: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/libs/later/social', () => ({ countFollowRequests: h.follow }));
vi.mock('@/libs/libraryExplore', () => ({ countOpenBookRequests: h.borrow }));

import { useOpenRequests } from '@/hooks/useOpenRequests';

describe('useOpenRequests', () => {
  beforeEach(() => {
    h.user = { id: 'u1' };
    h.follow.mockReset();
    h.borrow.mockReset();
  });

  it('adds follow requests, offered articles and borrow requests', async () => {
    h.follow.mockResolvedValue(2);
    h.borrow.mockResolvedValue(3);
    const { result } = renderHook(() => useOpenRequests());
    await waitFor(() => expect(result.current).toBe(5));
  });

  it('counts none when signed out or when reading fails', async () => {
    h.user = null;
    const signedOut = renderHook(() => useOpenRequests());
    expect(signedOut.result.current).toBe(0);
    expect(h.follow).not.toHaveBeenCalled();

    h.user = { id: 'u1' };
    h.follow.mockRejectedValue(new Error('offline'));
    h.borrow.mockResolvedValue(1);
    const failing = renderHook(() => useOpenRequests());
    await waitFor(() => expect(h.follow).toHaveBeenCalled());
    expect(failing.result.current).toBe(0);
  });
});
