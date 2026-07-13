import { BACKEND_ENABLED } from './config';
import { resolveBaseUrl } from './api';

/**
 * AI instruction generation — backend-routed.
 *
 * When a creator lists ingredients but leaves the steps in the video, the
 * backend generates plausible instructions from the dish name + ingredients
 * using Claude (Haiku 4.5). The API key lives server-side ONLY — a browser
 * extension is distributed to every user, so an embedded LLM key would be
 * trivially extractable and abusable. The extension never holds a key; it asks
 * the backend, which calls Claude. See docs/AI_INSTRUCTIONS.md for the endpoint
 * spec and a reference Lambda.
 *
 * Inert until BACKEND_ENABLED (src/shared/config.ts). Generated steps are
 * always stored/shown as instructionsSource: 'ai' — never as the creator's own.
 */

interface GenerateResponse {
  instructions?: string[];
}

/** POST /v1/extension/generate-instructions → steps, or null on any failure. */
export async function generateInstructions(
  title: string,
  ingredients: string[],
  sourceUrl = '',
  apiBaseUrl = '',
): Promise<string[] | null> {
  if (!BACKEND_ENABLED || ingredients.length === 0) return null;
  try {
    const res = await fetch(`${resolveBaseUrl(apiBaseUrl)}/v1/extension/generate-instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, ingredients, sourceUrl, source: 'chrome-extension' }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as GenerateResponse | null;
    const steps = body?.instructions?.map((s) => s.trim()).filter((s) => s.length > 2);
    return steps && steps.length > 0 ? steps : null;
  } catch {
    return null;
  }
}
