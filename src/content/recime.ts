/**
 * Phase 6 — ReciMe collection import ("Switch to Pepper", ReciMe edition).
 *
 * ReciMe (recime.app) is a recipe app, not a website: a user's recipes live in
 * ReciMe's own database with no public per-recipe URL and no export button. But
 * the web dashboard fetches them from api.recime.app using the Firebase login
 * token the page already holds. On the user's dashboard we surface a banner that
 * — only on explicit click — reads that token, lists the user's own recipes, and
 * pulls each one's FULL content (title, ingredients, steps, times, source link)
 * to save into Pepper. No credentials are handled; the token is read from the
 * page's own IndexedDB and used only against ReciMe's API.
 *
 * API contract (captured 2026-07-28, see docs/RECIME_IMPORT.md):
 *   GET /v5/cookbooks?sort=latest → [{ id, title, posts: [postId...] }]
 *   GET /v1/posts?id=<postId>     → full recipe (ingredients[].rawText,
 *                                   instructions[].text, recipeUrls[], ...)
 * Auth: Authorization: Bearer <firebase idToken>. No cookies (their ACAO is *).
 */

import type { ExtractedRecipe } from '../shared/types';

const RECIME_API = 'https://api.recime.app';
const IMPORT_CAP = 1000;

export function isRecimeCollectionPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  const onRecime = host === 'recime.app' || host.endsWith('.recime.app');
  return onRecime && parsed.pathname.startsWith('/dashboard');
}

// ---------------------------------------------------------------- auth token

/**
 * The Firebase Web SDK persists the signed-in user (incl. the id token) in
 * IndexedDB `firebaseLocalStorageDb` → store `firebaseLocalStorage`. A content
 * script shares the page's origin, so it can read it. Returns null when signed
 * out or the shape changed — callers surface a "log in" message rather than fail.
 */
export function getRecimeToken(): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const open = indexedDB.open('firebaseLocalStorageDb');
      open.onsuccess = () => {
        try {
          const db = open.result;
          const tx = db.transaction('firebaseLocalStorage', 'readonly');
          const req = tx.objectStore('firebaseLocalStorage').getAll();
          req.onsuccess = () => {
            const rows = (req.result ?? []) as { value?: RecimeAuthValue }[];
            const token = rows
              .map((r) => r.value?.stsTokenManager?.accessToken)
              .find((t): t is string => typeof t === 'string' && t.length > 0);
            done(token ?? null);
          };
          req.onerror = () => done(null);
        } catch {
          done(null);
        }
      };
      open.onerror = () => done(null);
    } catch {
      done(null);
    }
    // Never hang the banner if IndexedDB stalls.
    setTimeout(() => done(null), 4000);
  });
}

interface RecimeAuthValue {
  stsTokenManager?: { accessToken?: string };
}

// ---------------------------------------------------------------- API shapes

interface RecimeCookbook {
  id: string;
  title?: string;
  posts?: string[];
}

interface RecimeIngredient {
  position?: number;
  rawText?: string;
  product?: string;
  qtyDisplay?: string;
  unitDisplay?: string;
  preparationNotes?: string;
}

interface RecimeInstruction {
  position?: number;
  text?: string;
}

