import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Link from '@/components/Link';

afterEach(cleanup);

describe('Link', () => {
  it('opens in a new tab without leaking the opener', () => {
    render(<Link href='https://example.com'>Open</Link>);
    const link = screen.getByRole('link', { name: 'Open' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
