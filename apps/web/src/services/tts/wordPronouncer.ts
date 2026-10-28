import { AppService } from '@/types/system';
import { genSSMLRaw } from '@/utils/ssml';
import { TTSClient } from './TTSClient';
import { WebSpeechClient } from './WebSpeechClient';

// Speaks a single dictionary word through Web Speech. It never spins up the
// reader's full TTSController session.

export type PronounceStatus = 'playing' | 'ended' | 'error';

export interface PronounceWordOptions {
  appService?: AppService | null;
}

// Bumped on every new request so a slower in-flight init can detect it has
// been superseded and bail before touching the client or status.
let requestToken = 0;
let activeAbort: AbortController | null = null;
let activeClient: TTSClient | null = null;

const stopActive = (): void => {
  activeAbort?.abort();
  activeAbort = null;
  const client = activeClient;
  activeClient = null;
  if (client) void client.shutdown().catch(() => {});
};

export const cancelWordPronounce = (): void => {
  requestToken++;
  stopActive();
};

export const pronounceWord = async (
  word: string,
  lang: string | undefined,
  _options: PronounceWordOptions,
  onStatus?: (status: PronounceStatus) => void,
): Promise<void> => {
  const token = ++requestToken;
  const emit = (status: PronounceStatus) => {
    if (token === requestToken) onStatus?.(status);
  };

  const trimmed = word.trim();
  if (!trimmed) {
    emit('ended');
    return;
  }
  const voiceLang = lang && lang.length ? lang : 'en';

  // Stop whatever is currently playing.
  stopActive();

  const client: TTSClient = new WebSpeechClient();
  activeClient = client;
  const controller = new AbortController();
  activeAbort = controller;
  try {
    const ready = await client.init();
    if (!ready || token !== requestToken) {
      emit('error');
      return;
    }
    client.setPrimaryLang(voiceLang);
    emit('playing');
    for await (const ev of client.speak(genSSMLRaw(trimmed), controller.signal)) {
      if (ev.code === 'error') {
        emit('error');
        return;
      }
    }
    emit('ended');
  } catch {
    emit('error');
  } finally {
    if (activeClient === client) activeClient = null;
    if (activeAbort === controller) activeAbort = null;
    void client.shutdown().catch(() => {});
  }
};
