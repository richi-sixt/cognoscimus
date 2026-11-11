import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { validateUserAndToken } from '@/utils/access';
import { isMailUrl } from '@/libs/later/constants';
import { isUuid } from '@/libs/grantsServer';

// POST /api/later/aslink — turns a saved article into a plain link: the stored
// text and its highlights are dropped, title, excerpt and picture stay. The way
// back is /api/later/refetch with asArticle, which fetches the page again.
export async function POST(request: Request) {
  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as { id?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isUuid(body.id)) {
    return NextResponse.json({ error: 'Missing or invalid id' }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  try {
    const { data: item, error: readError } = await supabase
      .from('later_items')
      .select('id, url, kind, excerpt')
      .eq('id', body.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!item) return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    // An item that came by mail has no page to open, so its text is all there is.
    if (item.kind !== 'article' || isMailUrl(item.url as string)) {
      return NextResponse.json(
        { error: 'Only a saved article can become a link', code: 'not_an_article' },
        { status: 422 },
      );
    }

    // Highlights point into the text that is about to go.
    const { error: highlightError } = await supabase
      .from('later_highlights')
      .delete()
      .eq('item_id', item.id);
    if (highlightError) throw highlightError;

    const { error } = await supabase
      .from('later_items')
      .update({
        kind: 'link',
        content_html: '',
        // The excerpt stays searchable, as it does for links saved as such.
        content_text: (item.excerpt as string | null) ?? '',
        word_count: 0,
        progress: 0,
      })
      .eq('id', item.id);
    if (error) throw error;
    return NextResponse.json({ id: item.id });
  } catch (error) {
    console.error('later aslink failed:', error);
    return NextResponse.json({ error: 'Could not change the item' }, { status: 500 });
  }
}
