import type { ExtractedRecipe } from '../shared/types';

/**
 * Recipe detection + extraction. Pure over a Document so it runs in jsdom tests.
 * Order: JSON-LD (covers ~90% of recipe sites), then microdata.
 */
export function detectRecipe(doc: Document, url: string): ExtractedRecipe | null {
  return extractFromJsonLd(doc, url) ?? extractFromMicrodata(doc, url);
}

// ---------------------------------------------------------------- JSON-LD

type JsonLdNode = Record<string, unknown>;

function extractFromJsonLd(doc: Document, url: string): ExtractedRecipe | null {
  for (const script of doc.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue; // malformed JSON-LD is common; keep scanning
    }
    const recipeNode = findRecipeNode(parsed);
    if (recipeNode) return normalizeJsonLdRecipe(recipeNode, doc, url);
  }
  return null;
}

/** Walk top-level values, arrays, and @graph containers looking for @type Recipe. */
function findRecipeNode(data: unknown): JsonLdNode | null {
  const candidates: unknown[] = Array.isArray(data) ? [...data] : [data];
  while (candidates.length > 0) {
    const node = candidates.shift();
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      candidates.push(...node);
      continue;
    }
    const obj = node as JsonLdNode;
    if (isRecipeType(obj['@type'])) return obj;
    if (obj['@graph']) candidates.push(obj['@graph']);
    if (obj.mainEntity) candidates.push(obj.mainEntity);
  }
  return null;
}

function isRecipeType(type: unknown): boolean {
  if (typeof type === 'string') return type.toLowerCase() === 'recipe';
  if (Array.isArray(type)) return type.some((t) => isRecipeType(t));
  return false;
}

export function normalizeJsonLdRecipe(
  node: JsonLdNode,
  doc: Document,
  url: string,
): ExtractedRecipe | null {
  const title = cleanText(asString(node.name), doc);
  if (!title) return null;

  const recipe: ExtractedRecipe = {
    sourceUrl: url,
    title,
    ingredients: toStringArray(node.recipeIngredient ?? node.ingredients).map((s) =>
      cleanText(s, doc),
    ),
    instructions: flattenInstructions(node.recipeInstructions, doc),
    extractionMethod: 'json-ld',
  };

  const description = cleanText(asString(node.description), doc);
  if (description) recipe.description = description;

  const imageUrl = pickImageUrl(node.image ?? node.thumbnailUrl);
  if (imageUrl) recipe.imageUrl = imageUrl;

  const author = extractAuthor(node.author);
  if (author) recipe.author = cleanText(author, doc);

  const yieldValue = extractYield(node.recipeYield);
  if (yieldValue) recipe.yield = cleanText(yieldValue, doc);

  const prep = parseIsoDurationMinutes(asString(node.prepTime));
  if (prep !== null) recipe.prepTimeMinutes = prep;
  const cook = parseIsoDurationMinutes(asString(node.cookTime));
  if (cook !== null) recipe.cookTimeMinutes = cook;
  const total = parseIsoDurationMinutes(asString(node.totalTime));
  if (total !== null) recipe.totalTimeMinutes = total;

  const cuisine = toStringArray(node.recipeCuisine, /*splitCommas*/ true);
  if (cuisine.length > 0) recipe.cuisine = cuisine;
  const category = toStringArray(node.recipeCategory, true);
  if (category.length > 0) recipe.category = category;
  const keywords = toStringArray(node.keywords, true);
  if (keywords.length > 0) recipe.keywords = keywords;

  const nutrition = extractNutrition(node.nutrition);
  if (nutrition) recipe.nutrition = nutrition;

  const rating = node.aggregateRating as JsonLdNode | undefined;
  if (rating && typeof rating === 'object') {
    const value = asNumber(rating.ratingValue);
    if (value !== null) recipe.ratingValue = value;
    const count = asNumber(rating.ratingCount) ?? asNumber(rating.reviewCount);
    if (count !== null) recipe.ratingCount = count;
  }

  return recipe;
}

/** recipeInstructions: string | string[] | HowToStep[] | HowToSection[] (arbitrarily nested). */
function flattenInstructions(value: unknown, doc: Document): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === 'string') {
      // A single blob string may hold multiple steps separated by newlines.
      for (const line of v.split(/\n+/)) {
        const text = cleanText(line, doc);
        if (text) out.push(text);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === 'object') {
      const obj = v as JsonLdNode;
      // HowToSection → recurse into itemListElement; HowToStep → take text/name.
      if (obj.itemListElement) {
        visit(obj.itemListElement);
        return;
      }
      const text = cleanText(asString(obj.text) || asString(obj.name), doc);
      if (text) out.push(text);
    }
  };
  visit(value);
  return out;
}

