# TubeClean: ad-free, guest-only YouTube for Fire TV, Android phones and Chrome

TubeClean is your own Android app. One APK covers both kinds of device:
- **On a TV** (Fire TV, Android TV) it shows YouTube's official TV interface (`youtube.com/tv`) full-screen, driven by the remote.
- **On a phone or tablet** it shows YouTube's mobile site (`m.youtube.com`), driven by touch.

Either way it blocks ads inside the page. It uses no third-party player and no remote servers; the only dependency is Google's `androidx.webkit`.

## What it does

| Layer | Where | How |
|---|---|---|
| 1. Network blocking | `AdBlocker.kt` | Refuses requests to ad and tracking endpoints (`adUrls`, `trackerUrls`). It never touches `googlevideo.com/videoplayback`. |
| 2. Cosmetic hiding | `adskip.js` | Hides ad tiles and banners (`hideSelectors`). |
| 3. Ad skipper | `adskip.js` | If an ad still plays, mutes it, jumps to its end at 16× speed, and clicks Skip. |
| 4. Ad-data stripping | `prune.js` | Deletes `adPlacements`/`playerAds`/`adSlots` from the video data before the player reads it, so ads are never scheduled. |

**Guest only.** There's no sign-in: sign-in pages and endpoints (`signInUrls`) are refused. Every launch starts from wiped storage, so YouTube shows its welcome and account screens each time. The app gets past them automatically by pressing the remote keys for "Get started" and then "Watch as guest" (`guestFlow` in `rules.json`). A guest with no history gets an empty Home screen; use **Search**.

**TV compatibility (`tvcompat.js`).** YouTube TV sends codec probes with deliberately impossible values (`width=99999`, `eotf=catavision`) to check that the device is a real TV. The shim answers them the way a TV does; without it, every video fails with "This video format is not supported". The app also allows Widevine DRM for YouTube pages only. Many popular and music videos reach TV clients DRM-protected.

**No history, no data collection.**
- Cookies, cache, local storage, IndexedDB, and search and watch history are wiped when the app starts and when you leave it (Home, another app, or the screensaver).
- YouTube's watch-time and playback-stats pings are blocked.
- The app makes no network calls of its own. Its only permission is internet access.

**Stats (the only data kept).** `stats.json` holds, for each day of the last 30:
- the number of videos watched
- the number of ads blocked in each video (plain numbers)
- the number of requests refused

It never stores video IDs, titles or searches. Press **☰ (Menu)** to see:
- ads blocked in this video
- today's totals and average per video
- a 30-day bar chart with an average-per-video line

A small "🛡 N ads blocked" badge also appears while you watch.

**Revision prompt.** YouTube changes its code from time to time. The app detects the breakage listed below and shows **"Blocker needs revision"**, naming the `rules.json` key to fix. It shows the prompt when you open the app, and a red banner on the Stats screen.

| Code | Meaning | Fix in `rules.json` |
|---|---|---|
| `PLAYER_NOT_FOUND` | A video is playing but no `playerSelectors` match | `playerSelectors` |
| `SKIP_FAILED` | An ad is still on screen 8 s after the skip attempt | `adClassNames`, `skipButtonSelectors` |
| `AD_DATA_CHANGED` | An ad played despite stripping | `adDataKeys`, `adUrls` |
| `AD_UNDETECTED` | New ad-like fields appeared in the video data | `adDataKeys` (or `ignoreAdLikeKeys`) |
| `SITE_CHANGED` | YouTube TV rejected the app or failed to load (after trying every user agent) | `userAgents`, `startUrl` |

A problem becomes active after 3 reports in one day (`SITE_CHANGED`: after 1). "Remind me later" snoozes the prompt for 24 h. Bumping `version` in `rules.json` clears all problems.

## Remote

| Button | Action |
|---|---|
| D-pad / Select / media keys | Normal YouTube TV control |
| Back | Back inside YouTube |
| Back (hold ~1 s) | Exit TubeClean |
| ☰ Menu | Ad-block stats |

