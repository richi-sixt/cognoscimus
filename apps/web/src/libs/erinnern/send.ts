import { supabase } from '@/utils/supabase';
import { mergeInto, saveQuote, type QuoteSourceInput } from './quotes';

export type SendOutcome = 'created' | 'merged' | 'cancelled';

/**
 * "Send to Remember" from the reader or from Later. A new or identical quote
 * is handled by `saveQuote`; for a similar one `confirmMerge` asks whether the
 * source should go to the most similar existing quote (no: nothing is saved).
 */
export const sendQuote = async (
  userId: string,
  input: { text: string; source: QuoteSourceInput },
  confirmMerge: (existingText: string) => boolean,
): Promise<SendOutcome> => {
  const result = await saveQuote(userId, input);
  if (result.status === 'similar') {
    const best = result.candidates[0]!;
    if (!confirmMerge(best.text)) return 'cancelled';
    await mergeInto(userId, best.id, input.source);
    return 'merged';
  }
  return result.status;
};

/** The signed-in user's id, read when needed so callers need no auth provider. */
export const currentUserId = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
};
