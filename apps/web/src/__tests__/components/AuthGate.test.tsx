import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ user: null as { id: string } | null, replace: vi.fn() }));

vi.mock('@/utils/hardNavigate', () => ({ hardNavigate: (url: string) => state.replace(url) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));

import AuthGate from '@/components/AuthGate';

const at = (path: string) => window.history.pushState({}, '', path);

beforeEach(() => {
  state.user = null;
  state.replace.mockReset();
});
afterEach(() => cleanup());

describe('AuthGate', () => {
  it('sends a signed-out visitor to the sign-in page and hides the content', () => {
    at('/library?x=1');
    render(<AuthGate>secret shelf</AuthGate>);
    expect(screen.queryByText('secret shelf')).toBeNull();
    expect(state.replace).toHaveBeenCalledWith('/auth?redirect=%2Flibrary%3Fx%3D1');
  });

  it('shows the content to a signed-in user without redirecting', () => {
    state.user = { id: 'u1' };
    at('/library');
    render(<AuthGate>secret shelf</AuthGate>);
    expect(screen.getByText('secret shelf')).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('leaves the sign-in routes open', () => {
    at('/auth/callback');
    render(<AuthGate>login form</AuthGate>);
    expect(screen.getByText('login form')).toBeTruthy();
    expect(state.replace).not.toHaveBeenCalled();
  });
});
