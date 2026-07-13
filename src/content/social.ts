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
 * The active reel's caption text, anchored to the viewport. A reel feed holds
 * many posts at once; selecting a caption by content ("longest recipe") grabs
 * the wrong reel. The video centered in the viewport identifies the active
 * post — we walk up to its caption container and return that text (normalized,
 * usually "See more"-truncated). Empty when there's no layout (jsdom tests) or
 * no video. Verified against a live reel feed 2026-07-13.
 */
export function activeReelAnchor(doc: Document): string {
  const videos = [...doc.querySelectorAll('video')];
  if (videos.length === 0) return '';
  const view = doc.defaultView;
  const cx = (view?.innerWidth ?? 0) / 2;
  const cy = (view?.innerHeight ?? 0) / 2;
  let active: Element | null = null;
  let bestDist = Infinity;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // hidden / no layout
    const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (d < bestDist) {
      bestDist = d;
      active = v;
    }
  }
  if (!active) return '';
  // First ancestor with substantial text = the tightest post container (its
  // own caption; sibling reels live in separate subtrees).
  for (let el: Element | null = active, i = 0; el && i < 12; el = el.parentElement, i++) {
    const text = (el as HTMLElement).innerText?.trim() ?? '';
    if (text.length > 60) return normalize(text);
  }
  return '';
}

/**
 * Pick the caption belonging to the active reel: its first line (the caption
 * title, before any "See more" cut) must appear in the viewport anchor text.
 * Returns null when the active reel is known but no candidate matches it —
 * correctness-first, we never fall back to a sibling's caption.
 */
export function pickActiveCaptionByAnchor(
  candidates: ScriptCaption[],
  anchor: string,
): ScriptCaption | null {
  for (const c of candidates) {
    const firstLine = normalize(c.text.split('\n')[0] ?? '');
    const probe = firstLine.length >= 8 ? firstLine : normalize(c.text).slice(0, 24);
    if (probe.length >= 8 && anchor.includes(probe)) return c;
  }
  return null;
}

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
  //    preloaded siblings. Reel captions don't reliably render in matchable DOM
  //    text (collapsed behind "See more", split across spans), so the recipe
  //    gate does the disambiguation: sibling teasers aren't recipe-shaped, the
  //    real caption is. On-screen is only a tiebreaker; we never guess blindly.
  const onScreen = (c: ScriptCaption): boolean => {
    const head = normalize(c.text).slice(0, 30);
    return visible.some((v) => {
      const nv = normalize(v);
      return nv.startsWith(head) || normalize(c.text).startsWith(nv.slice(0, 30));
    });
  };
  const longest = (list: ScriptCaption[]): ScriptCaption | null =>
    list.reduce<ScriptCaption | null>((a, b) => (b.text.length > (a?.text.length ?? 0) ? b : a), null);

  const candidates = scriptCaptions(doc, ['message', 'savable_description']);

  // PRIMARY: anchor to the reel centered in the viewport. On a feed this is the
  // only correct signal — content heuristics can't tell two real recipes apart.
  const anchor = activeReelAnchor(doc);
  let best: ScriptCaption | null;
  if (anchor) {
    best = pickActiveCaptionByAnchor(candidates, anchor);
    // Active reel known but caption not matched (not loaded yet / teaser): try
    // its comment recipe, else give up rather than grab a sibling's caption.
    if (best && !looksLikeRecipe(best.text)) {
      const comment = strongestRecipeComment(doc);
      if (comment) best = { ...best, text: `${best.text}\n\n${comment}` };
    }
  } else {
    // FALLBACK (permalink pages / no video / tests): the recipe gate
    // disambiguates — sibling teasers aren't recipe-shaped, on-screen wins ties.
    const recipeish = candidates.filter((c) => looksLikeRecipe(c.text));
    if (recipeish.length > 0) {
      const visibleRecipes = recipeish.filter(onScreen);
      best = longest(visibleRecipes.length > 0 ? visibleRecipes : recipeish);
    } else {
      const active = candidates.find(onScreen) ?? (candidates.length === 1 ? candidates[0] : null);
      if (active) {
        const comment = strongestRecipeComment(doc);
        best = comment ? { ...active, text: `${active.text}\n\n${comment}` } : null;
      } else {
        best = null;
      }
    }
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

// Strip bullets and "1." / "2)" list markers — but require a space after the
// number so decimal quantities ("2.2 lb potatoes") aren't mangled.
const BULLET_RE = /^[\s\-–—•*▪◦✅✔️🔸🔹👉>]+|^\d{1,2}[.)]\s+/u;

