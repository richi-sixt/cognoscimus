import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemSettings } from '@/types/settings';

/**
 * #5910: the reader's sync row read ONLY Cognoscimus Cloud's per-book stamps, so a
 * user syncing exclusively through WebDAV / iCloud / Drive / S3 was told "Never
 * synced" — or, with no Cognoscimus account at all, "Sign in to Sync" — while their
 * sync was working perfectly. This hook is the shared answer to "is my sync
 * healthy?" for both the reader View menu and the library Settings menu.
 */

let mockUser: { id: string } | null = null;
let mockSettings: Partial<SystemSettings> = {};
let mockByKind: Record<string, { isSyncing: boolean }> = {};
let mockLastError: Record<string, string | null> = {};
let mockHardcover: Record<string, { pending: number; lastError: string | null }> = {};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, vars?: Record<string, unknown>): string =>
      vars ? `${key}|${JSON.stringify(vars)}` : key,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Partial<SystemSettings> }) => unknown) =>
    selector({ settings: mockSettings }),
}));
vi.mock('@/store/fileSyncStore', () => ({
  useFileSyncStore: (
    selector: (s: { byKind: unknown; lastErrorByKind: unknown }) => unknown,
  ): unknown => selector({ byKind: mockByKind, lastErrorByKind: mockLastError }),
}));
vi.mock('@/store/hardcoverSyncStore', () => ({
  useHardcoverSyncStore: (selector: (s: { byBook: typeof mockHardcover }) => unknown): unknown =>
    selector({ byBook: mockHardcover }),
}));
const { useCloudSyncStatus } = await import('@/hooks/useCloudSyncStatus');

const NOW = 1_700_000_000_000;

beforeEach(() => {
  mockUser = null;
  mockSettings = {};
  mockByKind = {};
  mockLastError = {};
  mockHardcover = {};
  vi.setSystemTime(NOW);
});

describe('useCloudSyncStatus (issue #5910)', () => {
  it('still asks for sign-in when Cognoscimus Cloud is the only provider', () => {
    const { result } = renderHook(() => useCloudSyncStatus(0));

    expect(result.current.needsSignIn).toBe(true);
    expect(result.current.label).toBe('Sign in to Sync');
  });
});