/** image: string | string[] | ImageObject | ImageObject[] — prefer the widest. */
function pickImageUrl(value: unknown): string | undefined {
  const candidates: { url: string; width: number }[] = [];
  const visit = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === 'string') {
      candidates.push({ url: v, width: 0 });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === 'object') {
      const obj = v as JsonLdNode;
      const url = asString(obj.url) || asString(obj.contentUrl);
      if (url) candidates.push({ url, width: asNumber(obj.width) ?? 0 });
    }
  };
  visit(value);
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.width - a.width);
  return candidates[0]?.url;
}

function extractAuthor(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const names = value.map(extractAuthor).filter(Boolean);
    return names.length > 0 ? names.join(', ') : undefined;
  }
  if (value && typeof value === 'object') {
    return asString((value as JsonLdNode).name) || undefined;
  }
  return undefined;
}

function extractYield(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  // Sites often emit ["8", "8 servings"] — keep the most descriptive.
  if (Array.isArray(value)) {
    const strings = value.filter((v): v is string => typeof v === 'string');
    if (strings.length === 0) return undefined;
    return strings.reduce((a, b) => (b.length > a.length ? b : a));
  }
  return undefined;
}

function extractNutrition(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as JsonLdNode)) {
    if (key.startsWith('@')) continue;
    if (typeof v === 'string' || typeof v === 'number') out[key] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse ISO-8601 durations like PT1H30M, PT90M, P0DT1H, PT45S → whole minutes. */
export function parseIsoDurationMinutes(value: string): number | null {
  const match = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  const total =
    (Number(days) || 0) * 1440 +
    (Number(hours) || 0) * 60 +
    (Number(minutes) || 0) +
    (Number(seconds) || 0) / 60;
  return Math.round(total);
}

// ---------------------------------------------------------------- Microdata

function extractFromMicrodata(doc: Document, url: string): ExtractedRecipe | null {
  const scope = doc.querySelector('[itemtype*="schema.org/Recipe"]');
  if (!scope) return null;

  const prop = (name: string): string =>
    cleanText(readItemprop(scope.querySelector(`[itemprop="${name}"]`)), doc);
  const props = (name: string): string[] =>
    [...scope.querySelectorAll(`[itemprop="${name}"]`)]
      .map((el) => cleanText(readItemprop(el), doc))
      .filter(Boolean);

  const title = prop('name');
  if (!title) return null;

  const ingredients = [...props('recipeIngredient'), ...props('ingredients')];
  const instructions = props('recipeInstructions').flatMap((s) =>
    s.split(/\n+/).map((line) => cleanText(line, doc)).filter(Boolean),
  );

  const recipe: ExtractedRecipe = {
    sourceUrl: url,
    title,
    ingredients,
    instructions,
    extractionMethod: 'microdata',
  };

  const description = prop('description');
  if (description) recipe.description = description;
  const author = prop('author');
  if (author) recipe.author = author;
  const yieldValue = prop('recipeYield');
  if (yieldValue) recipe.yield = yieldValue;

  const image = scope.querySelector<HTMLElement>('[itemprop="image"]');
  const imageUrl =
    image?.getAttribute('src') ?? image?.getAttribute('content') ?? image?.getAttribute('href');
  if (imageUrl) recipe.imageUrl = imageUrl;

  for (const [field, itemprop] of [
    ['prepTimeMinutes', 'prepTime'],
    ['cookTimeMinutes', 'cookTime'],
    ['totalTimeMinutes', 'totalTime'],
  ] as const) {
    const el = scope.querySelector(`[itemprop="${itemprop}"]`);
    const raw = el?.getAttribute('datetime') ?? el?.getAttribute('content') ?? '';
    const parsed = parseIsoDurationMinutes(raw);
    if (parsed !== null) recipe[field] = parsed;
  }

  return recipe;
}

function readItemprop(el: Element | null): string {
  if (!el) return '';
  return (
    el.getAttribute('content') ??
    (el as HTMLMetaElement).content ??
    el.textContent ??
    ''
  );
}

// ---------------------------------------------------------------- Helpers

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toStringArray(v: unknown, splitCommas = false): string[] {
  let items: string[];
  if (typeof v === 'string') items = splitCommas ? v.split(',') : [v];
  else if (Array.isArray(v)) items = v.filter((x): x is string => typeof x === 'string');
  else return [];
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Decode HTML entities and strip stray tags — JSON-LD strings are full of both. */
export function cleanText(value: string, doc: Document): string {
  if (!value) return '';
  if (!/[<&]/.test(value)) return value.replace(/\s+/g, ' ').trim();
  const div = doc.createElement('div');
  div.innerHTML = value;
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
}
