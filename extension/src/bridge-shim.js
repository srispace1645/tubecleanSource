/*
 * Stands in for the app's TubeCleanBridge (MainActivity.kt) so prune.js and adskip.js run unchanged.
 * Runs in the page's own context before them, inside the build's per-site bundle, so the bridge is a
 * variable of that bundle rather than something on window that the site could see or call.
 *
 * Calls reach the service worker through relay.js over a private link: an element that is never put in
 * the page, handed to relay.js before any of the site's scripts exist. The site can't get hold of it,
 * so it can't listen to the calls or fake them. Like the app's bridge, calls carry counts or problem
 * codes only, never video details.
 */
(function () {
  'use strict';
  if (window.TubeCleanBridge) return;

  // Taken now, before the site's scripts run, so later changes to these by the site don't reach us.
  var dispatch = EventTarget.prototype.dispatchEvent;
  var listen = EventTarget.prototype.addEventListener;
  var unlisten = EventTarget.prototype.removeEventListener;
  var CustomEvt = CustomEvent;
  var MouseEvt = MouseEvent;
  var stringify = JSON.stringify;
  var link = document.createElement('tubeclean-link');

  // Whichever of this script and relay.js runs second completes the handshake.
  var hello = function () {
    try { dispatch.call(document, new MouseEvt('tubeclean-hello', { relatedTarget: link })); } catch (e) {}
  };
  listen.call(document, 'tubeclean-ready', hello);
  listen.call(link, 'tubeclean-ack', function () { unlisten.call(document, 'tubeclean-ready', hello); });
  hello();

  function send(method, args) {
    try { dispatch.call(link, new CustomEvt('tubeclean-call', { detail: stringify({ method: method, args: args }) })); } catch (e) {}
  }

  var bridge = {
    videoStarted: function () { send('videoStarted', []); },
    adsPruned: function (n) { send('adsPruned', [Number(n) | 0]); },
    adSkipped: function () { send('adSkipped', []); },
    playing: function (isPlaying) { send('playing', [!!isPlaying]); },
    health: function (code, detail) { send('health', [String(code), String(detail).slice(0, 200)]); },
    // YouTube asked this guest to "sign in to confirm you're not a bot" (adskip.js, once per video).
    botCheck: function () { showBotNote(); },
    homeReady: function () {}, // the app suggests a first video here; the extension doesn't
    // TV-only: guest auto-entry presses remote keys, and DRM exits go back a screen. Chrome on a
    // laptop has neither a remote nor missing Widevine, so these do nothing.
    remoteKey: function () {},
    noDrm: function () {},
    drmBlocked: function () {}
  };
  // Sign-in is off, so explain the bot check instead of leaving a dead-end sign-in screen.
  function showBotNote() {
    if (!document.body || document.getElementById('tc-bot-note')) return;
    var note = document.createElement('div');
    note.id = 'tc-bot-note';
    note.setAttribute('role', 'status');
    note.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'max-width:560px;padding:14px 40px 14px 16px;border-radius:10px;background:#263238;color:#eceff1;' +
      'font:14px/1.45 Roboto,Arial,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5)';
    var title = document.createElement('b');
    title.textContent = 'TubeClean: sign-in is turned off.';
    var text = document.createElement('div');
    text.textContent = "YouTube asks a new guest to confirm it isn't a bot before some videos. Watch any other " +
      'video for a minute, then come back to this one; YouTube usually stops asking once the guest has watched something. ' +
      'TubeClean keeps this guest for up to 10 days.';
    var close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.style.cssText = 'position:absolute;top:6px;right:8px;border:0;background:none;color:inherit;font-size:20px;cursor:pointer';
    close.onclick = function () { note.remove(); };
    note.append(title, text, close);
    document.body.appendChild(note);
  }

  window.TubeCleanBridge = Object.freeze(bridge);
})();
