import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { BOOK_SEARCH_QUERY_MAX } from '@/libs/bookLookup';
import { searchBookCatalogues } from '@/libs/bookLookupServer';

// POST /api/metadata/book-search { query } — looks a printed book up by ISBN or
// title in public catalogues. The result is a list to choose from.
export async function POST(request: Request) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > BOOK_SEARCH_QUERY_MAX) {
    return NextResponse.json({ error: 'query required', code: 'invalid_query' }, { status: 400 });
  }

  try {
    return NextResponse.json({ books: await searchBookCatalogues(query) });
  } catch (error) {
    console.error('book search failed:', error);
    return NextResponse.json(
      { error: 'The book search is not available right now', code: 'lookup_failed' },
      { status: 502 },
    );
  }
}
