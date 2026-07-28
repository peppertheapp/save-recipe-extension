# ReciMe collection import

ReciMe (recime.app) is a recipe app, not a website: a user's recipes live in
ReciMe's database with no public per-recipe URL and no export button. Pepper
imports them straight from ReciMe's own API, reusing the login the user already
has in their browser. Implemented in [`src/content/recime.ts`](../src/content/recime.ts);
surfaced as an "Import all to Pepper" banner on the ReciMe dashboard.

## How it works

1. Content script runs on `*.recime.app/dashboard/*` (top frame only).
2. It reads the Firebase **id token** the ReciMe web app stores in the page's
   IndexedDB: `firebaseLocalStorageDb` → store `firebaseLocalStorage` →
   `.value.stsTokenManager.accessToken`. Same origin, so the content script can
   read it. No password or credential is ever entered or handled by Pepper.
3. On explicit click, it calls ReciMe's API with `Authorization: Bearer <token>`.

## API contract (captured 2026-07-28 from the logged-in dashboard)

- Host: `https://api.recime.app`
- Auth: `Authorization: Bearer <firebase idToken>`. **No cookies** — sending
  `credentials:'include'` fails CORS because ReciMe's `Access-Control-Allow-Origin`
  is `*`. (The extension also lists `https://api.recime.app/*` in `host_permissions`
  so the fetch is extension-privileged and CORS-exempt regardless.)
- `GET /v5/cookbooks?sort=latest` →
  `[{ id, title, type, posts: [postId...], creator }]`. Union every `posts`
  array (deduped) to get all of the user's recipe ids.
- `GET /v1/posts?id=<postId>` → full recipe:
  - `title`, `description`, `servingSize`, `prepTime`, `cookTime`, `totalTime`,
    `cuisine`, `tags[]`
  - `ingredients[]` — each has `rawText` (human line) plus parsed
    `product/quantity/unit/preparationNotes/position`
  - `instructions[]` — each `{ position, text }`
  - `recipeUrls[]` — original source link(s); `imageUrl` is often null
- `GET /v1/posts/thumbnail?id=<postId>` → thumbnail image (not currently used).

## Mapping to Pepper

`mapRecimeRecipe()` turns a post into an `ExtractedRecipe`:
`rawText` → ingredient lines (sorted by `position`), `instructions[].text` →
steps, `recipeUrls[0]` → `sourceUrl` (falls back to the ReciMe recipe page so the
dedupe key is stable), plus servings/times/cuisine/tags. `extractionMethod` is
`'recime'`.

## Where imported recipes land

Each recipe is saved through the normal `SAVE_RECIPE` path. In frontend-only mode
(`BACKEND_ENABLED = false`) that stores the full recipe in `chrome.storage.local`,
deduped by URL and visible in the popup's Recent saves — so import works today
with no backend, and the same records sync once the backend ships.
