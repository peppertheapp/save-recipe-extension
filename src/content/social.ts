import type { ExtractedRecipe } from '../shared/types';
import { cleanText } from './detector';

/**
 * Social capture: Instagram/TikTok/Facebook/Pinterest posts carry recipes in
 * captions, not structured data. We grab the caption (site DOM first, og: tags
 * as fallback), keep it as the recipe description, and mark the save
 * extractionMethod: 'server' — the backend's LLM pass turns the caption into
 * ingredients/steps when it lands. Runs only when structured detection missed.
 */

interface SocialSite {
  hosts: string[];
  /** DOM selectors most likely to hold the caption, best first. These rot — keep og: fallback. */
  captionSelectors: string[];
  /** Only post/pin pages, not feeds/profiles. */
  pathPattern: RegExp;
}

const SOCIAL_SITES: SocialSite[] = [
  {
    hosts: ['instagram.com'],
    captionSelectors: ['article h1'],
    pathPattern: /^\/(p|reel|reels|tv)\//,
  },
  {
    hosts: ['tiktok.com'],
    captionSelectors: ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]'],
    pathPattern: /\/video\/|^\/@[^/]+\/photo\//,
  },
  {
    hosts: ['facebook.com'],
    captionSelectors: ['[data-ad-preview="message"]'],
    pathPattern: /\/(posts|reel|watch|videos|photo)/,
  },
  {
    hosts: ['pinterest.com'],
    captionSelectors: ['[data-test-id="truncated-description"]', '[data-test-id="description"]'],
    pathPattern: /^\/pin\//,
  },
];

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

  const caption = extractCaption(doc, site);
  if (!caption || !looksLikeRecipe(caption)) return null;

  const recipe: ExtractedRecipe = {
    sourceUrl: url,
    title: captionTitle(doc, caption),
    description: caption,
    ingredients: [],
    instructions: [],
    extractionMethod: 'server',
  };
  const image = metaContent(doc, 'og:image');
  if (image) recipe.imageUrl = image;
  return recipe;
}

function extractCaption(doc: Document, site: SocialSite): string {
  for (const selector of site.captionSelectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text && text.length > 20) return cleanText(text, doc);
  }
  return captionFromOgDescription(metaContent(doc, 'og:description'), doc);
}

/**
 * og:description often wraps the caption in engagement chrome, e.g. Instagram:
 * `123 likes, 4 comments - chef on July 1, 2026: "the actual caption"`.
 * Prefer the quoted tail; otherwise use the whole thing.
 */
export function captionFromOgDescription(og: string, doc: Document): string {
  if (!og) return '';
  const quoted = /:\s*"([\s\S]+)"?\s*$/.exec(og);
  const caption = quoted?.[1] ?? og;
  return cleanText(caption.replace(/"$/, ''), doc);
}

/** Cheap recipe-ish heuristic so we don't light up on every post. */
export function looksLikeRecipe(text: string): boolean {
  if (/\b(recipe|ingredients?|instructions|directions|method)\b/i.test(text)) return true;
  const measurements =
    text.match(
      /\d[\d/.,]*\s*(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz\b|ounces?|grams?|g\b|kg\b|ml\b|liters?|litres?|lbs?\b|pounds?|cloves?|sticks?)\b/gi,
    ) ?? [];
  return measurements.length >= 2;
}

function captionTitle(doc: Document, caption: string): string {
  const firstLine = caption.split('\n')[0]?.trim() ?? '';
  const title = firstLine.length >= 8 ? firstLine : (metaContent(doc, 'og:title') || firstLine);
  return title.length > 90 ? `${title.slice(0, 87)}…` : title || 'Recipe from social post';
}

function metaContent(doc: Document, property: string): string {
  return (
    doc
      .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
      ?.getAttribute('content')
      ?.trim() ?? ''
  );
}
