/**
 * wordPronouncer — pronounces a single dictionary word.
 *
 * The pronouncer is deliberately independent of the reader's TTSController: it
 * speaks through the platform speech client (Web Speech on desktop/web, the
 * native client on the mobile app). These tests pin the client choice, the
 * status reporting, and the guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const makeClient = (speak: unknown, init = true) => ({
    init: vi.fn().mockResolvedValue(init),
    setPrimaryLang: vi.fn(),
    speak,
    shutdown: vi.fn().mockResolvedValue(undefined),
  });
  // eslint-disable-next-line require-yield
  const webSpeak = vi.fn(async function* (_ssml: string, _signal: AbortSignal) {});
  // eslint-disable-next-line require-yield
  const nativeSpeak = vi.fn(async function* (_ssml: string, _signal: AbortSignal) {});
  return {
    makeClient,
    webClient: makeClient(webSpeak),
    nativeClient: makeClient(nativeSpeak),
    webSpeak,
    nativeSpeak,
  };
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: class {
    constructor() {
      Object.assign(this, h.webClient);
    }
  },
}));

vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: class {
    constructor() {
      Object.assign(this, h.nativeClient);
    }
  },
}));

import { pronounceWord, cancelWordPronounce } from '@/services/tts/wordPronouncer';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  h.webClient.init.mockResolvedValue(true);
});

describe('pronounceWord — client choice', () => {
  it('uses Web Speech on desktop/web', async () => {
    const onStatus = vi.fn();

    await pronounceWord('hello', 'en', {}, onStatus);
    await flush();

    expect(h.webSpeak).toHaveBeenCalledTimes(1);
    const ssml = h.webSpeak.mock.calls[0]![0];
    expect(ssml).toContain('hello');
    expect(h.nativeSpeak).not.toHaveBeenCalled();
    expect(h.webClient.setPrimaryLang).toHaveBeenCalledWith('en');
    expect(onStatus).toHaveBeenCalledWith('playing');
    expect(onStatus).toHaveBeenLastCalledWith('ended');
  });

  it('uses the native client on the mobile app', async () => {
    await pronounceWord('hello', 'en', { appService: { isMobile: true } as never }, vi.fn());
    await flush();

    expect(h.nativeSpeak).toHaveBeenCalledTimes(1);
    expect(h.webSpeak).not.toHaveBeenCalled();
  });

  it('falls back to English when no language is given', async () => {
    await pronounceWord('hello', undefined, {}, vi.fn());
    await flush();

    expect(h.webClient.setPrimaryLang).toHaveBeenCalledWith('en');
  });

  it('reports an error when the engine cannot start', async () => {
    h.webClient.init.mockResolvedValue(false);
    const onStatus = vi.fn();

    await pronounceWord('hello', 'en', {}, onStatus);
    await flush();

    expect(h.webSpeak).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('error');
  });
});

describe('pronounceWord — guards', () => {
  it('does nothing for a blank word', async () => {
    const onStatus = vi.fn();
    await pronounceWord('   ', 'en', {}, onStatus);
    expect(h.webSpeak).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenLastCalledWith('ended');
  });

  it('shuts the active client down on cancel', async () => {
    const pending = pronounceWord('hello', 'en', {}, vi.fn());
    cancelWordPronounce();
    await pending;
    await flush();

    expect(h.webClient.shutdown).toHaveBeenCalled();
  });
});
