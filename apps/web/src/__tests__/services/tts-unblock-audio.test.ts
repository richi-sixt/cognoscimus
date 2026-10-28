import { beforeEach, describe, expect, test, vi } from 'vitest';

import { unblockAudio, releaseUnblockAudio } from '@/services/tts/ttsMediaBridge';

describe('unblockAudio', () => {
  beforeEach(() => {
    releaseUnblockAudio();
    vi.clearAllMocks();
  });

  test('creates the keep-alive element', () => {
    // Desktop Chromium only surfaces hardware media keys while an
    // HTMLMediaElement is playing; iOS Safari (web) still needs it against
    // the mute switch.
    const spy = vi.spyOn(document, 'createElement');
    unblockAudio();
    expect(spy).toHaveBeenCalledWith('audio');
    spy.mockRestore();
    releaseUnblockAudio();
  });
});
