import { describe, expect, it } from 'vitest';
import { COVER_KEEP_BYTES, COVER_MAX_SIDE, fitWithin, shrinkCover } from '@/utils/image';

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the ratio', () => {
    expect(fitWithin(1600, 2400, COVER_MAX_SIDE)).toEqual({ width: 427, height: 640 });
    expect(fitWithin(2000, 1000, COVER_MAX_SIDE)).toEqual({ width: 640, height: 320 });
  });

  it('never scales an image up', () => {
    expect(fitWithin(300, 400, COVER_MAX_SIDE)).toEqual({ width: 300, height: 400 });
  });
});

describe('shrinkCover', () => {
  it('leaves a small cover untouched', async () => {
    const small = new ArrayBuffer(COVER_KEEP_BYTES);
    expect(await shrinkCover(small)).toBe(small);
  });

  it('keeps the original when the image cannot be decoded', async () => {
    // No canvas or decoder in this environment, so a large input comes back as it was.
    const large = new ArrayBuffer(COVER_KEEP_BYTES + 1);
    expect(await shrinkCover(large)).toBe(large);
  });
});
