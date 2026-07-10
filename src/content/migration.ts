import type { ExtractedRecipe } from '../shared/types';

/**
 * Phase 5 — one-click collection migration ("Switch to Pepper").
 *
 * On the user's own saved-recipes page (MyRecipes favorites), a Pepper banner
 * offers to import the whole collection. On confirm we auto-scroll the list
 * the user can already see, collect recipe links, and save each as a URL stub
 * (extractionMethod 'server' — full extraction happens backend-side later).
 *
 * Boundaries per the build plan: only the logged-in user's own visible list,
 * only on explicit click, capped, no credential handling.
 */

const IMPORT_CAP = 500;
const SCROLL_SETTLE_MS = 900;
const MAX_SCROLL_ROUNDS = 30;

const COLLECTION_PAGES: { hosts: string[]; pathPattern: RegExp }[] = [
  { hosts: ['myrecipes.com'], pathPattern: /^\/favorites/ },
  { hosts: ['allrecipes.com'], pathPattern: /favorites|my-saves/ },
];

/**
 * Recipe-looking links on the Dotdash network (favorites link out to source
 * sites). Shapes: /recipe/<anything> (allrecipes), /recipes/<slug> with a
 * non-numeric slug (foodandwine/simplyrecipes — numeric = category hub), and
 * <slug>-recipe / <slug>-recipe-<id> (seriouseats/eatingwell).
 */
const RECIPE_LINK_RE =
  /^https?:\/\/(www\.)?(allrecipes|eatingwell|foodandwine|simplyrecipes|seriouseats|thespruceeats|realsimple|southernliving|marthastewart|liquor|myrecipes)\.com\/(?:.*\/)?(?:recipe\/[^?]+|recipes\/(?!\d+(?:\/|$))[^/?]+\/?|[^/?]*-recipe(?:-[^/?]*)?\/?)$/i;

export function isCollectionPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return COLLECTION_PAGES.some(
    (p) =>
      p.hosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)) &&
      (p.pathPattern.test(parsed.pathname) || p.pathPattern.test(parsed.hash)),
  );
}

export function collectRecipeLinks(doc: Document): { url: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = (a.href || '').split('#')[0] ?? '';
    if (!RECIPE_LINK_RE.test(href)) continue;
    if (seen.has(href)) continue;
    const title = a.textContent?.trim().replace(/\s+/g, ' ') || titleFromSlug(href);
    seen.set(href, title.length > 120 ? `${title.slice(0, 117)}…` : title);
    if (seen.size >= IMPORT_CAP) break;
  }
  return [...seen.entries()].map(([url, title]) => ({ url, title }));
}

export function titleFromSlug(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const slug = [...segments].reverse().find((s) => /[a-z]/i.test(s) && !/^\d+$/.test(s)) ?? '';
    const words = slug
      .replace(/\d{4,}/g, ' ')
      .split(/[-_]+/)
      .filter(Boolean);
    if (words.length === 0) return url;
    return words
      .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w))
      .join(' ')
      .trim();
  } catch {
    return url;
  }
}

export function stubRecipe(url: string, title: string): ExtractedRecipe {
  return { sourceUrl: url, title, ingredients: [], instructions: [], extractionMethod: 'server' };
}

// ---------------------------------------------------------------- Banner UI

const BANNER_STYLES = `
:host { all: initial; }
.bar {
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 2147483647;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px;
  background: #1db954; color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,.25);
}
.bar strong { font-weight: 700; }
.grow { flex: 1; }
button.import {
  background: #fff; color: #128a3e; border: none; border-radius: 0;
  padding: 8px 16px; font-size: 14px; font-weight: 700; cursor: pointer;
}
button.import:disabled { opacity: .7; cursor: default; }
button.dismiss {
  background: none; border: none; color: #fff; font-size: 18px;
  cursor: pointer; padding: 4px 8px;
}
.progress { font-variant-numeric: tabular-nums; }
`;

export type ImportSaver = (recipe: ExtractedRecipe) => Promise<'saved' | 'duplicate' | 'error'>;

export class MigrationBanner {
  private host: HTMLElement;
  private message: HTMLElement;
  private importBtn: HTMLButtonElement;
  private saver: ImportSaver;
  private dismissKey = `pepper-import-dismissed:${location.hostname}`;

  constructor(saver: ImportSaver) {
    this.saver = saver;
    this.host = document.createElement('pepper-import-banner');
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BANNER_STYLES;
    shadow.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bar';
    this.message = document.createElement('span');
    this.message.innerHTML = '<strong>🌶 Pepper</strong> — import your saved recipes?';
    const grow = document.createElement('span');
    grow.className = 'grow';
    this.importBtn = document.createElement('button');
    this.importBtn.className = 'import';
    this.importBtn.textContent = 'Import all to Pepper';
    this.importBtn.addEventListener('click', () => void this.runImport());
    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.textContent = '✕';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', () => {
      sessionStorage.setItem(this.dismissKey, '1');
      this.host.remove();
    });
    bar.append(this.message, grow, this.importBtn, dismiss);
    shadow.appendChild(bar);
  }

  mount(): void {
    if (sessionStorage.getItem(this.dismissKey)) return;
    document.documentElement.appendChild(this.host);
    // The list renders client-side — refresh the count as items appear.
    const updateCount = (): void => {
      const count = collectRecipeLinks(document).length;
      if (count > 0) {
        this.message.innerHTML = `<strong>🌶 Pepper</strong> — import all <strong>${count}</strong> saved recipes?`;
      }
    };
    updateCount();
    const observer = new MutationObserver(() => updateCount());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30_000); // count settles quickly
  }

  destroy(): void {
    this.host.remove();
  }

  /** Auto-scroll until the list stops growing so lazy-loaded items render. */
  private async loadFullList(): Promise<{ url: string; title: string }[]> {
    let lastCount = -1;
    for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
      const links = collectRecipeLinks(document);
      this.message.innerHTML = `Loading your collection… <span class="progress">${links.length} found</span>`;
      if (links.length >= IMPORT_CAP || links.length === lastCount) return links;
      lastCount = links.length;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));
    }
    return collectRecipeLinks(document);
  }

  private async runImport(): Promise<void> {
    this.importBtn.disabled = true;
    const links = await this.loadFullList();
    window.scrollTo(0, 0);
    if (links.length === 0) {
      this.message.textContent = 'No saved recipes found on this page.';
      this.importBtn.disabled = false;
      return;
    }

    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    for (const [i, link] of links.entries()) {
      const result = await this.saver(stubRecipe(link.url, link.title));
      if (result === 'saved') imported++;
      else if (result === 'duplicate') duplicates++;
      else failed++;
      this.message.innerHTML = `Importing… <span class="progress">${i + 1}/${links.length}</span>`;
    }

    const parts = [`<strong>${imported}</strong> imported`];
    if (duplicates > 0) parts.push(`${duplicates} already in Pepper`);
    if (failed > 0) parts.push(`${failed} failed`);
    this.message.innerHTML = `Done — ${parts.join(', ')} 🎉`;
    this.importBtn.textContent = 'Import again';
    this.importBtn.disabled = false;
  }
}
