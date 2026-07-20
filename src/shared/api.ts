import type { ExtractedRecipe, SaveResult, VerifyResult } from './types';

const PRODUCTION_BASE_URL = 'https://api.peppertheapp.com';

// Read lazily, not at module load: touching chrome.* at import time crashes the
// whole module graph in any non-extension context (previews, tests).
function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}

export function resolveBaseUrl(override: string): string {
  return (override || PRODUCTION_BASE_URL).replace(/\/$/, '');
}

const baseUrl = resolveBaseUrl;

/** Thrown for network-level failures (offline, DNS, timeout) — these are retryable. */
export class NetworkError extends Error {}

interface ImportResponse {
  recipeId?: string;
  profileUrl?: string;
  duplicate?: boolean;
  status?: string;
  message?: string;
}

export async function importRecipe(
  userId: string,
  recipe: ExtractedRecipe,
  apiBaseUrl = '',
): Promise<SaveResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(apiBaseUrl)}/v1/extension/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        recipe,
        source: 'chrome-extension',
        extensionVersion: extensionVersion(),
      }),
    });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : 'network failure');
  }

  const body = (await res.json().catch(() => ({}))) as ImportResponse;

  if (res.status === 201) {
    return { status: 'saved', recipeId: body.recipeId, profileUrl: body.profileUrl };
  }
  if (res.status === 200 && body.duplicate) {
    return { status: 'duplicate', recipeId: body.recipeId, profileUrl: body.profileUrl };
  }
  if (res.status === 202) {
    // Server-side extraction accepted for async processing.
    return { status: 'saved', recipeId: body.recipeId };
  }
  if (res.status === 404) return { status: 'error', error: 'Unknown Pepper user — reconnect in the popup.' };
  if (res.status === 422) return { status: 'error', error: 'Pepper rejected this recipe (invalid data).' };
  if (res.status === 429) return { status: 'error', error: 'Rate limited — try again in a bit.' };
  if (res.status >= 500) throw new NetworkError(`server error ${res.status}`); // retryable
  return { status: 'error', error: body.message ?? `Unexpected response (${res.status}).` };
}

export async function verifyUser(userId: string, apiBaseUrl = ''): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await fetch(
      `${baseUrl(apiBaseUrl)}/v1/extension/verify?userId=${encodeURIComponent(userId)}`,
    );
  } catch {
    return { valid: false, error: 'Could not reach Pepper — check your connection.' };
  }
  if (!res.ok) return { valid: false, error: 'User ID not found.' };
  const body = (await res.json().catch(() => null)) as VerifyResult | null;
  if (!body?.valid) return { valid: false, error: 'User ID not found.' };
  return body;
}
