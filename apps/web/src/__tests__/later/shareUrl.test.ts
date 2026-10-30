import { describe, expect, it } from 'vitest';
import { pickSharedUrl } from '@/libs/later/shareUrl';

describe('pickSharedUrl', () => {
  it('prefers the url parameter', () => {
    expect(pickSharedUrl({ url: 'https://a.example/x', text: 'https://b.example' })).toBe(
      'https://a.example/x',
    );
  });
  it('finds the link inside the text Android sends', () => {
    expect(pickSharedUrl({ text: 'Great read https://a.example/post?id=1.' })).toBe(
      'https://a.example/post?id=1',
    );
  });
  it('ignores non-http schemes and empty input', () => {
    expect(pickSharedUrl({ url: 'javascript:alert(1)', text: 'ftp://a.example' })).toBeNull();
    expect(pickSharedUrl({})).toBeNull();
  });
});
