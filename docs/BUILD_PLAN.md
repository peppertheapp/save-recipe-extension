# Pepper Recipe Importer — Chrome Extension Build Plan

**Goal:** A Chrome extension that puts a Pepper button on every recipe page. Green = recipe detected, one click sends it to your Pepper profile. Red = no recipe found. On MyRecipes-network sites (AllRecipes, etc.), our button overlays theirs.

This document is written to be handed directly to Claude Code. Work top-to-bottom; each phase is independently shippable.

---

## Architecture

```
┌─────────────────────────── Chrome Extension (Manifest V3) ───────────────────────────┐
│                                                                                       │
│  content script (all pages)          service worker              popup                │
│  • detect recipe (JSON-LD/microdata) • API calls to Pepper       • enter user-id      │
│  • inject floating Pepper button     • badge state               • settings/toggles   │
│  • MyRecipes overlay logic           • retry queue               • save history       │
│                                                                                       │
└───────────────────────────────────────┬───────────────────────────────────────────────┘
                                        │ HTTPS
                          ┌─────────────▼──────────────┐
                          │  Pepper API (AWS)          │
                          │  API Gateway + Lambda      │
                          │  POST /v1/extension/import │
                          │  GET  /v1/extension/verify │
                          └────────────────────────────┘
```

**Repo layout** (monorepo or two repos — adapt to what exists):

```
pepper-extension/
├── manifest.json
├── src/
│   ├── content/
│   │   ├── detector.ts        # recipe detection + extraction
│   │   ├── button.ts          # floating button UI (Shadow DOM)
│   │   └── competitor.ts      # MyRecipes overlay module
│   ├── background/
│   │   └── service-worker.ts  # API client, retry queue, badge
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.ts
│   └── shared/
│       ├── api.ts             # typed Pepper API client
│       ├── types.ts           # Recipe, SaveResult, Settings
│       └── storage.ts         # chrome.storage wrapper
├── public/icons/              # 16/32/48/128 px, red + green variants
├── vite.config.ts             # CRXJS or vite-plugin-web-extension
└── e2e/                       # Playwright tests against fixture pages

pepper-backend/ (existing AWS repo — new additions only)
└── extension-import/          # Lambda: import + verify endpoints
```

**Stack:** TypeScript, Vite + CRXJS, no UI framework in content script (vanilla + Shadow DOM to avoid CSS collisions), Manifest V3.

---

## Phase 0 — Scaffold (half day)

- [ ] Init repo with Vite + CRXJS, TypeScript strict, ESLint/Prettier.
- [ ] `manifest.json` (MV3):
  - `content_scripts`: `<all_urls>`, `run_at: document_idle`
  - `permissions`: `storage`, `activeTab`
  - `host_permissions`: Pepper API domain only
  - `action` popup
- [ ] Hot-reload dev flow working (`npm run dev`, load unpacked).
- [ ] CI: typecheck + lint + build on push.

**Acceptance:** extension loads, content script logs on any page, popup opens.

---

## Phase 1 — Recipe detection + button (1–2 days)

### Detection (`detector.ts`)
Run in order, stop at first hit:
1. **JSON-LD:** every `<script type="application/ld+json">`, parse (tolerate arrays, `@graph`, single objects), find `@type` of `Recipe` (or array containing it). This covers ~90% of recipe sites since Google requires it for rich results.
2. **Microdata:** `[itemtype*="schema.org/Recipe"]`.
3. **SPA support:** re-run on `MutationObserver` (debounced 500ms) and on History API navigation (`pushState`/`replaceState` patch or `navigation` API) — critical for AllRecipes-style SPAs.

### Button (`button.ts`)
- [ ] Floating button, fixed position (default bottom-right), rendered inside a **Shadow DOM** host element so site CSS can't touch it.
- [ ] States:
  - **Green** — recipe detected: Pepper logo, "Save to Pepper" on hover.
  - **Red** — no recipe: dimmed, click opens tooltip "No recipe found on this page — save the link anyway?" (feeds Phase 2 server fallback).
  - **Spinner** → **✓ Saved** (2s) → green, on click.
  - **Error** — shake + tooltip with reason.
- [ ] Draggable; position persisted in `chrome.storage.sync`.
- [ ] Hide-on-this-site option (right-click menu on button).
- [ ] Also mirror state to the toolbar icon badge (green dot / nothing).

**Acceptance:** green on allrecipes.com, seriouseats.com, nytimes.com/cooking recipe pages; red on google.com. Survives SPA navigation.

---

## Phase 2 — Extraction + normalization (1–2 days)

- [ ] Map schema.org Recipe → Pepper `Recipe` type:

```ts
interface ExtractedRecipe {
  sourceUrl: string;
  title: string;
  description?: string;
  imageUrl?: string;          // largest from image/thumbnailUrl
  author?: string;
  yield?: string;
  prepTimeMinutes?: number;   // parse ISO-8601 durations (PT1H30M)
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  ingredients: string[];      // recipeIngredient
  instructions: string[];     // recipeInstructions: strings | HowToStep | HowToSection (flatten)
  cuisine?: string[];
  category?: string[];
  keywords?: string[];
  nutrition?: Record<string, string>;
  ratingValue?: number;
  ratingCount?: number;
  extractionMethod: 'json-ld' | 'microdata' | 'server';
}
```

