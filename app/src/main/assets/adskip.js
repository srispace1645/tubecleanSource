/*
 * TubeClean layers 2 and 3, plus the health probes. Runs in the top frame only.
 *  - hides ad tiles and banners (hideSelectors)
 *  - fast-forwards and skips any video ad that still gets through
 *  - tells the app when a video starts and how many ads were blocked in it (counts only)
 *  - reports when YouTube no longer matches rules.json, so the app can prompt for a revision
 */
(function () {
  'use strict';
  if (window.top !== window || window.__tcSkip) return;
  window.__tcSkip = true;

  var R = window.__TC_RULES || {};
  var bridge = window.TubeCleanBridge;
  var tc = (window.__tc = window.__tc || {});
  var TICK_MS = 250;
  var watchRe = new RegExp(R.watchRoutePattern || '[?&]v=([\\w-]{11})');

  function call(fn) {
    try { if (bridge) fn(bridge); } catch (e) {}
  }

  function first(selectors) {
    for (var i = 0; i < (selectors || []).length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        if (el) return el;
      } catch (e) { /* invalid selector in rules.json: skip it */ }
    }
    return null;
  }

  function visible(el) { return !!el && el.getClientRects().length > 0; }

  // ---- Layer 2: cosmetic hiding -------------------------------------------------
  // YouTube's Content-Security-Policy blocks plain inline <style> tags, so use a constructable
  // stylesheet (not subject to style-src), falling back to a <style> carrying the page's own nonce.
  var hideSheet = null;
  function injectHideCss() {
    if (!document.documentElement) return;
    // One rule per selector: a single invalid selector would otherwise void the whole list.
    var rules = (R.hideSelectors || []).map(function (s) { return s + '{display:none!important}'; });
    if (window.CSSStyleSheet && 'adoptedStyleSheets' in document) {
      if (!hideSheet) {
        hideSheet = new CSSStyleSheet();
        rules.forEach(function (r) { try { hideSheet.insertRule(r, hideSheet.cssRules.length); } catch (e) {} });
      }
      // The SPA may reset adoptedStyleSheets; re-add if it went missing.
      if (document.adoptedStyleSheets.indexOf(hideSheet) === -1) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat([hideSheet]);
      }
      return;
    }
    if (document.getElementById('tc-hide')) return;
    var withNonce = document.querySelector('[nonce]');
    if (!withNonce) return; // try again next tick
    var style = document.createElement('style');
    style.id = 'tc-hide';
    style.nonce = withNonce.nonce;
    style.textContent = rules.join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- Per-video bookkeeping ----------------------------------------------------
  var videoId = null;       // page memory only; never sent to the app
  var prunedReported = 0;
  var skipped = 0;
  var reportedCodes = new Set();
  var playerMissingSince = 0;

  function health(code, detail) {
    if (reportedCodes.has(code)) return; // once per video per problem
    reportedCodes.add(code);
    call(function (b) { b.health(code, String(detail).slice(0, 200)); });
  }

  function flushPruned() {
    if (!videoId || !tc.prunedFor) return;
    var n = tc.prunedFor(videoId);
    if (n > prunedReported) {
      var delta = n - prunedReported;
      prunedReported = n;
      call(function (b) { b.adsPruned(delta); });
    }
  }
  tc.onPruned = function (id) { if (id === videoId) flushPruned(); };

  function checkRoute() {
    // TV: /tv#/watch?v=ID. Mobile site: /watch?v=ID and /shorts/ID.
    var m = (location.pathname + location.search + location.hash).match(watchRe);
    var id = m ? m[1] : null;
    if (id === videoId) return;
    videoId = id;
    prunedReported = 0;
    skipped = 0;
    reportedCodes = new Set();
    playerMissingSince = 0;
    drmSeenAt = 0;
    if (id) {
      call(function (b) { b.videoStarted(); });
      flushPruned();
    }
  }

  // ---- Layer 3: ad skipper ------------------------------------------------------
  var adActive = false, adSince = 0, adKey = null, mutedBefore = false;

  function adState(player) {
    var classes = R.adClassNames || [];
    if (player && classes.some(function (c) { return player.classList.contains(c); })) return 'strong';
    return visible(first(R.adIndicatorSelectors)) ? 'weak' : null;
  }

  function handleAd(state, player, video) {
    var pruned = tc.prunedFor && videoId ? tc.prunedFor(videoId) : 0;
    if (!adActive) {
      adActive = true;
      adSince = Date.now();
      adKey = null;
      mutedBefore = video ? video.muted : false;
      health('AD_DATA_CHANGED', pruned
        ? 'ad played although ' + pruned + ' ad placement(s) were stripped'
        : 'ad played; no known ad data keys in the video data');
    }

    if (video) {
      // A lone indicator (no ad class on the player) is weaker evidence: never fast-forward a long video on it.
      var canSeek = state === 'strong' ||
        (isFinite(video.duration) && video.duration <= (R.maxSeekAdSeconds || 300));
      if (canSeek) {
        video.muted = true;
        if (isFinite(video.duration) && video.duration > 0) {
          var key = video.currentSrc + '|' + Math.round(video.duration);
          if (key !== adKey) {
            adKey = key;
            skipped++;
            // Count only ads the data-stripping layer hasn't already counted for this video.
            if (skipped > pruned) call(function (b) { b.adSkipped(); });
          }
          if (video.currentTime < video.duration - 0.25) video.currentTime = video.duration - 0.1;
        }
        try { video.playbackRate = 16; } catch (e) {}
        if (video.paused) {
          var p = video.play();
          if (p && p.catch) p.catch(function () {});
        }
      }
    }

    var btn = first(R.skipButtonSelectors);
    if (btn) btn.click();

    if (Date.now() - adSince > (R.skipFailMs || 8000)) {
      health('SKIP_FAILED', 'ad still showing after ' + Math.round((Date.now() - adSince) / 1000) +
        's; player classes: ' + (player ? player.className : 'none'));
    }
  }

  function endAd(video) {
    adActive = false;
    adKey = null;
    if (video) {
      video.muted = mutedBefore;
      try { video.playbackRate = 1; } catch (e) {}
    }
  }

  // ---- Health probes ------------------------------------------------------------
  function probePlayer(player, video) {
    if (player || !video || video.paused) { playerMissingSince = 0; return; }
    if (!playerMissingSince) playerMissingSince = Date.now();
    else if (Date.now() - playerMissingSince > (R.playerProbeMs || 10000)) {
      health('PLAYER_NOT_FOUND', 'a video is playing but none of playerSelectors matched');
    }
  }

  function probeSite() {
    // Error pages are short and have no video; don't scan a normal feed full of titles.
    if (!document.body || document.querySelector('video')) return;
    var text = (document.body.innerText || '');
    if (text.length > 2000) return;
    text = text.toLowerCase();
    (R.unsupportedTextPatterns || []).some(function (p) {
      if (text.indexOf(p.toLowerCase()) === -1) return false;
      call(function (b) { b.health('SITE_CHANGED', 'page says: ' + p); });
      return true;
    });
  }

  // ---- Guest auto-entry ---------------------------------------------------------
  // Every launch starts with wiped storage, so YouTube shows its welcome and account screens.
  // The TV UI ignores synthetic clicks, so ask the app to press real remote keys:
  // Select on "Get started", then Down until "Watch as guest" has focus, then Select.
  var G = R.guestFlow || {};
  var guestSteps = 0, lastGuestStep = 0;

  function textMatches(el, labels) {
    var t = el ? (el.textContent || '').trim().toLowerCase() : '';
    return !!t && (labels || []).some(function (l) { return t.indexOf(l.toLowerCase()) !== -1; });
  }

  function autoGuest() {
    if (Date.now() - lastGuestStep < (G.stepMs || 700)) return;
    var focused = document.activeElement;
    var menuSel = G.guestItemSelector || '[role=menuitem]';
    var action = null;
    // Only ever act on the welcome screen and the account menus/pickers, never on ordinary tiles.
    var onWelcome = focused && focused.closest && focused.closest(G.welcomeSelector || 'ytlr-welcome');
    var onMenuItem = focused && focused.closest && focused.closest(menuSel);
    if ((onWelcome && textMatches(focused, G.startLabels)) || (onMenuItem && textMatches(focused, G.guestLabels))) {
      action = 'select';
    } else {
      var items = document.querySelectorAll(menuSel);
      for (var i = 0; i < items.length; i++) {
        if (textMatches(items[i], G.guestLabels) && visible(items[i])) { action = 'down'; break; }
      }
    }
    if (!action) {
      guestSteps = 0; // screen gone: the step limit applies per screen, not per session
      return;
    }
    if (guestSteps >= (G.maxSteps || 12)) return; // stuck on this screen: stop pressing keys
    guestSteps++;
    lastGuestStep = Date.now();
    call(function (b) { b.remoteKey(action); });
  }

  // ---- Main loop ----------------------------------------------------------------
  var lastPlaying = null;

  function tick() {
    injectHideCss();
    checkRoute();
    autoGuest();
    var player = first(R.playerSelectors);
    var video = (player && player.querySelector('video')) || document.querySelector('video');

    var state = adState(player);
    if (state) handleAd(state, player, video);
    else if (adActive) endAd(video);

    probePlayer(player, video);
    checkDrmExit(player, video);

    var playing = !!video && !video.paused && !video.ended;
    if (playing !== lastPlaying) {
      lastPlaying = playing;
      call(function (b) { b.playing(playing); });
    }
  }

  // ---- DRM ----------------------------------------------------------------------
  // Check Widevine the way the player will use it; the app explains black screens if it's missing.
  var drmUnavailable = false, drmSeenAt = 0, drmExitFor = null;

  function probeDrm() {
    function missing() { drmUnavailable = true; call(function (b) { b.noDrm(); }); }
    if (!navigator.requestMediaKeySystemAccess) { missing(); return; }
    navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
      initDataTypes: ['cenc'],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401e"' }]
    }]).then(function (access) { return access.createMediaKeys(); })
      .catch(missing);
  }

  function playerNeedsDrm(player) {
    if (tc.isDrm && tc.isDrm(videoId)) return true;
    // Fallback: the player's own stats name the DRM system once it tries to use one.
    try { return !!(player && player.getStatsForNerds && player.getStatsForNerds().drm); } catch (e) { return false; }
  }

  // On a device without Widevine a protected video never starts and the watch page stays black.
  // Leave it the way the remote would (one Back press), and let the app say why.
  function checkDrmExit(player, video) {
    if (!drmUnavailable || !videoId || drmExitFor === videoId) return;
    if (video && video.currentTime > 0) return; // it's playing after all
    if (!playerNeedsDrm(player)) { drmSeenAt = 0; return; }
    if (!drmSeenAt) drmSeenAt = Date.now();
    // Let the watch page finish opening, so Back lands on the previous screen.
    if (Date.now() - drmSeenAt < (R.drmExitDelayMs || 1500)) return;
    drmExitFor = videoId;
    call(function (b) { b.drmBlocked(); });
  }

  setInterval(tick, TICK_MS);
  setTimeout(probeDrm, 3000);
  setTimeout(probeSite, R.siteProbeMs || 12000);
})();
