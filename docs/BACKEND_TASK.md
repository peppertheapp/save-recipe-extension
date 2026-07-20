# Backend task: REST API for the Pepper browser extension

The Chrome extension is built and shipping in **frontend-only mode** — it stores
recipes locally and never talks to a server yet. This task is to build the REST
API it already expects. The client contract is fixed; implement to it exactly and
the extension lights up with a one-line flag flip (`BACKEND_ENABLED = true` in
`src/shared/config.ts`), no client changes.

- **Base URL the extension calls:** `https://api.peppertheapp.com` (host is already
  in the extension's manifest `host_permissions`).
- **All requests/responses are JSON.** The extension sends
  `source: "chrome-extension"` and `extensionVersion` on writes — log them for
  analytics.

Detailed companion specs already in this repo:
- `docs/PAIRING.md` — QR pairing protocol (extension + app + backend)
- `docs/AI_INSTRUCTIONS.md` — the generate-instructions endpoint + a reference Lambda

---

## 1. Endpoints to build

### `GET /v1/extension/verify?userId=<token>`
Confirms a pairing/secret code is valid; the popup calls it to show "Connected as …".
- **200** `{ "valid": true, "displayName": "Jake", "avatarUrl": "https://…" }`
- **200** `{ "valid": false }` for unknown/invalid — do not 404.

### `POST /v1/extension/import`
The core save. One recipe per call (the collection-import feature also calls this
once per recipe).
```json
{
  "userId": "<token>",
  "recipe": { ...ExtractedRecipe },   // shape in src/shared/types.ts
  "source": "chrome-extension",
  "extensionVersion": "1.1.0"
}
```
Responses the client already handles:
- **201** `{ "recipeId": "...", "profileUrl": "..." }` — created
- **200** `{ "duplicate": true, "recipeId": "...", "profileUrl": "..." }` — dedupe on
  `userId` + canonical `sourceUrl`
- **202** `{ "recipeId": "..." }` — accepted for async server-side extraction (see below)
- **404** unknown user · **422** invalid payload · **429** rate-limited
- **5xx** → the extension auto-queues and retries with backoff, so transient failures are safe.

**Server-side extraction:** when `recipe.extractionMethod === "server"`, the recipe
is a stub — often just `sourceUrl` + `title` (social posts, gated sites, and
"ingredients but no steps" saves). The backend should fetch/extract the full recipe,
and for the missing-steps case call the generate endpoint below. Return 202 if you
process async.

### `POST /v1/extension/generate-instructions`
Generate cooking steps from a dish name + ingredients (steps were only in the video).
Full spec + reference Lambda in `docs/AI_INSTRUCTIONS.md`. Model: **`claude-haiku-4-5`**.
Key point: **the Anthropic API key lives here, never in the extension.**
```json
// request
{ "title": "...", "ingredients": ["...", "..."], "sourceUrl": "...", "source": "chrome-extension" }
// response
{ "instructions": ["step 1", "step 2", "..."] }
```

### `GET /v1/extension/pair/status?code=<pairing-code>`  and  `POST /v1/extension/pair/claim`
The QR-pairing pair. Full protocol (TTL, single-use, anti-probing) in `docs/PAIRING.md`.
- App (authenticated) claims a scanned code: `POST /v1/extension/pair/claim { "code": "..." }` → 204.
- Extension polls: `GET /v1/extension/pair/status?code=...` →
  `{ "linked": false }` until claimed, then `{ "linked": true, "userId": "<token>", "displayName": "Jake" }`.

---

## 2. Authentication

The extension holds a single opaque string (call it the **token**) and sends it as
`userId` on `verify` and `import`. It never sees or stores anything else, so the
backend fully controls what that string is and how it's authenticated.

**Recommended (v2 — the client already supports it):** issue a real credential from
pairing.
1. User opens the Pepper app → Settings → Connect browser extension → scans the QR.
2. App calls `pair/claim` with the code **using the user's normal authenticated session**.
3. Backend mints a **random, opaque, per-device token** (e.g. `pxt_…`, ≥128 bits),
   stores it **hashed** mapped to the account, and returns it from `pair/status` in
   the `userId` field.
4. Every `import`/`verify` authenticates by hashing the incoming `userId` and looking
   up the account. Unknown/revoked → 404.

Why this shape: the token is **revocable** (per device, from the app), **not
guessable**, and **never derived from the account id**. Because the extension treats
the value as opaque, you get all of this with zero extension changes.

**Fallback (v1 — manual secret code):** the popup also accepts a pasted "secret code".
Treat that code as the token too — same lookup path. If you support it, make the
codes **long and random (not sequential)** so they can't be guessed, and surface them
in the app under Settings → Connect browser extension.

**Required regardless of path:**
- **Rate-limit per token** (the plan's target: ~60 saves/hour/token) and per IP on the
  unauthenticated `pair/status` poll.
- **Dedupe** on `userId` + canonical `sourceUrl` so retries never double-post.
- **Never put the token in a URL you log** beyond the `verify`/`pair/status` query
  (fine to log at debug only); prefer it in the body for `import` (already the case).
- Serve everything over **HTTPS**, CORS-allow the extension origin
  (`chrome-extension://<id>`), and validate/limit payload sizes.

Do **not** use OAuth redirect flows or ask the extension to store a password — the
pairing-token model above is the whole auth story.

---

## 3. Definition of done

- [ ] All five endpoints live at `https://api.peppertheapp.com` with the exact
      shapes above.
- [ ] Pairing issues a hashed, revocable per-device token; `import`/`verify`
      authenticate against it; unknown tokens 404.
- [ ] `import` dedupes and rate-limits; `extractionMethod: "server"` recipes get
      fetched/extracted (and step-generated where needed).
- [ ] `generate-instructions` calls Claude Haiku 4.5 with the key held server-side.
- [ ] Recipes created via the extension are tagged `source: chrome-extension`.
- [ ] Confirm with a real save from the extension after flipping
      `BACKEND_ENABLED = true` — recipe appears in the user's Pepper collection in <2s.

Open items for us (extension side), from the original build plan:
- Confirm Pepper's canonical Recipe model so `ExtractedRecipe` maps 1:1.
- Confirm the app's "Connect browser extension" screen shows the code + QR scanner.
