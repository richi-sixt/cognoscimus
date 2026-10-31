import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { type ItemKind, kindFromUrl, MIN_ARTICLE_WORDS } from '@/libs/later/kind';

const PAGE = 1000;
const CHUNK = 100;

// POST /api/later/recheck — applies the kind rules to articles saved before
// they existed: known hosts and files become bookmarks, and so do pages with
// too little text. Nothing is downloaded; the stored text is kept, so "Save as
// article" still works on every change.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  try {
    const byKind = new Map<ItemKind, string[]>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('later_items')
        .select('id, url, word_count, fetch_state')
        .eq('user_id', user.id)
        .eq('kind', 'article')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        let kind: ItemKind | null = null;
        try {
          kind = kindFromUrl(new URL(row.url as string));
        } catch {
          // An unparsable address keeps its kind.
        }
        if (
          !kind &&
          row.fetch_state === 'ready' &&
          (row.word_count as number) < MIN_ARTICLE_WORDS
        ) {
          kind = 'link';
        }
        if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), row.id as string]);
      }
      if ((data?.length ?? 0) < PAGE) break;
    }

    let changed = 0;
    for (const [kind, ids] of byKind) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { error } = await supabase
          .from('later_items')
          .update({ kind })
          .eq('user_id', user.id)
          .in('id', chunk);
        if (error) throw error;
        changed += chunk.length;
      }
    }
    return NextResponse.json({ changed });
  } catch (error) {
    console.error('later recheck failed:', (error as { message?: string })?.message ?? error);
    return NextResponse.json({ error: 'Could not re-check the types' }, { status: 500 });
  }
}
