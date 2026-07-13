import type { ExtractedRecipe } from '../shared/types';
import { cleanText } from './detector';

/**
 * Social capture: Instagram/TikTok/Facebook/Pinterest posts carry recipes in
 * captions, not structured data. Strategies per platform, tried in order of
 * reliability (verified against live pages 2026-07-10):
 *
 *  1. Embedded state JSON — TikTok's __UNIVERSAL_DATA_FOR_REHYDRATION__,
 *     Facebook's relay payloads ("message":{"text":…}), Pinterest's __PWS_DATA__.
 *  2. Caption DOM nodes (platform selectors — these rot, hence 1 and 3).
 *  3. og:/description meta tags — ONLY when og:url matches the current path,
 *     because SPAs leave stale metas behind after client-side navigation.
 *
 * Captions that look like recipes are parsed into ingredients/instructions
 * client-side; saves stay extractionMethod 'server' so the backend LLM pass
 * can refine them later.
 */

// ---------------------------------------------------------------- helpers

function metaContent(doc: Document, property: string): string {
  return (
    doc
      .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
      ?.getAttribute('content')
      ?.trim() ?? ''
  );
}

/** innerText preserves <br> line breaks (captions rely on them); jsdom lacks it. */
function visibleText(el: Element | null): string {
  if (!el) return '';
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return text.trim();
}

/**
 * Meta tags describe the URL in og:url — after an SPA navigation they still
 * describe the PREVIOUS page. Only trust them when og:url matches, or when
 * the page doesn't declare og:url at all.
 */
export function metasAreFresh(doc: Document, url: string): boolean {
  const ogUrl = metaContent(doc, 'og:url');
  if (!ogUrl) return true;
  try {
    const a = new URL(ogUrl);
    const b = new URL(url);
    const norm = (p: string): string => p.replace(/\/+$/, '');
    return norm(a.pathname) === norm(b.pathname);
  } catch {
    return true;
  }
}

/**
 * IG-style engagement wrapper: `123 likes, 4 comments - chef on July 1, 2026:
 * "the caption"`. Prefer the quoted tail; otherwise return the input.
 */
