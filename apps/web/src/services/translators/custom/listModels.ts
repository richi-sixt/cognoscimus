import { getDirectFetch } from '@/utils/directFetch';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** A model as listed by an OpenAI-compatible `/models` endpoint. */
export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
}

/**
 * Fetch the list of models exposed by an OpenAI-compatible endpoint, to
 * populate a model picker. Goes through {@link getDirectFetch} so the native
 * app avoids CORS preflight and Android cleartext restrictions.
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = `${trimmed}/models`;
  const httpFetch = getDirectFetch();
  const response = await httpFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }
  const json = (await response.json()) as { data?: ModelInfo[] };
  return Array.isArray(json.data) ? json.data : [];
}
