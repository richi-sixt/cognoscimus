import { NextResponse } from 'next/server';
import { validateUserAndToken } from '@/utils/access';
import { SeriesSuggestion, SeriesLookupQuery } from '@/libs/seriesLookup';

const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql';
const MAX_QUERIES = 25;

const QUERY = `query ($title: String!) {
  books(where: { title: { _ilike: $title } }, order_by: { users_count: desc }, limit: 3) {
    title
    book_series { position series { name } }
  }
}`;

interface HardcoverBook {
  title: string;
  book_series: { position: number | null; series: { name: string } | null }[];
}

const lookupOne = async (
  query: SeriesLookupQuery,
  token: string,
): Promise<SeriesSuggestion | null> => {
  const response = await fetch(HARDCOVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      query: QUERY,
      variables: { title: `%${query.title.replace(/[%_\\]/g, '\\$&')}%` },
    }),
  });
  if (!response.ok) {
    console.error('Hardcover lookup failed:', response.status);
    return null;
  }
  const json = (await response.json()) as {
    data?: { books?: HardcoverBook[] };
    errors?: { message: string }[];
  };
  if (json.errors?.length) console.error('Hardcover lookup errors:', json.errors[0]?.message);
  for (const book of json.data?.books ?? []) {
    const link = book.book_series.find((entry) => entry.series?.name);
    if (link?.series) {
      return {
        hash: query.hash,
        series: link.series.name,
        seriesIndex: link.position ?? undefined,
        matchedTitle: book.title,
      };
    }
  }
  return null;
};

// POST /api/metadata/lookup { queries: [{ hash, title }] }
// Looks up series name and position on Hardcover. The token stays on the server
// (HARDCOVER_API_TOKEN) and the result is a suggestion, never applied here.
export async function POST(request: Request) {
  const { user } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const token = process.env['HARDCOVER_API_TOKEN'];
  if (!token) {
    return NextResponse.json({ error: 'Online lookup is not configured' }, { status: 501 });
  }

  const body = (await request.json().catch(() => null)) as { queries?: SeriesLookupQuery[] } | null;
  const queries = (body?.queries ?? [])
    .filter((q) => q && typeof q.hash === 'string' && typeof q.title === 'string' && q.title.trim())
    .slice(0, MAX_QUERIES);
  if (queries.length === 0) {
    return NextResponse.json({ error: 'queries required' }, { status: 400 });
  }

  const results = await Promise.all(queries.map((q) => lookupOne(q, token).catch(() => null)));
  return NextResponse.json({ suggestions: results.filter((r) => r !== null) });
}