- [ ] Handle the messy real world: HTML entities in strings, `HowToSection` nesting, `image` as string/array/ImageObject, missing instructions.
- [ ] **Server fallback:** if no structured data but the red-button "save anyway" is clicked, POST just the URL with `extractionMethod: 'server'`; backend fetches + extracts (see Phase 3).
- [ ] Unit tests with fixture HTML from 10 real sites (allrecipes, seriouseats, budgetbytes, bonappetit, food.com, smittenkitchen, king arthur, delish, tasty, a random Wordpress recipe-card blog).

**Acceptance:** fixtures all extract with correct ingredient/instruction counts.

---

## Phase 3 — Pepper backend endpoint + save flow (2–3 days)

### New AWS endpoints (API Gateway + Lambda)

**`POST /v1/extension/import`**
```json
{
  "userId": "usr_abc123",
  "recipe": { ...ExtractedRecipe },
  "source": "chrome-extension",
  "extensionVersion": "1.0.0"
}
```
Responses: `201 {recipeId, profileUrl}` · `200 {duplicate: true, recipeId}` (dedupe on `userId + canonical sourceUrl`) · `404` unknown user · `422` invalid payload · `429` rate-limited.

**`GET /v1/extension/verify?userId=...`** → `{valid: true, displayName, avatarUrl}` — used by popup to confirm the pairing and show "Connected as Jake ✓".

**Server-side extraction** (fallback path): if `recipe` contains only `sourceUrl`, Lambda fetches the page, runs the same JSON-LD parse server-side, and optionally an LLM extraction pass (Bedrock) if that fails. Return `202 {status: 'processing'}` if async.

Implementation notes for Claude Code:
- Follow existing patterns in the pepper-backend repo (routing, models, validation). Ask for the repo path if not provided.
- Rate limit: 60 saves/hour/userId (API Gateway usage plan or in-Lambda).
- Log `source: chrome-extension` on created recipes for analytics.

### Auth: user-id pairing (v1 decision)
- [ ] Popup: input field for Pepper user-id + "Connect" → calls `verify`, stores in `chrome.storage.sync`, shows connected profile.
- [ ] Surface the user-id somewhere findable in the Pepper app (Settings → "Connect browser extension").

> ⚠️ **Accepted risk (revisit before scale):** a raw user-id is not a secret — anyone who knows/guesses it can write recipes to that profile. Mitigations for v1: rate limiting, dedupe, make IDs long/random (not sequential), and an in-app activity feed so junk saves are visible/deletable. **v2 upgrade path is already designed:** swap the `userId` field for a token from a one-time pairing code with zero changes to the extension architecture. Do not build marketing around "secure" until then.

### Save flow
- [ ] Click → content script sends recipe to service worker → POST import → button state updates.
- [ ] Offline/failed saves queue in `chrome.storage.local`, retry with backoff.
- [ ] Duplicate response → button shows "Already saved ✓" with link to the recipe in Pepper.

**Acceptance:** end-to-end save from allrecipes.com appears on Pepper profile in <2s.

---

## Phase 4 — Competitor module: MyRecipes overlay (1–2 days)

**Setting: "Replace MyRecipes save buttons" — default ON, listed in popup settings, disclosed in the Chrome Web Store listing** ("On supported sites, Pepper replaces the site's save button with its own"). That disclosure is what keeps this on the right side of CWS's deceptive-behavior policy.

- [ ] `competitor.ts` with a **selector registry** (data-driven, updatable without full release via a remote JSON fetched daily and cached):

```ts
const COMPETITOR_TARGETS = [
  {
    domains: ['allrecipes.com', 'eatingwell.com', 'foodandwine.com',
              'simplyrecipes.com', 'seriouseats.com', 'thespruceeats.com',
              'realsimple.com', 'southernliving.com', 'marthastewart.com'],
    // Verify actual selectors on live sites at build time — these WILL change
    selectors: ['[class*="save-button"]', 'button[data-tracking*="save"]'],
    strategy: 'overlay'
  }
];
```

- [ ] **Overlay strategy:** for each matched element, position a Pepper save button exactly over it (`getBoundingClientRect` + absolutely-positioned Shadow DOM element, `z-index` max, tracked on scroll/resize via `ResizeObserver`). Their button stays in the DOM (we never remove/modify their nodes — lower legal surface than deletion); ours sits on top and captures the click, saving to Pepper.
- [ ] Button matches Pepper branding — it must be **obviously Pepper**, not a mimic of their button. Mimicry is what turns "aggressive" into "deceptive."
- [ ] MutationObserver re-scan for lazy-rendered buttons (their save buttons render late).
- [ ] Fallback: if selector matches nothing (site update), floating button from Phase 1 still works — never a broken experience.
- [ ] E2E test per domain in the registry.

