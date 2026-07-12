import type { ExtractedRecipe } from '../shared/types';
import { cleanText } from './detector';

/**
 * Third detection tier: schema-less recipe pages (small utility sites and old
 * blogs with no JSON-LD/microdata, e.g. takethemameal.com). Finds
 * "Ingredients" / "Instructions" headings and reads the lists beneath them.
 *
 * Precision-first gates: BOTH sections must exist, with ≥3 ingredients and
 * ≥2 steps — random pages don't have that shape. Saves are flagged
 * extractionMethod 'server' so the backend re-extracts/refines later.
 */

const INGREDIENTS_HEADING_RE = /^\s*ingredients?\b/i;
const INSTRUCTIONS_HEADING_RE = /^\s*(instructions?|directions?|method|preparation|steps)\b/i;
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, strong, b, dt, [role="heading"]';

const MIN_INGREDIENTS = 3;
const MIN_INSTRUCTIONS = 2;
/** How far past a heading (in document-order elements) we look for its list. */
const SEARCH_WINDOW = 80;

export function detectHeuristicRecipe(doc: Document, url: string): ExtractedRecipe | null {
  const all = [...doc.querySelectorAll('*')];
  const headings = all.filter(
    (el) => el.matches(HEADING_SELECTOR) && (el.textContent ?? '').trim().length < 60,
  );

  const ingredientsHeading = headings.find((el) =>
    INGREDIENTS_HEADING_RE.test(el.textContent ?? ''),
  );
  const instructionsHeading = headings.find((el) =>
    INSTRUCTIONS_HEADING_RE.test(el.textContent ?? ''),
  );
  if (!ingredientsHeading || !instructionsHeading) return null;

  const ingredients = listAfter(all, ingredientsHeading, instructionsHeading, doc);
  const instructions = listAfter(all, instructionsHeading, ingredientsHeading, doc, true);
  if (ingredients.length < MIN_INGREDIENTS || instructions.length < MIN_INSTRUCTIONS) return null;

  const title =
    cleanText(doc.querySelector('h1')?.textContent ?? '', doc) ||
    metaContent(doc, 'og:title') ||
    cleanText(doc.title, doc);
  if (!title) return null;

  const recipe: ExtractedRecipe = {
    sourceUrl: url,
    title,
    ingredients,
    instructions,
    extractionMethod: 'server', // heuristic parse — backend refines later
  };

  const image = metaContent(doc, 'og:image');
  if (image) recipe.imageUrl = image;
  const author = metaContent(doc, 'author');
  if (author) recipe.author = author;

  const bodyText = doc.body?.textContent ?? '';
  const servings = /(?:serves|servings?|yield)[:\s]+(\d{1,3})/i.exec(bodyText);
  if (servings?.[1]) recipe.yield = servings[1];

  return recipe;
}

/**
 * Items of the first list (ul/ol li, or dense <p> run) that appears after
 * `heading` in document order, stopping before `boundary` if it comes first.
 */
function listAfter(
  all: Element[],
  heading: Element,
  boundary: Element,
  doc: Document,
  allowParagraphs = false,
): string[] {
  const start = all.indexOf(heading);
  const boundaryIndex = all.indexOf(boundary);
  const end = Math.min(
    all.length,
    start + SEARCH_WINDOW,
    boundaryIndex > start ? boundaryIndex : all.length,
  );

  for (let i = start + 1; i < end; i++) {
    const el = all[i]!;
    if (el.matches('ul, ol')) {
      const items = [...el.querySelectorAll(':scope > li')]
        .map((li) => cleanText(li.textContent ?? '', doc))
        .filter((t) => t.length > 1 && t.length < 300);
      if (items.length > 0) return items;
    }
  }

  if (!allowParagraphs) return [];
  // Instructions on plain pages are often a run of <p> siblings instead of a list.
  const paragraphs: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const el = all[i]!;
    if (el.matches(HEADING_SELECTOR) && paragraphs.length > 0) break;
    if (el.matches('p')) {
      const text = cleanText(el.textContent ?? '', doc);
      if (text.length > 20 && text.length < 1000) paragraphs.push(text);
    }
  }
  return paragraphs;
}

function metaContent(doc: Document, property: string): string {
  return (
    doc
      .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
      ?.getAttribute('content')
      ?.trim() ?? ''
  );
}
