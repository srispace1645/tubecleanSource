/*
 * Stands in for the app's TubeCleanBridge (@JavascriptInterface in MainActivity.kt) so prune.js and
 * adskip.js run unchanged. Runs in the page's own context before them; each call is posted to
 * relay.js, which passes it to the service worker. Like the app's bridge, calls carry counts or
 * problem codes only, never video details.
 */
(function () {
  'use strict';
  if (window.TubeCleanBridge) return;
  var TYPE = 'tubeclean-bridge';

  function send(method, args) {
    try { window.postMessage({ type: TYPE, method: method, args: args }, location.origin); } catch (e) {}
  }

  var bridge = {
    videoStarted: function () { send('videoStarted', []); },
    adsPruned: function (n) { send('adsPruned', [Number(n) | 0]); },
    adSkipped: function () { send('adSkipped', []); },
    playing: function (isPlaying) { send('playing', [!!isPlaying]); },
    health: function (code, detail) { send('health', [String(code), String(detail).slice(0, 200)]); },
    // TV-only: guest auto-entry presses remote keys, and DRM exits go back a screen. Chrome on a
    // laptop has neither a remote nor missing Widevine, so these do nothing.
    remoteKey: function () {},
    noDrm: function () {},
    drmBlocked: function () {}
  };
  try {
    Object.defineProperty(window, 'TubeCleanBridge', { value: Object.freeze(bridge) });
  } catch (e) {}
})();
