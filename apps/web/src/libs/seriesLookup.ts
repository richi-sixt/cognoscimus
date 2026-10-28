import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';

export interface SeriesLookupQuery {
  hash: string;
  title: string;
}

export interface SeriesSuggestion {
  hash: string;
  series: string;
  seriesIndex?: number;
  matchedTitle: string;
}

const BATCH = 25;

export const lookupSeries = async (queries: SeriesLookupQuery[]): Promise<SeriesSuggestion[]> => {
  const out: SeriesSuggestion[] = [];
  for (let i = 0; i < queries.length; i += BATCH) {
    const response = await fetchWithAuth(`${getAPIBaseUrl()}/metadata/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: queries.slice(i, i + BATCH) }),
    });
    const data = (await response.json()) as { suggestions: SeriesSuggestion[] };
    out.push(...data.suggestions);
  }
  return out;
};
