import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => {
  const lookup = async (host: string) =>
    host === 'rebind.example'
      ? [{ address: '93.184.216.34' }, { address: '10.0.0.5' }]
      : [{ address: '93.184.216.34' }];
  return { lookup, default: { lookup } };
});

import { assertPublicHttpUrl, isPrivateAddress } from '@/libs/later/ssrf';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false));
});

describe('assertPublicHttpUrl', () => {
  const blocked = (u: string) => assertPublicHttpUrl(new URL(u));

  it('accepts a public host', async () => {
    await expect(blocked('https://example.com/a')).resolves.toBeUndefined();
  });

  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://localhost:3000/',
    'http://service.internal/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'https://user:pw@example.com/',
    'https://rebind.example/',
  ])('rejects %s', async (u) => {
    await expect(blocked(u)).rejects.toThrow();
  });
});
