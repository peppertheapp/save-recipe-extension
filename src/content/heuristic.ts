import type { ExtractedRecipe } from '../shared/types';
import { cleanText } from './detector';

/**
 * Third detection tier: schema-less recipe pages (small utility sites and old
 * blogs with no JSON-LD/microdata, e.g. takethemameal.com). Finds
 * "Ingredients" / "Directions" headings and reads the content beneath them,
 * handling both modern lists and the classic "<b>Ingredients:</b><br>line<br>
 * line" pattern where the label and items share one <p>.
 *
 * Precision-first gates: BOTH sections must exist, with ≥3 ingredients and
 * ≥2 steps. Saves are flagged extractionMethod 'server' for backend refinement.
 */

const INGREDIENTS_HEADING_RE = /^\s*ingredients?\b/i;
const INSTRUCTIONS_HEADING_RE = /^\s*(instructions?|directions?|method|preparation|steps)\b/i;
/** Section labels we must not emit as list items, and must not confuse for the target. */
const LABEL_RE =
  /^\s*(ingredients?|instructions?|directions?|method|preparation|steps|serves|servings|yield|from|freezer|notes?|tips?|nutrition)\b\s*:?\s*$/i;
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, strong, b, dt, [role="heading"]';

const MIN_INGREDIENTS = 3;
const MIN_INSTRUCTIONS = 2;
const SEARCH_WINDOW = 80;

export function detectHeuristicRecipe(doc: Document, url: string): ExtractedRecipe | null {
  const all = [...doc.querySelectorAll('*')];
  const headings = all.filter(
    (el) => el.matches(HEADING_SELECTOR) && (el.textContent ?? '').trim().length < 60,
  );

  const ingredientsHeading = headings.find(
    (el) => INGREDIENTS_HEADING_RE.test(el.textContent ?? '') && !/freezer/i.test(el.textContent ?? ''),
  );
  const instructionsHeading = headings.find(
    (el) => INSTRUCTIONS_HEADING_RE.test(el.textContent ?? '') && !/freezer/i.test(el.textContent ?? ''),
  );
  if (!ingredientsHeading || !instructionsHeading) return null;

  const ingredients = itemsForHeading(all, ingredientsHeading, instructionsHeading, doc, false);
  const instructions = itemsForHeading(all, instructionsHeading, ingredientsHeading, doc, true);
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
    extractionMethod: 'server',
  };

  const image = metaContent(doc, 'og:image');
  if (image) recipe.imageUrl = image;

  // Author: "From:" field on old blogs, else meta author.
  const fromHeading = headings.find((el) => /^\s*from\b/i.test(el.textContent ?? ''));
  const from = fromHeading ? labelValue(fromHeading, doc) : '';
  const author = from || metaContent(doc, 'author');
  if (author) recipe.author = author;

  const servesHeading = headings.find((el) => /^\s*(serves|servings|yield)\b/i.test(el.textContent ?? ''));
  const serves = servesHeading ? labelValue(servesHeading, doc) : '';
  const servesMatch = /(\d{1,3})/.exec(serves || bodyText(doc));
  if (servesMatch?.[1] && (serves || /\bserves?\b/i.test(bodyText(doc)))) recipe.yield = servesMatch[1];

  return recipe;
}

/**
 * Items beneath a heading. Tries, in order:
 *  A. `<br>`-separated lines in the heading's own inline block (`<b>Ingredients:
 *     </b><br>…` inside one `<p>`), label line dropped.
 *  B. the first following `<ul>`/`<ol>`.
 *  C. (instructions only) a run of following `<p>` siblings.
 */
function itemsForHeading(
  all: Element[],
  heading: Element,
  boundary: Element,
  doc: Document,
  allowParagraphs: boolean,
): string[] {
  // A) br-separated within a tight inline container.
  const block = heading.closest('p, li, dd');
  if (block && block.querySelector('br')) {
    const lines = splitByBr(block, doc).filter((t) => t.length > 1 && !LABEL_RE.test(t));
    if (lines.length > 0) return lines;
  }

  // B/C) following siblings.
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
        .filter((t) => t.length > 1 && t.length < 300 && !LABEL_RE.test(t));
      if (items.length > 0) return items;
    }
    // A block with br lines shortly after the heading (not sharing its element).
    if (el.matches('p, div') && el.querySelector('br')) {
      const lines = splitByBr(el, doc).filter((t) => t.length > 1 && !LABEL_RE.test(t));
      if (lines.length >= 2) return lines;
    }
  }

  if (!allowParagraphs) return [];
  const paragraphs: string[] = [];
  for (let i = start + 1; i < end; i++) {
    const el = all[i]!;
    if (el.matches(HEADING_SELECTOR) && paragraphs.length > 0) break;
    if (el.matches('p')) {
      const text = cleanText(el.textContent ?? '', doc);
      if (text.length > 20 && text.length < 1000 && !LABEL_RE.test(text)) paragraphs.push(text);
    }
  }
  return paragraphs;
}

/** Split an element's content into lines on <br>, collapsing whitespace. */
function splitByBr(container: Element, doc: Document): string[] {
  const lines: string[] = [];
  let current = '';
  for (const node of container.childNodes) {
    if (node.nodeName === 'BR') {
      lines.push(current);
      current = '';
    } else {
      current += node.textContent ?? '';
    }
  }
  lines.push(current);
  return lines.map((l) => cleanText(l, doc)).filter(Boolean);
}

/** Value of a "Label: value" field, with the label stripped. */
function labelValue(heading: Element, doc: Document): string {
  const block = heading.closest('p, li, dd') ?? heading.parentElement ?? heading;
  const text = cleanText(block.textContent ?? '', doc);
  return text.replace(LABEL_RE, '').replace(/^\s*[a-z]+\s*:\s*/i, '').trim();
}

function bodyText(doc: Document): string {
  return doc.body?.textContent ?? '';
}

function metaContent(doc: Document, property: string): string {
  return (
    doc
      .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
      ?.getAttribute('content')
      ?.trim() ?? ''
  );
}
