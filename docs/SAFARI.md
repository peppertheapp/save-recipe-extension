# Safari version (App Store)

Safari extensions ship **inside a small app** submitted to **App Store Connect** —
there is no unpacked-zip sideload like Chrome. The Xcode project lives in
[`safari/`](../safari) and was generated from the Chrome build with Apple's
`safari-web-extension-converter`. It contains four targets: a macOS app + its
extension, and an iOS app + its extension. Both wrap the same web-extension
code from `dist/`.

## Prerequisites

- Xcode (installed) and an **Apple Developer Program** membership ($99/yr), same
  account as any other Pepper app.
- The web extension built: `npm run build`.

## Updating the Safari copy after web changes

The Safari project has its **own copy** of the built extension (so it stays
buildable and committable). After any change to the extension source, refresh it:

```bash
npm run safari:sync
```

This rebuilds `dist/` and mirrors it into
`safari/Pepper Recipe Importer/Shared (Extension)/Resources/`, preserving all
Xcode settings (bundle id, signing). Do **not** re-run the full converter — that
regenerates the project and wipes signing/config.

Bump `version` in `package.json` for each App Store submission (the app and
extension read it from the manifest), the same as for Chrome.

## Build & upload (in Xcode)

1. Open `safari/Pepper Recipe Importer/Pepper Recipe Importer.xcodeproj`.
2. Select the **"Pepper Recipe Importer (macOS)"** scheme (repeat later for iOS).
3. For each of the 4 targets → **Signing & Capabilities**: set your **Team** and a
   unique **Bundle Identifier**. The converter used
   `com.peppertheapp.PepperRecipeImporter` (app) with the extension appended —
   change these to match your Apple Developer account if needed. The extension's
   bundle id must be the app's id + a suffix (e.g. `.Extension`).
4. Run it locally first (▶). The app window explains how to enable the extension:
   Safari → Settings → Extensions → turn on **Pepper Recipe Importer**. On macOS
   you must also allow it on the sites it uses (it requests all sites for recipe
   detection).
5. To ship: **Product → Archive** → **Distribute App** → **App Store Connect**.
   Do this once for the macOS app and once for iOS.
6. In App Store Connect, complete the listing (name, screenshots, description,
   privacy) and submit for review. Reuse the copy in `docs/STORE_LISTING.md`.

## Notes / gotchas

- The converter warned that manifest keys `type` (background.service_worker type)
  and `use_dynamic_url` are ignored by Safari. Both are non-critical: Safari runs
  the MV3 service worker fine, and `use_dynamic_url` is a Chrome-only resource
  hint. No code change needed. Verify the background works when testing in Safari.
- `chrome.*` APIs used here (storage, alarms, runtime, tabs, action) are all
  supported by Safari's web-extension bridge.
- A compile check passes today:
  `xcodebuild build -scheme "Pepper Recipe Importer (macOS)" -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`.
