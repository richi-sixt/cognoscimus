import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV = {
  S3_ENDPOINT: 'https://nbg1.example-objectstorage.test',
  S3_REGION: 'nbg1',
  S3_ACCESS_KEY_ID: 'AKIATESTKEY',
  S3_SECRET_ACCESS_KEY: 'secret-test-key',
  S3_BUCKET_NAME: 'books-bucket',
};

const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, '');
    else vi.stubEnv(k, v);
  }
  return import('@/utils/object');
};

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe('presigned object URLs', () => {
  it('signs a path-style upload URL that pins the content length', async () => {
    const { getUploadSignedUrl } = await load(ENV);
    const url = new URL(await getUploadSignedUrl('user-1/Cognoscimus/Books/h.epub', 1234, 1800));

    expect(url.origin).toBe(ENV.S3_ENDPOINT);
    expect(url.pathname).toBe('/books-bucket/user-1/Cognoscimus/Books/h.epub');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('1800');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('AKIATESTKEY/');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/nbg1/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('does not add checksum parameters that other S3 stores reject', async () => {
    const { getUploadSignedUrl, getDownloadSignedUrl } = await load(ENV);
    for (const signed of [
      await getUploadSignedUrl('u/f.epub', 10, 60),
      await getDownloadSignedUrl('u/f.epub', 60),
    ]) {
      const keys = [...new URL(signed).searchParams.keys()].map((k) => k.toLowerCase());
      expect(keys.some((k) => k.includes('checksum'))).toBe(false);
    }
  });

  it('signs a short-lived download URL for the same bucket', async () => {
    const { getDownloadSignedUrl } = await load(ENV);
    const url = new URL(await getDownloadSignedUrl('user-1/f.epub', 300));
    expect(url.pathname).toBe('/books-bucket/user-1/f.epub');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  it('says what is missing when object storage is not configured', async () => {
    const { getDownloadSignedUrl } = await load({
      ...ENV,
      S3_ENDPOINT: undefined,
      S3_BUCKET_NAME: undefined,
    });
    await expect(getDownloadSignedUrl('u/f.epub', 60)).rejects.toThrow(
      /S3_ENDPOINT, S3_BUCKET_NAME/,
    );
  });
});
