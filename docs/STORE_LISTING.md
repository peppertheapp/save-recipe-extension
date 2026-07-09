# Chrome Web Store submission kit

Everything to paste into the [developer console](https://chrome.google.com/webstore/devconsole)
when submitting. Keep this in sync with what's actually submitted.

## Upload artifact

`npm run zip` → `pepper-extension.zip` (production build, sourcemaps stripped).

## Store listing

**Name:** Pepper Recipe Importer

**Summary (132 chars max):**
> Save any recipe to your Pepper profile in one click. Pepper spots recipes on any site and saves them with one tap.

**Description:**
> Pepper puts a save button on every recipe page on the internet.
>
> When you land on a page with a recipe, the Pepper button turns green — one
> click saves the full recipe (ingredients, steps, photo, times) to your
> Pepper collection. No copy-pasting, no screenshots, no losing that one
> pasta recipe you swear you saved somewhere.
>
> • Works on virtually every recipe site — AllRecipes, Serious Eats, NYT
>   Cooking, Budget Bytes, and any blog with a standard recipe card
> • One-click save, automatic duplicate detection
> • Recipe not detected? Save the link anyway and Pepper keeps it for you
> • Drag the button anywhere you like
>
> Connect the extension with the secret code from your Pepper app
> (Settings → Connect browser extension) and start collecting.

**Category:** Food & Drink (fallback: Productivity → Tools)

**Language:** English

### Assets needed (not in repo yet)
- [ ] Screenshots: at least 1, ideally 4–5, 1280×800 (green button on a recipe
      page, save animation, popup with history, red/save-anyway state)
- [ ] Small promo tile 440×280 (optional but recommended)
- [ ] Real brand icons to replace the generated placeholders in `public/icons/`

## Privacy practices tab

**Single purpose:**
> Detects recipes on web pages the user visits and, on the user's click,
> saves them to the user's Pepper account.

**Permission justifications:**
- `storage` — stores the user's pairing code, the floating button's position,
  and the user's saved recipes/history.
- `alarms` — retries failed saves in the background (offline queue).
- Host permission `https://api.peppertheapp.com/*` — the only server the
  extension talks to; receives a recipe when the user clicks save and
  verifies the user's pairing code.
- Content script on all sites (`<all_urls>`) — recipes live on any domain, so
  the extension checks each page's embedded recipe metadata (schema.org
  JSON-LD/microdata) locally to decide whether to show the green save button.
  Page content is read locally only; nothing leaves the browser until the
  user clicks save, and then only the extracted recipe is sent.

**Remote code:** none. All code is packaged in the extension.

**Data usage disclosures (check in console):**
- Collects: "Website content" (the recipe the user chooses to save) — sent to
  Pepper, tied to the user's Pepper account, used only to provide the service.
- Does NOT collect: browsing history, location, financial/health/personal
  communications, etc. (leave unchecked).
- Not sold to third parties; not used for unrelated purposes; not for
  creditworthiness. (Certify all three.)

**Privacy policy URL:** host the policy below somewhere stable, e.g.
`https://peppertheapp.com/extension/privacy`, and paste the URL.

## Privacy policy (draft to host)

> **Pepper Recipe Importer — Privacy Policy**
>
> The Pepper Recipe Importer extension reads the content of pages you visit
> only to detect whether the page contains a recipe (using the page's embedded
> schema.org metadata). This detection happens entirely on your device.
>
> When you click save, the extension sends the extracted recipe (title,
> ingredients, instructions, image URL, source URL) together with your Pepper
> pairing code to Pepper's servers, solely to add the recipe to your Pepper
> account. Nothing is sent unless you click save.
>
> The extension does not collect or transmit your browsing history, and does
> not share data with third parties. Locally stored data (pairing code, saved
> recipes, button position) can be removed at any time by uninstalling the
> extension. Questions: support@peppertheapp.com.

## Publishing flow (for reference)

1. One-time: register as a CWS developer at the dev console ($5, any Google
   account — consider a shared pepper team account, not a personal one).
2. `npm run zip` → upload `pepper-extension.zip` as a new item.
3. Fill Store listing + Privacy practices tabs from this doc.
4. **Visibility: Unlisted** for the testing phase — anyone with the link can
   install (normal Chrome, no developer mode), but it's not searchable.
   Flip to Public later; that's just a setting change + re-review.
5. Submit for review. Expect ~1–7 days (the `<all_urls>` content script gets
   human review). Respond quickly to any policy emails.
6. Ship updates by bumping `version` in package.json, `npm run zip`,
   upload → re-review (usually faster).

## Before flipping to Public (launch checklist)

- Real brand icons + screenshots.
- Backend live and `BACKEND_ENABLED = true`.
- Privacy policy hosted at its final URL.
- If Phase 4 (MyRecipes overlay) is enabled by then: add the replacement
  disclosure back to the listing description and re-add a user toggle —
  that pairing is what keeps the overlay on the right side of CWS policy.
