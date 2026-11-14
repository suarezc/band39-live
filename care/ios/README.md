# Band 39 Care for iPhone

The Band 39 care web app (`../web`) as an iPhone app. A native tab bar switches between three roles:

| Tab | What it shows | Calls |
|---|---|---|
| **Margaret** | the elderly person's screen (Today · Talk · Messages · Help) | `VexoCare.go('grandma', <her last tab>)` |
| **Lisa** | the caregiver app (Home · Physical · Memory · Safety · Care · Circle) | `VexoCare.go('caregiver', <her last tab>)` |
| **Simulator** | top switch: **30-second demo** (voxel room, Play) or **Full simulator**, plus a gear for Settings | `VexoCare.go('home')` / `VexoCare.go('sim')` |

All three are one `WKWebView` running one copy of the page, so every role sees the same live state with no syncing.
When a button inside the page changes portal by itself, the tab bar follows (a small hook on `history.replaceState`).
The app opens on the Simulator tab (`band39care://app/index.html?embed=1#/`).

## Open and run
1. Open `Band39Care.xcodeproj` in Xcode (27).
2. Target **Band39Care** › Signing & Capabilities: pick your team (set to `5GX36K3U7Y`). Bundle id `com.amyli.band39care`.
3. Plug in an iPhone (iOS 16 or later), pick it as the run destination, press Run. The first time, trust the developer
   profile on the phone (Settings › General › VPN & Device Management).
4. On an Apple-silicon Mac you can also pick **My Mac (Designed for iPhone)**.

There is no iOS Simulator runtime on this Mac, so use a real phone.

The app bundles the **live** `../web` folder (a folder reference), so after you edit the web app, just build and run again.
Nothing in `web/` is copied or changed for the app.

## Server URL (AI and voice)
Pip's replies, transcripts (Deepgram), the risk read (OpenAI), voices (ElevenLabs) and Lisa's digests come from
`server/server.py`, which holds the keys. The app has no keys.

1. Start the server so the phone can reach it:
   `HOST=0.0.0.0 python3 server/server.py` (default port 8039; without `HOST` it only listens on this Mac).
2. In the app: **Simulator** tab › gear › type the server URL (for example `http://192.168.1.20:8039`, or an https URL
   such as the Superserve deploy) › **Test connection** › **Save**. Saving reloads the page, so the day starts over.

The URL is stored in UserDefaults and injected at page start as `window.B39_API_BASE`; `web/js/api-base.js` then
sends every `api/...` request there. The server answers with CORS headers (`Access-Control-Allow-Origin: *`) and
handles `OPTIONS` preflights.

**No server (the default):** the simulator, the 30-second demo, the voxel room, motion labels and the pretend band
all run on the phone. AI and voice features fall back to offline rules or show an error (the app answers `api/...`
with "No server set" when there's no server). The Stripe care shop stays in demo mode.

Prefer **https**. A plain `http://` LAN server is allowed by App Transport Security (`NSAllowsArbitraryLoadsInWebContent`),
but WebKit may still block it as mixed content if it treats the `band39care://` page as secure. If the test passes but
requests fail inside the page, use an https URL (a tunnel or the Superserve deploy).

## What's inside
- `Band39Care/AppDelegate.swift`: UIKit app and scene delegates. No SwiftUI, because Swift macros like `@State`
  fail in this machine's command-line builds.
- `Band39Care/MainViewController.swift`: the web view, the tab bar, the Simulator top bar, the user scripts
  (API base, Bluetooth transport, nav hook), microphone permission, and links opening in Safari.
- `Band39Care/SettingsViewController.swift`: the server URL sheet.
- `Band39Care/BundleSchemeHandler.swift`: serves `web/` at `band39care://app/`, so ES modules (three.js, the Vexo Open kit) load.
- `Band39Care/BLEBridge.swift` + `Band39Care/native-ble.js`: CoreBluetooth for **Connect band 39**, copied from
  `band39-app/ios`. `web/js/app.js` already uses `window.VexoNativeBle` when it exists. Bluetooth starts only when
  you tap Connect, not at launch. **Not tested with a real band.**
- `Info.plist`: only the scene manifest, ATS and local-network text. Other keys (microphone, Bluetooth, display name)
  are build settings.
- App icon: `Band39Care/Assets.xcassets/AppIcon.appiconset/icon-1024.png`, made by a script.

## Verified / not verified (2026-11-14)
- Verified: `xcodebuild` for generic iOS, Debug and Release (`CODE_SIGNING_ALLOWED=NO`), **BUILD SUCCEEDED**. A Mac
  Catalyst build of a /tmp copy (with `SUPPORTS_MACCATALYST = YES` added) also succeeds. The built app contains `web/`,
  `native-ble.js` and the Info.plist keys.
- Verified in a browser (WKWebView harness, 390×844, `?embed=1`): Margaret, Lisa, the 30-second demo and the full
  simulator render with no JS errors. The exact calls the tabs make (`VexoCare.go(...)`) switch portals and report
  the hashes the nav hook expects. `api-base.js` rewrites `api/...` to the injected base. The server's CORS preflight
  returns 204 with the headers.
- **Not verified:** running the app itself. The Catalyst app launched from the Claude shell crash-loops WebKit's
  web content process (a sandbox limitation of that shell), and there is no iOS Simulator runtime. Still untested on a
  device: the tab bar, Settings, Pip's hands-free voice, the microphone, and Bluetooth.
- Microphone: `getUserMedia` needs WebKit to treat the `band39care://` page as a secure context. That should hold for
  app-registered schemes on iOS 14.3 and later, but it's untested here. If the mic says "no microphone access", that's why.
- Stripe Checkout (only with a Stripe key) sends `origin: band39care://app` as the return URL, and Stripe may refuse it.
