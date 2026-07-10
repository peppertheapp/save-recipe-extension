# QR pairing protocol (extension ↔ app ↔ backend)

The extension popup shows a QR code. The user scans it with the Pepper app's
camera; the app claims the code against the backend; the extension polls until
the code is linked, then stores the account. Replaces raw secret-code entry as
the primary auth (manual entry stays as fallback).

## QR contents

```
https://peppertheapp.com/pair#v=1&code=<pairing-code>
```

- Universal link: phone cameras open the Pepper app directly (register the
  `/pair` route as a universal link / app link). The page at that URL should
  say "Open the Pepper app to finish connecting" for users without the app.
- The code rides in the **fragment** so it never appears in server logs.
- `pairing-code`: 20 chars from an unambiguous alphabet (no 0/O/1/l/I),
  ~117 bits of entropy, generated client-side by the extension
  (`src/shared/pairing.ts`). Rotated every 4 minutes while the popup is open.

## Endpoints to build (pepper-backend)

### `POST /v1/extension/pair/claim`  (called by the app, authenticated)
```json
{ "code": "<pairing-code>" }
```
The app sends this with the user's normal auth after scanning. Backend stores
`code → {userId, claimedAt}`.
Responses: `204` claimed · `409` code already claimed · `422` malformed code.

### `GET /v1/extension/pair/status?code=...`  (polled by the extension, unauthenticated)
- Not yet claimed → `200 {"linked": false}`
- Claimed → `200 {"linked": true, "userId": "usr_abc123", "displayName": "Jake"}`
  and **invalidate the code** (single use — the first successful status read
  consumes it).

## Server-side rules

- Codes are **not persisted until claimed** — the claim creates the record.
  Unknown code on status → `{"linked": false}` (no distinction from unclaimed,
  prevents probing).
- TTL: reject claims for codes older than 5 minutes? The backend never saw the
  code creation, so enforce TTL from `claimedAt` instead: status reads more
  than 60s after the claim return `{"linked": false}` and delete the record.
- Rate limit status polling per IP (the extension polls every 2s per popup
  open) and claims per user.
- When v2 lands, return a **scoped token** instead of the raw userId and
  accept it in the `import` endpoints — the extension already treats the
  stored value as opaque.

## Extension side (already built)

- `src/shared/pairing.ts` — code generation, QR URL, status polling
  (inert while `BACKEND_ENABLED` is false in `src/shared/config.ts`).
- `src/popup/popup.ts` — renders the QR (qrcode-with-logos, chili badge,
  error-correction H; uqr SVG fallback), rotates every 4 min, polls every 2s,
  stores the account on link.

## App side (to build)

- Settings → "Connect browser extension" → camera scanner.
- Handle the `/pair` universal link with `#v=1&code=...` → confirm screen
  ("Connect this browser to your Pepper account?") → `POST pair/claim`.
- Show success state; the browser popup updates by itself within 2s.