## Phones and tablets

The app decides at launch: a device that reports TV mode, `android.software.leanback` or `amazon.hardware.fire_tv` gets the TV site; anything else gets the mobile site. On a phone:
- The `phone` section of `rules.json` overrides the TV values: start URL, the WebView's own user agent instead of a TV one, no guest flow (the mobile site needs none), mobile ad selectors, and a watch pattern that also catches `/shorts/ID`. The ad, tracker and sign-in URL lists are shared.
- The codec-probe shim (`tvcompat.js`) isn't injected.
- **Back** (button or gesture) leaves fullscreen, then goes back through the site, then closes the app.
- The site's **fullscreen** button shows the player landscape with the system bars hidden.
- A small **🛡 N** button (bottom right) shows ads blocked in this video; tapping it opens the stats screen, which has a one-column phone layout.
- Privacy is the same as on the TV: leaving the app (Home, another app, screen off) wipes the session and closes it.

## Build and install

You need Android Studio. `install.ps1` uses its bundled JDK and the SDK at `%LOCALAPPDATA%\Android\Sdk`.

**Supported devices:**
- Fire TV devices running **Fire OS 5 or later** (Android 5.1+): the 2015 Fire TV box, every Fire TV Stick (Lite, HD, 4K, 4K Max) and the Fire TV Cube. Tested on a Fire TV (2nd gen, AFTS) with Fire OS 5.2.9.5: Amazon WebView is Chromium 108, and Widevine L1 works, so DRM videos play.
- Android phones and tablets on **Android 5.1 or later**. Tested on an Android 17 phone emulator. The manifest's `leanback` requirement only filters app stores; sideloaded installs ignore it.
- **Not** Amazon's **Vega OS** models, such as the Fire TV Stick 4K Select: Vega OS isn't Android, so it can't run this APK and doesn't allow sideloading. Not iPhone or iPad either.

