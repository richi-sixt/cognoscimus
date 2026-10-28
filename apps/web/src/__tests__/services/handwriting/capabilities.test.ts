import { describe, it, expect } from 'vitest';
import { detectPenBackend } from '@/services/handwriting/capabilities';

describe('detectPenBackend', () => {
  it('uses pointer events when the browser has them', async () => {
    expect(await detectPenBackend({ hasPointerEvents: true })).toBe('pointer');
  });

  it('reports no backend without pointer events', async () => {
    expect(await detectPenBackend({ hasPointerEvents: false })).toBe('none');
  });
});