export function captionFromOgDescription(og: string, doc: Document): string {
  if (!og) return '';
  const quoted = /:\s*"([\s\S]+)"?\s*$/.exec(og);
  const caption = quoted?.[1] ?? og;
  return cleanText(caption.replace(/"$/, ''), doc);
}

/** Author from the same wrapper: `… - kerrygoldsouthafrica on July 7, 2026: …` */
export function authorFromOgDescription(og: string): string {
  const m = /-\s*([\w.]+)\s+on\s+\w+\s+\d{1,2},\s*\d{4}/.exec(og);
  return m?.[1] ?? '';
}

/** Decode a JSON string literal body (handles \n, \uXXXX, escaped quotes). */
function decodeJsonString(body: string): string {
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    return '';
  }
}

interface ScriptCaption {
  text: string;
  /** Raw script source + match position, so author/thumbnail lookups can stay near THIS post's payload. */
  scriptSource: string;
  index: number;
}

/**
 * Scan inline scripts for ALL `"<key>":{"text":"…"}` payloads (Facebook relay
 * data). Feed/reel pages preload sibling posts, so several captions coexist —
 * callers must disambiguate against the visible DOM.
 */
function scriptCaptions(doc: Document, keys: string[]): ScriptCaption[] {
  const out: ScriptCaption[] = [];
  for (const script of doc.querySelectorAll('script')) {
    const text = script.textContent ?? '';
    for (const key of keys) {
      const re = new RegExp(`"${key}"\\s*:\\s*\\{\\s*"text"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
      for (const m of text.matchAll(re)) {
        const decoded = decodeJsonString(m[1] ?? '');
        if (decoded.length > 20 && !out.some((c) => c.text === decoded)) {
          out.push({ text: decoded, scriptSource: text, index: m.index ?? 0 });
        }
      }
    }
  }
  return out;
}

/** Decoded string from the regex match closest to `center` in `source`. */
function nearestScriptValue(source: string, re: RegExp, center: number): string {
  let best = '';
  let bestDistance = Infinity;
  for (const m of source.matchAll(re)) {
    const distance = Math.abs((m.index ?? 0) - center);
    if (distance < bestDistance && m[1]) {
      bestDistance = distance;
      best = decodeJsonString(m[1]);
    }
  }
  return best;
}

const FB_AUTHOR_RES = [
  /"actors"\s*:\s*\[\s*\{[^[\]{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
  /"owner"\s*:\s*\{[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
];
const FB_THUMBNAIL_RES = [
  /"preferred_thumbnail"\s*:\s*\{\s*"image"\s*:\s*\{[^{}]*?"uri"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
  /"thumbnailImage"\s*:\s*\{[^{}]*?"uri"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
];

/** Walk parsed JSON for the first long string under a matching key. */
function deepFindString(node: unknown, keyRe: RegExp, minLen: number, depth = 0): string {
  if (depth > 12 || node === null || typeof node !== 'object') return '';
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === 'string' && keyRe.test(key) && value.length >= minLen) return value;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = deepFindString(value, keyRe, minLen, depth + 1);
    if (found) return found;
  }
  return '';
}

// ---------------------------------------------------------------- platforms

interface SocialCapture {
  caption: string;
  author?: string;
  image?: string;
}

function extractInstagram(doc: Document, url: string): SocialCapture {
  // 1) Post-page caption node.
  const dom = visibleText(doc.querySelector('article h1'));
  if (dom.length > 20) return { caption: cleanText(dom, doc) };
  // 2) Meta wrapper (og:description and/or meta[name=description]).
  if (metasAreFresh(doc, url)) {
    const raw = metaContent(doc, 'og:description') || metaContent(doc, 'description');
    const caption = captionFromOgDescription(raw, doc);
    if (caption) return { caption, author: authorFromOgDescription(raw) || undefined };
  }
  return { caption: '' };
}

function extractTikTok(doc: Document, url: string): SocialCapture {
  // 1) Embedded state (stable since 2023; survives selector rot).
  const universal = doc.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (universal?.textContent) {
    try {
      const data = JSON.parse(universal.textContent) as Record<string, unknown>;
      const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
      const detail = scope?.['webapp.video-detail'] as
        | {
            itemInfo?: {
              itemStruct?: {
                desc?: string;
                author?: { nickname?: string };
                video?: { cover?: string };
              };
            };
          }
        | undefined;
      const item = detail?.itemInfo?.itemStruct;
      if (item?.desc && item.desc.length > 10) {
        return { caption: item.desc, author: item.author?.nickname, image: item.video?.cover };
      }
      const anyDesc = deepFindString(data, /^desc$/, 30);
      if (anyDesc) return { caption: anyDesc };
    } catch {
      /* fall through */
    }
  }
  // 2) Caption DOM nodes.
  for (const sel of ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]']) {
    const text = visibleText(doc.querySelector(sel));
    if (text.length > 20) return { caption: cleanText(text, doc) };
  }
  // 3) Metas.
  if (metasAreFresh(doc, url)) {
    const caption = captionFromOgDescription(metaContent(doc, 'og:description'), doc);
    if (caption) return { caption };
  }
  return { caption: '' };
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Comment bodies are noisier than captions, so the bar is higher: an explicit
 * ingredients/recipe header, or 4+ measurement/cooking-verb signals. Returns
 * the longest qualifying comment (recipes beat "yum, I added 2 cups!").
 */
export function strongestRecipeComment(doc: Document): string {
  let best = '';
  for (const { text } of scriptCaptions(doc, ['body'])) {
    if (text.length < 40 || text.length <= best.length) continue;
    const strong =
      /\b(ingredients?|recipe)\b\s*:?/i.test(text) ||
      (text.match(MEASUREMENT_RE)?.length ?? 0) + (text.match(COOKING_VERB_RE)?.length ?? 0) >= 4;
    if (strong) best = text;
  }
  return best;
}

function extractFacebook(doc: Document, url: string): SocialCapture {
  // Visible texts: dedicated caption nodes plus dir="auto" blocks (the one
  // attribute FB's obfuscation never strips). Truncated ("… See more") is
  // fine — they're used for matching, not extraction.
  const visible: string[] = [];
  for (const sel of ['[data-ad-preview="message"]', '[data-testid="post_message"]']) {
    const text = visibleText(doc.querySelector(sel));
    if (text.length > 20) visible.push(text);
  }
  for (const el of doc.querySelectorAll('div[dir="auto"], span[dir="auto"]')) {
    const text = visibleText(el);
    if (text.length > 20 && text.length < 5000) visible.push(text);
  }

  // 1) Relay payloads hold the FULL caption — but possibly for this reel AND
  //    preloaded siblings. A single candidate is unambiguous (reel overlays
  //    render the caption outside dir=auto, so don't demand a DOM match);
  //    multiple candidates disambiguate against what's on screen.
  const candidates = scriptCaptions(doc, ['message', 'savable_description']);
  let best: ScriptCaption | null = candidates.length === 1 ? (candidates[0] ?? null) : null;
  if (!best) {
    for (const candidate of candidates) {
      const head = normalize(candidate.text).slice(0, 30);
      const onScreen = visible.some((v) => {
        const nv = normalize(v);
        return nv.startsWith(head) || normalize(candidate.text).startsWith(nv.slice(0, 30));
      });
      if (onScreen && candidate.text.length > (best?.text.length ?? 0)) best = candidate;
    }
  }
  if (best) {
    // Creators often tease in the caption and put the recipe in a pinned
    // comment. If the caption alone isn't recipe-shaped, append the strongest
    // recipe-looking comment body so the save carries the actual recipe.
    let caption = best.text;
    if (!looksLikeRecipe(caption)) {
      const comment = strongestRecipeComment(doc);
      if (comment) caption = `${caption}\n\n${comment}`;
    }
    best = { ...best, text: caption };
  }
  if (best) {
    // Author + cover live in the same relay object — search nearest to the
    // caption's position so we never pick a preloaded sibling's metadata.
    const author = FB_AUTHOR_RES.map((re) =>
      nearestScriptValue(best!.scriptSource, re, best!.index),
    ).find(Boolean);
    const image = FB_THUMBNAIL_RES.map((re) =>
      nearestScriptValue(best!.scriptSource, re, best!.index),
    ).find((u) => u?.startsWith('http'));
    return {
      caption: best.text,
      author: author || undefined,
      image: image || doc.querySelector('video')?.getAttribute('poster') || undefined,
    };
  }

  // 2) Dedicated caption nodes (feed posts / permalinks).
  const nodeCaption = visible.find((v, i) => i < 2 && v.length > 20);
  if (nodeCaption && doc.querySelector('[data-ad-preview="message"], [data-testid="post_message"]')) {
    return { caption: cleanText(nodeCaption, doc) };
  }

  // 3) Longest recipe-looking visible block.
  let fallback = '';
  for (const text of visible) {
    if (text.length > fallback.length && looksLikeRecipe(text)) fallback = text;
  }
  if (fallback) return { caption: cleanText(fallback, doc) };

  // 4) Metas (rare on logged-in FB).
  if (metasAreFresh(doc, url)) {
    const caption = captionFromOgDescription(metaContent(doc, 'og:description'), doc);
    if (caption) return { caption };
  }
  return { caption: '' };
}

function extractPinterest(doc: Document, url: string): SocialCapture {
  // 1) App state.
  const pws = doc.querySelector('#__PWS_DATA__');
  if (pws?.textContent) {
    try {
      const desc = deepFindString(JSON.parse(pws.textContent), /description/i, 60);
      if (desc) return { caption: cleanText(desc, doc) };
    } catch {
      /* fall through */
    }
  }
  // 2) Pin description nodes.
  for (const sel of ['[data-test-id="truncated-description"]', '[data-test-id="description"]']) {
    const text = visibleText(doc.querySelector(sel));
    if (text.length > 20) return { caption: cleanText(text, doc) };
  }
  // 3) Metas.
  if (metasAreFresh(doc, url)) {
    const caption = captionFromOgDescription(metaContent(doc, 'og:description'), doc);
    if (caption) return { caption };
  }
  return { caption: '' };
}

interface SocialSite {
  hosts: string[];
  pathPattern: RegExp;
  extract: (doc: Document, url: string) => SocialCapture;
}

const SOCIAL_SITES: SocialSite[] = [
  {
    hosts: ['instagram.com'],
    pathPattern: /^\/(?:[^/]+\/)?(p|reel|reels|tv)\//,
    extract: extractInstagram,
  },
  {
    hosts: ['tiktok.com'],
    pathPattern: /\/video\/|\/photo\//,
    extract: extractTikTok,
  },
  {
    hosts: ['facebook.com'],
    pathPattern: /\/(posts|reel|watch|videos|photo|share)/,
    extract: extractFacebook,
  },
  {
    hosts: ['pinterest.com'],
    pathPattern: /^\/pin\//,
    extract: extractPinterest,
  },
];

// ---------------------------------------------------------------- heuristic

const MEASUREMENT_RE =
  /(\d[\d/.,]*|[½¼¾⅓⅔⅛])\s*(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz\b|ounces?|grams?|g\b|kg\b|ml\b|liters?|litres?|lbs?\b|pounds?|cloves?|sticks?|cans?|pinch)/gi;

const COOKING_VERB_RE =
  /\b(preheat|whisk|simmer|sauté|saute|marinate|knead|dice|mince|drizzle|bake for|cook for|mix until|stir in|fold in)\b/gi;

/** Cheap recipe-ish gate so the button doesn't light up on every food photo. */
export function looksLikeRecipe(text: string): boolean {
  if (/\b(recipe|ingredients?|instructions|directions|method)\b/i.test(text)) return true;
  if (/#\w*recipe/i.test(text)) return true; // #easyrecipe, #recipeoftheday, …
  const signals =
    (text.match(MEASUREMENT_RE)?.length ?? 0) + (text.match(COOKING_VERB_RE)?.length ?? 0);
  return signals >= 2;
}

// ---------------------------------------------------------------- caption parsing

const BULLET_RE = /^[\s\-–—•*▪◦✅✔️🔸🔹👉>]+|^\d{1,2}[.)]\s*/u;
const HEADER_INGREDIENTS_RE = /^[\s#*_]*(ingredients?|what you('|’)?ll? need)\b/i;
const HEADER_INSTRUCTIONS_RE = /^[\s#*_]*(instructions?|directions?|method|steps?|how to make)\b/i;
const HEADER_OTHER_RE = /^[\s#*_]*(notes?|tips?|nutrition|macros)\b/i;

function isNoiseLine(line: string): boolean {
  if (line.length < 3) return true;
  if (/^[#@]/.test(line)) return true; // hashtag/mention lines
  const words = line.split(/\s+/);
  const tags = words.filter((w) => w.startsWith('#') || w.startsWith('@')).length;
  return tags > words.length / 2;
}

/**
 * Structure a caption into ingredients/instructions. Explicit section headers
 * win; otherwise lines are classified by measurement vs. cooking-verb shape.
 */
export function parseCaptionRecipe(caption: string): {
  ingredients: string[];
  instructions: string[];
} {
  const lines = caption
    .split(/\n+/)
    .map((l) => l.replace(BULLET_RE, '').trim())
    .filter((l) => l.length > 0);

  const ingredients: string[] = [];
  const instructions: string[] = [];
  let section: 'ingredients' | 'instructions' | 'other' | null = null;

  // Inline headers ("Ingredients: a, b, c. Whisk and freeze.") carry their
  // content on the same line: comma-split the first sentence as ingredients,
  // remaining cooking-verb sentences become steps.
  const consumeInline = (rest: string): void => {
    const cleaned = rest.replace(/^[:\s\-–]+/, '').trim();
    if (!cleaned) return;
    const [first = '', ...restSentences] = cleaned.split(/(?<=\.)\s+/);
    ingredients.push(
      ...first
        .split(/,\s*/)
        .map((s) => s.replace(/\.$/, '').trim())
        .filter((s) => s.length > 2),
    );
    for (const sentence of restSentences) {
      COOKING_VERB_RE.lastIndex = 0;
      if (COOKING_VERB_RE.test(sentence)) instructions.push(sentence.trim());
    }
  };

  for (const line of lines) {
    if (HEADER_INGREDIENTS_RE.test(line)) {
      section = 'ingredients';
      consumeInline(line.replace(HEADER_INGREDIENTS_RE, ''));
      continue;
    }
    if (HEADER_INSTRUCTIONS_RE.test(line)) {
      section = 'instructions';
      const rest = line.replace(HEADER_INSTRUCTIONS_RE, '').replace(/^[:\s\-–]+/, '').trim();
      if (rest) instructions.push(...rest.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (HEADER_OTHER_RE.test(line)) {
      section = 'other';
      continue;
    }
    if (isNoiseLine(line)) continue;

    if (section === 'ingredients') ingredients.push(line);
    else if (section === 'instructions') instructions.push(line);
    else if (section === null) {
      // No headers (yet): classify by shape.
      MEASUREMENT_RE.lastIndex = 0;
      COOKING_VERB_RE.lastIndex = 0;
      if (line.length < 120 && MEASUREMENT_RE.test(line) && !COOKING_VERB_RE.test(line)) {
        ingredients.push(line);
      } else if (/^[A-Z]?\w+/.test(line) && COOKING_VERB_RE.test(line)) {
        instructions.push(line);
      }
    }
  }
  return { ingredients, instructions };
}

// ---------------------------------------------------------------- entry point

export function detectSocialRecipe(doc: Document, url: string): ExtractedRecipe | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const site = SOCIAL_SITES.find((s) =>
    s.hosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)),
  );
  if (!site || !site.pathPattern.test(parsed.pathname)) return null;

  const { caption, author, image } = site.extract(doc, url);
  if (!caption || !looksLikeRecipe(caption)) return null;

  const structured = parseCaptionRecipe(caption);
  const recipe: ExtractedRecipe = {
    sourceUrl: url,
    title: captionTitle(doc, caption),
    description: caption,
    ingredients: structured.ingredients,
    instructions: structured.instructions,
    extractionMethod: 'server', // backend LLM pass refines caption parses
  };
  if (author) recipe.author = author;
  // Platform-native cover (video poster/thumbnail) beats og:image.
  const cover = image || (metasAreFresh(doc, url) ? metaContent(doc, 'og:image') : '');
  if (cover) recipe.imageUrl = cover;
  return recipe;
}

function captionTitle(doc: Document, caption: string): string {
  const firstLine = caption.split('\n')[0]?.trim() ?? '';
  const title = firstLine.length >= 8 ? firstLine : metaContent(doc, 'og:title') || firstLine;
  return title.length > 90 ? `${title.slice(0, 87)}…` : title || 'Recipe from social post';
}