**Sharing it:** builds are published from the public repo [`tubeclean-release`](https://github.com/srispace1645/tubeclean-release); this repo stays private.
1. Bump `versionCode` and `versionName` in `app/build.gradle.kts`.
2. Run `gradlew assembleRelease`. It builds `app/build/outputs/apk/release/app-release.apk`, which isn't debuggable, so its WebView can't be inspected.
3. Create a release in `tubeclean-release` (tag `v<version>`) and attach the APK named exactly `TubeClean.apk`.

`https://github.com/srispace1645/tubeclean-release/releases/latest/download/TubeClean.apk` then serves the new build, and so does the short link https://tinyurl.com/2bhzu5n3 that friends install from (Downloader on Fire TV and Android TV, Chrome on phones). Download counts are in `api.github.com/repos/srispace1645/tubeclean-release/releases` (`assets[].download_count`).

Builds are signed with your debug key (`~/.android/debug.keystore`). Back that file up: updates only install over the old version when they're signed with the same key.

1. On the Fire TV:
   1. Go to **Settings → My Fire TV → About** and click the device name 7 times. This turns on **Developer Options**.
   2. In **Developer Options**, turn on **ADB Debugging**. "Apps from Unknown Sources" isn't needed for an ADB install.
   3. Note the IP address under **About → Network**. The PC must be on the same network, not a guest Wi-Fi.
2. On the PC, run the command below. It runs the tests, builds, installs and launches the app. `-ExecutionPolicy Bypass` is needed because Windows blocks `.ps1` scripts by default.
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1 -Ip 192.168.1.50
   ```
3. Accept the debugging prompt on the TV the first time, and tick "Always allow". TubeClean then appears under **Apps**; you can move it to the home row.
4. Turn **ADB Debugging** off again until the next update.

The first DRM-protected video can take about 20 s to start while the device sets up Widevine.

## Testing on a laptop (Android TV emulator)

In Android Studio, open **Device Manager**, create **Television (1080p)** with an **Android TV** image, then run `adb install -r app\build\outputs\apk\debug\app-debug.apk`.

On the laptop keyboard: the arrow keys are the D-pad, Enter is Select, Esc is Back (inside YouTube), Ctrl+Backspace is the remote's Back button (hold it to exit), and Ctrl+M is ☰.

For the phone version, create a phone AVD (any Google Play image). Android 17's Play image left ADB switched off on first boot here; starting it with `emulator -avd <name> -prop persist.sys.usb.config=adb` fixed that. The phone image has Widevine, so DRM videos play.

TV emulator limitations:
- **No Widevine DRM.** Most popular and ad-supported videos are DRM-protected on the TV interface and won't start in the emulator. Ad-data stripping still runs and counts ads for them. Unprotected videos such as Blender's Big Buck Bunny play normally. The app detects the missing DRM, shows a notice at launch, and when you open a protected video it says so and goes back to the previous screen, such as your search results, instead of leaving a black screen. Test DRM playback on the Fire Stick itself.
- **Launcher pop-ups.** The Android TV launcher shows tips that come to the front. That counts as leaving the app, so TubeClean closes and wipes. Dismiss the tips, then relaunch.

## Revising the rules

1. Connect the Fire Stick: `adb connect <ip>:5555`, then open the app.
2. On the PC, open Chrome at `chrome://inspect`. The TubeClean WebView is listed there (debug builds only); click **inspect**.
3. Find what changed:
   - an ad element → its tag or class goes into `hideSelectors`
   - a new ad request → its URL goes into `adUrls`
   - a new ad field in the `/youtubei/v1/player` response → `adDataKeys`
4. Edit `app/src/main/assets/rules.json` and bump `"version"`. TV changes go at the top level; phone-only changes (mobile site selectors) go in its `phone` section.
5. Run `.\install.ps1 -Ip <ip>`. The unit tests check the rules file before anything is installed.

`adb logcat -s TubeClean` shows each blocked request (host and path only) and each health report.

The TV-interface selectors in `hideSelectors`, `adIndicatorSelectors` and `skipButtonSelectors` are a starting set. Confirm them against the live page on first run.

## Checking what leaves the TV

TubeClean's own code makes no network requests. Every request comes from the YouTube TV page inside its WebView. The audit tool records that page's traffic through the WebView debugger, so HTTPS requests are seen decrypted. It checks each request against `rules.json` and reports:
- where traffic went
- what was blocked on the TV
- what YouTube is told about the device
- which identifiers and cookies were sent

It needs the debug build (from `install.ps1`) and ADB Debugging turned on.

```powershell
node tools/egress-audit.mjs --device 192.168.1.50:5555 --seconds 90 --play 0e3GPea1Tyg
```

Leave out `--play` to record while you use the app yourself; press Ctrl+C to stop early. Reports go to `audits/`. The raw `.json` log contains the session's guest ID and cookies, so keep it on your PC.

The audit can't see traffic from outside the page, such as Android's DRM setup and Fire OS services. To see where that goes, use either:
- **Your router's DNS log**, if it has one: it lists every domain the TV looks up.
- **A PC hotspot and Wireshark:** turn on Windows **Mobile hotspot**, connect the TV to it, and capture on the hotspot adapter. Filter with `ip.addr == <tv-ip>`, and add `dns` or `tls.handshake.extensions_server_name` to list destinations. The content stays encrypted; you see destinations and volumes.

## Chrome extension (laptops)

`extension/` brings the same blocking to desktop **www.youtube.com** in Chrome, or any Chromium browser such as Edge. It runs the app's own `prune.js` and `adskip.js` with the `desktop` section of `rules.json`, so a single rules revision fixes the app and the extension together.

| App | Extension |
|---|---|
| `AdBlocker.kt` | `declarativeNetRequest` rules generated from `adUrls`, `trackerUrls`, `signInUrls` and `neverBlock`. They only apply to requests made by YouTube pages, so the rest of Chrome is untouched. |
| Document-start scripts | Content scripts in the page's own world: `rules.js`, `src/bridge-shim.js` and `prune.js` in every frame; `adskip.js` and `src/enforcement.js` in the top frame |
| `TubeCleanBridge` | `src/bridge-shim.js` posts each call to `src/relay.js`, which passes it to the service worker (`src/background.js`) |
| `StatsStore.kt`, `HealthMonitor.kt` | `src/stats.js`, `src/health.js`, kept in `chrome.storage.local` |
| ☰ stats screen, 🛡 badge, revision prompt | The toolbar popup. The icon's badge shows the ads blocked in the current video, or **!** when the rules need revising. |

**Guest only, like the app:**
- **Sign-in:** pages and endpoints are refused, but only when YouTube requests them. Gmail and other Google sign-ins keep working.
- **Wipe:** YouTube's cookies, storage and cache are wiped when its last tab closes or leaves YouTube, when Chrome starts, and on install. If you were signed in to YouTube in Chrome, installing signs you out of YouTube only.
- **History:** YouTube pages are deleted from Chrome's history as soon as they're added.
- **Stats:** the only thing kept, as in the app.

**Desktop's anti-adblock dialog.** `enforcementSelectors` (desktop section) finds YouTube's "Ad blockers are not allowed" dialog. The extension removes it and resumes the video, and `SITE_CHANGED` makes the popup show the revision banner.

**Build and install:**
```powershell
node tools/build-extension.mjs
```
This writes `extension/dist/` and `build/TubeClean-chrome-<version>.zip`, using `versionName` from `app/build.gradle.kts`. To install:
1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `extension/dist`.

After a rules revision, rebuild and click the extension's reload button. To share it, attach the zip to the `tubeclean-release` release; friends unzip it and use **Load unpacked**.

**Tests:** `node --test tools/*.test.mjs` checks:
- the generated network rules against the real `rules.json`: what gets blocked, that `neverBlock` wins, that query strings can't cause a block
- the desktop profile
- the stats and health ports

**Revising for desktop:** inspect youtube.com with DevTools.
- Desktop-only selectors (`ytd-*`) go in the `desktop` section of `rules.json`.
- URL lists and `adDataKeys` are shared with the app.
- Bump `"version"` and rebuild.

The `desktop` hide selectors are a starting set; confirm them against the live page.

## Project layout

```
app/src/main/assets/rules.json     everything that goes stale
app/src/main/assets/tvcompat.js    codec-probe shim so YouTube TV plays in WebView
app/src/main/assets/prune.js       layer 4 (document start)
app/src/main/assets/adskip.js      layers 2 + 3, health probes, per-video counting
app/src/main/java/.../MainActivity.kt   WebView shell, network blocking, remote keys, badge, phone fullscreen
                      TubeCleanApp.kt   TV or phone detection, rules profile
                      SystemBars.kt     phone theme with status and navigation bars
                      AdBlocker.kt      URL classification (layer 1)
                      PrivacyGuard.kt   wipes all browsing data
                      StatsStore.kt     30-day ad counts
                      HealthMonitor.kt  revision detection
                      StatsActivity.kt / TrendChartView.kt   Menu screen and chart
tools/make-art.ps1                 regenerates the PNG app icon (all densities) and the TV banner
tools/egress-audit.mjs             records and reports what the app's WebView sends out
tools/build-extension.mjs          builds the Chrome extension from rules.json and the shared page scripts
tools/extension-lib.mjs            desktop profile merge, rules.json -> declarativeNetRequest rules
extension/manifest.json            Chrome extension manifest (matches and version filled in by the build)
extension/src/background.js        service worker: stats, health, badge, guest-only wipe
extension/src/bridge-shim.js, relay.js   page-to-extension bridge (stands in for TubeCleanBridge)
extension/src/enforcement.js       removes YouTube's anti-adblock dialog
extension/popup.*                  toolbar popup: stats, 30-day chart, revision banner
```