interface RecimePost {
  id: string;
  title?: string;
  description?: string | null;
  imageUrl?: string | null;
  servingSize?: number | null;
  prepTime?: number | null;
  cookTime?: number | null;
  totalTime?: number | null;
  cuisine?: string | null;
  tags?: string[];
  ingredients?: RecimeIngredient[];
  instructions?: RecimeInstruction[];
  recipeUrls?: string[];
  sourceUrl?: string | null;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(RECIME_API + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ReciMe ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Every recipe id the user owns, unioned across all their cookbooks. */
export async function listRecipeIds(token: string): Promise<string[]> {
  const cookbooks = await apiGet<RecimeCookbook[]>('/v5/cookbooks?sort=latest', token);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const cb of cookbooks ?? []) {
    for (const id of cb.posts ?? []) {
      if (typeof id === 'string' && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
        if (ids.length >= IMPORT_CAP) return ids;
      }
    }
  }
  return ids;
}

export async function fetchRecimeRecipe(token: string, id: string): Promise<ExtractedRecipe> {
  const post = await apiGet<RecimePost>(`/v1/posts?id=${encodeURIComponent(id)}`, token);
  return mapRecimeRecipe(post, id);
}

/** One ReciMe ingredient → a single human-readable line. */
function ingredientLine(ing: RecimeIngredient): string {
  const raw = ing.rawText?.trim();
  if (raw) return raw;
  // Compose from parsed parts when rawText is missing.
  const parts = [ing.qtyDisplay, ing.unitDisplay, ing.product, ing.preparationNotes]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const byPosition = (a: { position?: number }, b: { position?: number }): number =>
  (a.position ?? 0) - (b.position ?? 0);

export function mapRecimeRecipe(post: RecimePost, fallbackId?: string): ExtractedRecipe {
  const id = post.id || fallbackId || '';
  const ingredients = (post.ingredients ?? [])
    .slice()
    .sort(byPosition)
    .map(ingredientLine)
    .filter(Boolean);
  const instructions = (post.instructions ?? [])
    .slice()
    .sort(byPosition)
    .map((s) => (s.text ?? '').trim())
    .filter(Boolean);

  // Prefer the original source link (dedupes against a normal web save of the
  // same recipe); fall back to the ReciMe recipe page so the key is stable.
  const sourceUrl =
    post.recipeUrls?.find((u) => typeof u === 'string' && /^https?:\/\//.test(u))?.trim() ||
    post.sourceUrl?.trim() ||
    `https://www.recime.app/dashboard/recipes/${id}`;

  const recipe: ExtractedRecipe = {
    sourceUrl,
    title: post.title?.trim() || 'Untitled recipe',
    ingredients,
    instructions,
    extractionMethod: 'recime',
  };
  if (post.description?.trim()) recipe.description = post.description.trim();
  if (post.imageUrl?.trim()) recipe.imageUrl = post.imageUrl.trim();
  if (typeof post.servingSize === 'number' && post.servingSize > 0) {
    recipe.yield = String(post.servingSize);
  }
  if (typeof post.prepTime === 'number' && post.prepTime > 0) recipe.prepTimeMinutes = post.prepTime;
  if (typeof post.cookTime === 'number' && post.cookTime > 0) recipe.cookTimeMinutes = post.cookTime;
  if (typeof post.totalTime === 'number' && post.totalTime > 0) {
    recipe.totalTimeMinutes = post.totalTime;
  }
  if (post.cuisine?.trim()) recipe.cuisine = [post.cuisine.trim()];
  if (post.tags?.length) recipe.keywords = post.tags.filter((t) => typeof t === 'string');
  return recipe;
}

// ---------------------------------------------------------------- Banner UI

const BANNER_STYLES = `
:host { all: initial; }
.bar {
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 2147483647;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px;
  background: #ff5f50; color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,.25);
}
.bar strong { font-weight: 700; }
.grow { flex: 1; }
button.import {
  background: #fff; color: #e0402f; border: none; border-radius: 8px;
  padding: 8px 16px; font-size: 14px; font-weight: 700; cursor: pointer;
}
button.import:disabled { opacity: .7; cursor: default; }
button.dismiss {
  background: none; border: none; color: #fff; font-size: 18px;
  cursor: pointer; padding: 4px 8px;
}
.progress { font-variant-numeric: tabular-nums; }
`;

export type RecimeImportSaver = (
  recipe: ExtractedRecipe,
) => Promise<'saved' | 'duplicate' | 'error'>;

interface ConnectionCheck {
  connected: boolean;
}

export class RecimeImportBanner {
  private host: HTMLElement;
  private message: HTMLElement;
  private importBtn: HTMLButtonElement;
  private saver: RecimeImportSaver;
  private checkConnected: () => Promise<ConnectionCheck>;
  private dismissKey = 'pepper-recime-import-dismissed';
  private running = false;

  constructor(saver: RecimeImportSaver, checkConnected: () => Promise<ConnectionCheck>) {
    this.saver = saver;
    this.checkConnected = checkConnected;
    this.host = document.createElement('pepper-recime-banner');
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BANNER_STYLES;
    shadow.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bar';
    this.message = document.createElement('span');
    this.message.innerHTML = '<strong>🌶 Pepper</strong> — checking your ReciMe recipes…';
    const grow = document.createElement('span');
    grow.className = 'grow';
    this.importBtn = document.createElement('button');
    this.importBtn.className = 'import';
    this.importBtn.textContent = 'Import all to Pepper';
    this.importBtn.style.display = 'none';
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
    void this.showCount();
  }

  destroy(): void {
    this.host.remove();
  }

  private cachedIds: string[] | null = null;

  private async showCount(): Promise<void> {
    const token = await getRecimeToken();
    if (!token) {
      this.message.innerHTML =
        '<strong>🌶 Pepper</strong> — log in to ReciMe to import your recipes.';
      return;
    }
    try {
      const ids = await listRecipeIds(token);
      this.cachedIds = ids;
      if (ids.length === 0) {
        this.message.innerHTML = '<strong>🌶 Pepper</strong> — no ReciMe recipes found to import.';
        return;
      }
      const noun = ids.length === 1 ? 'recipe' : 'recipes';
      this.message.innerHTML = `<strong>🌶 Pepper</strong> — import all <strong>${ids.length}</strong> ReciMe ${noun}?`;
      this.importBtn.style.display = '';
    } catch {
      this.message.innerHTML =
        '<strong>🌶 Pepper</strong> — couldn’t read your ReciMe recipes. Reload and try again.';
    }
  }

  private async runImport(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.importBtn.disabled = true;

    const { connected } = await this.checkConnected();
    if (!connected) {
      this.message.textContent =
        'Connect Pepper first: click the Pepper toolbar icon, enter your secret code, then try again.';
      this.importBtn.disabled = false;
      this.running = false;
      return;
    }

    const token = await getRecimeToken();
    if (!token) {
      this.message.textContent = 'Please log in to ReciMe, then try again.';
      this.importBtn.disabled = false;
      this.running = false;
      return;
    }

    let ids: string[];
    try {
      ids = this.cachedIds ?? (await listRecipeIds(token));
    } catch {
      this.message.textContent = 'Couldn’t list your ReciMe recipes. Reload and try again.';
      this.importBtn.disabled = false;
      this.running = false;
      return;
    }
    if (ids.length === 0) {
      this.message.textContent = 'No ReciMe recipes found to import.';
      this.importBtn.disabled = false;
      this.running = false;
      return;
    }

    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    for (const [i, id] of ids.entries()) {
      this.message.innerHTML = `Importing… <span class="progress">${i + 1}/${ids.length}</span>`;
      try {
        const recipe = await fetchRecimeRecipe(token, id);
        const result = await this.saver(recipe);
        if (result === 'saved') imported++;
        else if (result === 'duplicate') duplicates++;
        else failed++;
      } catch {
        failed++;
      }
    }

    const parts = [`<strong>${imported}</strong> imported`];
    if (duplicates > 0) parts.push(`${duplicates} already in Pepper`);
    if (failed > 0) parts.push(`${failed} failed`);
    this.message.innerHTML = `Done — ${parts.join(', ')} 🎉 Open the Pepper popup to see them.`;
    this.importBtn.textContent = 'Import again';
    this.importBtn.disabled = false;
    this.running = false;
  }
}
