import { getDirectFetch } from '@/utils/directFetch';
import type { CustomTranslator } from '@/types/translation';
import { ErrorCodes, TranslationProvider } from '../types';
import { normalizeToShortLang } from '@/utils/lang';
import { CUSTOM_TRANSLATOR_PREFIX } from './constants';

/**
 * DeepL language codes are upper-case, but the service answers 500 when the
 * *script* subtag is upper-cased too. Measured against the live endpoint:
 * `ZH-HANT` and `ZH-TW` both fail, while `ZH-Hant` answers 200 with real
 * Traditional Chinese — and the same holds for `source_lang`. Upper-casing the
 * whole code therefore turned every zh-TW/zh-HK/zh-MO translation into a hard
 * failure. `normalizeToShortLang` already returns the canonical `zh-Hans` /
 * `zh-Hant`, so only the primary subtag is upper-cased and the script subtag
 * keeps the casing it came with. Languages without a script subtag ('en' -> 'EN',
 * and 'AUTO' -> 'AUTO') are unaffected.
 */
export const toDeepLLang = (lang: string): string => {
  const [primary, ...rest] = normalizeToShortLang(lang).split('-');
  return [primary!.toUpperCase(), ...rest].join('-');
};

const DEFAULT_RETRY_AFTER_SECONDS = 2;
const MAX_RETRY_AFTER_SECONDS = 10;

/** DeepL API with the user's own key; Free keys end in `:fx`. */
export const createDeepLTranslator = (config: CustomTranslator): TranslationProvider => {
  const apiKey = config.apiKey ?? '';
  const endpoint = apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  return {
    name: `${CUSTOM_TRANSLATOR_PREFIX}${config.id}`,
    label: config.name,
    translate: async (texts, sourceLang, targetLang, _token, _useCache, signal) => {
      const indices = texts.flatMap((text, i) => (text?.trim() ? [i] : []));
      if (indices.length === 0) return texts;

      const source = toDeepLLang(sourceLang);
      const body = JSON.stringify({
        text: indices.map((i) => texts[i]),
        ...(source !== 'AUTO' ? { source_lang: source } : {}),
        target_lang: toDeepLLang(targetLang),
      });
      const send = () =>
        getDirectFetch()(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal,
        });

      let response = await send();
      if (response.status === 429) {
        const retryAfter =
          Number(response.headers.get('Retry-After')) || DEFAULT_RETRY_AFTER_SECONDS;
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        response = await send();
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(ErrorCodes.UNAUTHORIZED);
      }
      if (response.status === 456) {
        throw new Error(`DeepL quota exceeded for ${config.name}`);
      }
      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data = (await response.json()) as { translations?: { text: string }[] };
      const results = [...texts];
      indices.forEach((textIndex, i) => {
        results[textIndex] = data.translations?.[i]?.text ?? texts[textIndex]!;
      });
      return results;
    },
  };
};
