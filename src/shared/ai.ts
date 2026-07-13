/**
 * On-device instruction generation via Chrome's built-in Prompt API
 * (Gemini Nano). Runs locally in the service worker — no API key, no network,
 * private. Feature-detected: returns null anywhere it isn't available, so the
 * backend LLM pass (Bedrock) remains the production path.
 *
 * When a creator lists ingredients but leaves the steps in the video, we
 * generate plausible instructions from the dish name + ingredients and mark
 * them instructionsSource: 'ai' so they're always shown as AI-suggested, never
 * passed off as the creator's own method.
 */

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?: () => void;
}
interface LanguageModelApi {
  availability?: () => Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create: (opts?: unknown) => Promise<LanguageModelSession>;
}

function getLanguageModel(): LanguageModelApi | null {
  const g = globalThis as unknown as {
    LanguageModel?: LanguageModelApi;
    ai?: { languageModel?: LanguageModelApi };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** True where on-device generation is at least possible (may need a download). */
export async function aiInstructionsAvailable(): Promise<boolean> {
  const lm = getLanguageModel();
  if (!lm) return false;
  try {
    const status = (await lm.availability?.()) ?? 'available';
    return status !== 'unavailable';
  } catch {
    return false;
  }
}

const SYSTEM_PROMPT =
  'You are a concise recipe assistant. Given a dish name and its ingredients, ' +
  'write clear step-by-step cooking instructions. Reply with ONLY a numbered ' +
  'list of steps — no preamble, no ingredient list, no commentary. Keep each ' +
  'step to one sentence. If you are unsure of an exact time or temperature, ' +
  'give a sensible typical value.';

/** Generate cooking steps, or null if on-device AI is unavailable/failed. */
export async function generateInstructions(
  title: string,
  ingredients: string[],
): Promise<string[] | null> {
  const lm = getLanguageModel();
  if (!lm || ingredients.length === 0) return null;
  let session: LanguageModelSession | null = null;
  try {
    const status = (await lm.availability?.()) ?? 'available';
    if (status === 'unavailable') return null;
    session = await lm.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    });
    const input =
      `Dish: ${title}\n\nIngredients:\n${ingredients.join('\n')}\n\n` +
      `Write the cooking steps for this dish.`;
    const output = await session.prompt(input);
    return parseSteps(output);
  } catch {
    return null;
  } finally {
    session?.destroy?.();
  }
}

/** Turn the model's numbered-list reply into a clean step array. */
export function parseSteps(output: string): string[] | null {
  const steps = output
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:step\s*)?\d{1,2}[.):]\s*/i, '').replace(/^[-*•\s]+/, '').trim())
    .filter((l) => l.length > 2 && !/^(here('|’)?s|sure|certainly|instructions?:?$)/i.test(l));
  return steps.length > 0 ? steps : null;
}