function isNoiseLine(line: string): boolean {
  if (line.length < 3) return true;
  if (/^[#@]/.test(line)) return true; // hashtag/mention lines
  const words = line.split(/\s+/);
  const tags = words.filter((w) => w.startsWith('#') || w.startsWith('@')).length;
  return tags > words.length / 2;
}

// Section markers, matched ANYWHERE in the text (not just line starts) — many
// captions are one run-on paragraph with the labels buried mid-text.
const MARK_INGREDIENTS = /(?:^|[\s\n])(ingredients?|what you(?:'|’)?ll need)\s*:?/i;
const MARK_INSTRUCTIONS = /(?:^|[\s\n])(instructions?|directions?|method|steps?|how to make it?)\s*:?/i;
/** Where a section ends: the next section, or trailing promo/notes/hashtags. */
const MARK_TRAILER = /(?:^|[\s\n])(notes?|tips?|nutrition|announcements?|follow|comment|link in)\s*:?/i;

/** First index of any marker in `text` at/after `from`, else text length. */
function firstMarkerIndex(text: string, markers: RegExp[], from: number): number {
  let end = text.length;
  for (const re of markers) {
    const m = new RegExp(re.source, 'i').exec(text.slice(from));
    if (m) end = Math.min(end, from + m.index);
  }
  return end;
}

/** Slice the text belonging to a section header found anywhere in the caption. */
function sliceSection(text: string, start: RegExp, ends: RegExp[]): string {
  const m = start.exec(text);
  if (!m) return '';
  const from = m.index + m[0].length;
  return text.slice(from, firstMarkerIndex(text, ends, from)).trim();
}

/** Split an ingredients blob: line breaks/bullets first, else quantity starts. */
export function splitItems(blob: string): string[] {
  let parts = blob.split(/\n+|(?<=[a-z)\d])\s*[•·▪◦]\s*/i);
  if (parts.length < 2) {
    // Run-on ("2 bacon strips 2 sausage 16 oz chicken"): break before a new
    // quantity token that begins another item.
    parts = (parts[0] ?? blob).split(/\s+(?=(?:\d+(?:[.,/]\d+)?|[½¼¾⅓⅔⅛])\b)/);
  }
  return parts
    .map((p) => p.replace(BULLET_RE, '').replace(/^[:\s]+/, '').trim())
    .filter((p) => p.length > 2 && p.length < 200 && !isNoiseLine(p));
}

/** Split an instructions blob: line breaks first, else numbered/sentence steps. */
export function splitSteps(blob: string): string[] {
  let parts = blob.split(/\n+/);
  if (parts.length < 2) {
    const single = parts[0] ?? blob;
    parts = single.split(/\s+(?=\d{1,2}[.)]\s)/); // "1. … 2. …"
    if (parts.length < 2) parts = single.split(/(?<=[.!?])\s+(?=[A-Z0-9])/); // sentences
  }
  return parts
    .map((p) => p.replace(BULLET_RE, '').replace(/^[:\s]+/, '').trim())
    .filter((p) => p.length > 3 && !isNoiseLine(p));
}

/**
 * Structure a caption into ingredients/instructions. If it has "Ingredients:" /
 * "Directions:" markers (anywhere, even mid-paragraph), slice by them and split
 * the slices (handling run-on captions with no line breaks). Otherwise fall
 * back to per-line classification by measurement vs. cooking-verb shape.
 */
export function parseCaptionRecipe(caption: string): {
  ingredients: string[];
  instructions: string[];
} {
  const text = caption.replace(/\r/g, '');

  const hasMarkers = MARK_INGREDIENTS.test(text) || MARK_INSTRUCTIONS.test(text);
  if (hasMarkers) {
    const ingBlob = sliceSection(text, MARK_INGREDIENTS, [MARK_INSTRUCTIONS, MARK_TRAILER]);
    const insBlob = sliceSection(text, MARK_INSTRUCTIONS, [MARK_TRAILER, MARK_INGREDIENTS]);
    return {
      ingredients: ingBlob ? splitItems(ingBlob) : [],
      instructions: insBlob ? splitSteps(insBlob) : [],
    };
  }

  // Headerless: classify line by line.
  const ingredients: string[] = [];
  const instructions: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(BULLET_RE, '').trim();
    if (line.length === 0 || isNoiseLine(line)) continue;
    MEASUREMENT_RE.lastIndex = 0;
    COOKING_VERB_RE.lastIndex = 0;
    if (line.length < 120 && MEASUREMENT_RE.test(line) && !COOKING_VERB_RE.test(line)) {
      ingredients.push(line);
    } else if (/^[A-Z]?\w+/.test(line) && COOKING_VERB_RE.test(line)) {
      instructions.push(line);
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
