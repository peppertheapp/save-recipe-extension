# Pepper Recipe Importer — Chrome Extension

Puts a Pepper button on every recipe page. **Green** = recipe detected, one click saves it to your Pepper profile. **Red** = no recipe found (with a "save the link anyway" server-fallback path).

Full roadmap: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## Status

| Phase | State |
| --- | --- |
| 0 — Scaffold (Vite + CRXJS, TS strict, CI) | ✅ done |
| 1 — Detection + floating button | ✅ done |
| 2 — Extraction/normalization + fixtures | ✅ done (15 tests) |
| 3 — Save flow (client side) | ✅ done — running in **frontend-only mode** (`BACKEND_ENABLED = false` in `src/shared/config.ts`): secret code stored without verification, saves kept in `chrome.storage.local`. Flip the flag when the pepper-backend endpoints exist. |
| 4 — MyRecipes overlay | registry scaffolded in `src/content/competitor.ts`, not wired up |
| 5 — Collection migration | not started |
| 7 — Polish & ship | not started |

## Develop

```sh
npm install
npm run gen:icons   # placeholder icons until brand assets land
npm run dev         # hot-reload dev build
npm run build       # production build → dist/
npm run test        # vitest fixture suite
npm run typecheck && npm run lint
```

**Load in Chrome:** `chrome://extensions` → enable Developer mode → "Load unpacked" → select `dist/` (run `npm run build` or `npm run dev` first).

## Layout

- `src/content/detector.ts` — JSON-LD + microdata detection/extraction (pure, tested in jsdom)
- `src/content/button.ts` — Shadow-DOM floating button (drag, states, hide-per-site)
- `src/content/index.ts` — content-script entry: detection lifecycle, SPA re-detection, messaging
- `src/background/service-worker.ts` — save flow, offline retry queue (chrome.alarms), per-tab icon state
- `src/popup/` — user-id pairing, settings, save history
- `src/shared/` — types, typed API client, storage wrappers
- `tests/fixtures/` — HTML modeled on 10 real recipe sites + a negative page

## Notes

- API base URL defaults to `https://api.peppertheapp.com`; override via the `apiBaseUrl` setting in `chrome.storage.sync` for staging.
- Icons are generated placeholders — swap in real brand assets (`public/icons/`) when available.
- The fixture pages are hand-modeled on each site's real structured-data patterns (`@graph`, `HowToSection`, entity soup, microdata-only), not verbatim copies. Re-verify against live pages before ship.
