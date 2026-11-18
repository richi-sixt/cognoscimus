import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/supabase', () => ({ supabase: {} }));
vi.mock('@/utils/access', () => ({ getAccessToken: vi.fn() }));
vi.mock('@/services/environment', () => ({ getAPIBaseUrl: () => '' }));

import { descriptionText } from '@/libs/libraryExplore';

// The description of a shared book is publisher text and may hold HTML. The
// explore list shows it as plain text.
describe('descriptionText', () => {
  it('strips tags and keeps paragraphs apart', () => {
    expect(descriptionText('<p>First.</p><p>Second <b>bold</b>.</p>')).toBe('First. Second bold.');
  });

  it('never keeps markup that could run', () => {
    const text = descriptionText('<img src=x onerror=alert(1)>Hello<script>alert(1)</script>');
    expect(text).not.toContain('<');
    expect(text).toContain('Hello');
  });

  it('is empty without a description', () => {
    expect(descriptionText(null)).toBe('');
    expect(descriptionText(undefined)).toBe('');
    expect(descriptionText('   ')).toBe('');
  });
});