### Risk register (read before shipping this phase)
- **CWS takedown** is the realistic risk, not a lawsuit. Mitigation: disclosure in listing + user toggle (done), respond fast to any CWS email.
- Dotdash Meredith (MyRecipes' parent) may complain to Google. Keep the remote selector registry so if a domain must be dropped, it's a config change, not a release.
- Never intercept their button's own handler, never mimic their visual design, never touch their analytics calls. Sitting on top with our own clearly-branded button ≈ what ad blockers and coupon extensions do; impersonating them is a different category.

---

## Phase 5 — One-click collection migration ("Switch to Pepper") (2–3 days)

Convert MyRecipes power users by importing their entire saved collection in one click. User-consented portability of their own data — high value, low risk.

- [ ] `migration.ts`: detect competitor saved-recipes pages via URL patterns in the remote registry (e.g. `allrecipes.com/account/*favorites*`, plus per-domain equivalents — verify live URLs at build time).
- [ ] Inject a Pepper banner at top of the page: *"Import all 47 saved recipes to Pepper?"* (count parsed from their list). Clearly Pepper-branded, dismissible, remembers dismissal per site.
- [ ] On confirm, walk the user's own logged-in DOM: collect recipe URLs from the saved list, handle pagination/infinite scroll (auto-scroll + MutationObserver until list stops growing, cap at 500).
- [ ] Import via **`POST /v1/extension/import/batch`** (new Lambda): accepts `{userId, urls: string[]}`, dedupes, fetches + extracts each server-side (reuse Phase 3 fallback extractor), processes async via SQS, returns `{jobId}`.
- [ ] **`GET /v1/extension/import/batch/{jobId}`** → `{done, total, failed[]}`; extension polls and shows a progress bar in the banner ("31/47 imported"), then "Done — view your collection on Pepper".
- [ ] Throttle server-side fetches (be a polite scraper: 1–2 req/s, real UA, respect robots-blocked pages by falling back to saving URL-only stubs the user can open later).
- [ ] Popup also gets an "Import from other apps" entry linking to instructions ("open your saved recipes page and we'll take it from there").
- [ ] E2E test with a fixture saved-list page including pagination.

Boundaries: only ever read the list the logged-in user can see on their own screen, only on explicit click. No credential handling, no background scraping, no other users' data.

**Acceptance:** from a fixture AllRecipes favorites page with 60 items across 3 pages, one click imports all 60 to the Pepper profile with visible progress.

---

## Phase 6 — Growth/adversarial ideas (backlog, in rough order of value/risk)

1. **Popup/paywall suppression:** hide MyRecipes-network email-capture and app-install interstitials on recipe pages ("Pepper cleans up recipe sites"). Users love it; same category as ad blocking.
2. **Google SERP badges:** annotate recipe results on Google with a small pepper icon — save to Pepper directly from search results without visiting the site.
3. **Social capture:** detect recipe content on Pinterest pins, TikTok/IG captions ("recipe in caption") and offer save-to-Pepper; server-side LLM extraction handles unstructured text.
4. **"Better on Pepper" bar:** on competitor recipe pages, slim banner: "3 of your friends saved this on Pepper" (needs social graph data — later).
5. **Cook mode everywhere:** on any recipe page, a Pepper "cook mode" button that opens the extracted recipe in a clean, wake-locked overlay — makes the extension valuable even before saving.

**Ideas to reject** (crossing into deception/CFAA territory): auto-clicking or suppressing their handlers, scraping other users' data, styling our button to look like theirs, injecting content into their emails/accounts.

---

## Phase 7 — Polish & ship (1–2 days)

- [ ] Options page: toggles (competitor overlay, per-site disable list, button position), connected account, save history (last 20).
- [ ] Onboarding: first-install tab explaining connection + a demo recipe page.
- [ ] Icons/assets, store listing copy **with the replacement-behavior disclosure**.
- [ ] Privacy policy (required for CWS): extension reads page content only to detect recipes; sends recipe data + user-id to Pepper only on click; no browsing history collected.
- [ ] Analytics events (save_success, save_fail, overlay_shown, overlay_click) → Pepper backend.
- [ ] Chrome Web Store submission. (Firefox/Safari ports: backlog — MV3 code mostly carries over to Firefox.)

---

## Verification checklist (Claude Code: run before calling any phase done)

- `npm run typecheck && npm run lint && npm run test` green.
- Extraction fixtures pass for all 10 sites.
- Manual: load unpacked → allrecipes.com → green button → click → recipe on Pepper profile → duplicate click → "Already saved".
- Overlay: their save button not visible/clickable on allrecipes.com; toggle off in settings restores it instantly.
- Red-button path: non-recipe page → red → "save anyway" → server fallback response handled.
- Kill the network → save → queued → restore network → retries and succeeds.
- Migration: fixture favorites page (60 items, 3 pages) → one click → 60 recipes on profile, progress bar accurate, failed URLs reported.

## Open items for Jake
1. Provide pepper-backend repo access/path so Claude Code can build the Lambda endpoints in-pattern.
2. Confirm Pepper's canonical Recipe model so the `ExtractedRecipe` mapping matches.
3. Are user-ids currently guessable/sequential? If yes, fix that before launch (it's the whole auth story).
4. Brand assets: logo SVG, exact green/red hex values.
