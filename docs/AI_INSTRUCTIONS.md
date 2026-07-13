# AI instruction generation (backend)

When a creator lists ingredients but leaves the cooking steps in the video
(common on Instagram/TikTok/Facebook and on gated sites like Provecho), the
extension asks the backend to generate plausible steps from the dish name +
ingredients. The generated steps are always shown as **"AI-suggested"** in the
extension, never as the creator's own method.

## Why this is a backend endpoint, not a client-side call

**A Claude/Anthropic API key must never ship inside the extension.** The
extension is distributed to every user; anyone can open the unpacked bundle and
read an embedded key, then run up the bill or get the key banned. The key lives
server-side only. The extension sends the recipe fields; the backend holds the
key and calls Claude.

## Endpoint

### `POST /v1/extension/generate-instructions`

```json
{
  "title": "One Pan Lemon Chicken Pea Pasta",
  "ingredients": [
    "16 oz chicken breast",
    "1 tbsp olive oil",
    "2 tbsp butter",
    "4 cloves garlic, minced",
    "1 cup peas"
  ],
  "sourceUrl": "https://www.instagram.com/reel/...",
  "source": "chrome-extension"
}
```

Response `200`:

```json
{ "instructions": ["Season and sear the chicken…", "Melt the butter…", "…"] }
```

Return `{"instructions": []}` (or any non-200) if generation isn't possible —
the extension treats an empty/failed result as "no steps yet" and leaves the
recipe's instructions blank rather than showing anything wrong.

Guardrails to add server-side: rate-limit per user/IP (this is user-triggered
but cheap to abuse), cap `ingredients` length, and reject payloads whose
`title`+`ingredients` exceed a sane size.

## Reference Lambda (Node.js, `@anthropic-ai/sdk`)

Model: **`claude-haiku-4-5`** — fastest/cheapest, and recipe-step generation is
an easy task for it. Swap the model string if you want higher quality on messy
ingredient lists (`claude-sonnet-5`).

```js
// npm i @anthropic-ai/sdk   (ANTHROPIC_API_KEY set in the Lambda's env/secrets)
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const SYSTEM = [
  'You are a concise recipe assistant. Given a dish name and its ingredients,',
  'write clear step-by-step cooking instructions. Reply with ONLY a numbered',
  'list of steps — no preamble, no ingredient list, no commentary. Keep each',
  'step to one sentence. Use sensible typical times/temperatures when unsure.',
].join(' ');

export const handler = async (event) => {
  const { title, ingredients } = JSON.parse(event.body ?? '{}');
  if (!title || !Array.isArray(ingredients) || ingredients.length === 0) {
    return { statusCode: 422, body: JSON.stringify({ instructions: [] }) };
  }

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Dish: ${title}\n\nIngredients:\n${ingredients.join('\n')}\n\n` +
          `Write the cooking steps for this dish.`,
      },
    ],
  });

  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  const instructions = text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:step\s*)?\d{1,2}[.):]\s*/i, '').replace(/^[-*•\s]+/, '').trim())
    .filter((l) => l.length > 2 && !/^(here'?s|sure|instructions?:?$)/i.test(l));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  };
};
```

Notes for the backend team:
- `max_tokens: 1024` is ample for a step list; raise if you ever pass very long
  ingredient sets. Haiku is non-streaming here — the whole reply is small.
- The step-parsing (strip "1.", bullets, preamble) is duplicated in the client
  as a safety net, but the canonical parse is here so the extension can stay
  dumb.
- This same endpoint can back the Phase 3 server-side *extraction* fallback
  (`extractionMethod: 'server'`): fetch the URL, pull the recipe, and if steps
  are still missing, generate them the same way.
