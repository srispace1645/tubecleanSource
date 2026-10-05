/*
 * Desktop only: YouTube's "Ad blockers are not allowed" dialog. hideSelectors already hides it; this
 * also clears the dimmed backdrop, resumes the video it paused, and reports SITE_CHANGED so the
 * popup says the rules need revising (the dialog means YouTube spotted the blocker).
 */
(function () {
  'use strict';
  if (window.top !== window || window.__tcEnforcement) return;
  window.__tcEnforcement = true;

  var R = window.__TC_RULES || {};
  var selectors = R.enforcementSelectors || [];
  if (!selectors.length) return;
  var reported = false;

  function find() {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        if (el) return el;
      } catch (e) { /* invalid selector in rules.json: skip it */ }
    }
    return null;
  }

  function tick() {
    var el = find();
    if (!el) return;
    var dialog = el.closest('tp-yt-paper-dialog') || el;
    dialog.remove();
    document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach(function (b) { b.remove(); });

    var video = document.querySelector('#movie_player video') || document.querySelector('video');
    if (video && video.paused && !video.ended && video.currentTime > 0) {
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (!reported) {
      reported = true;
      try { window.TubeCleanBridge.health('SITE_CHANGED', 'ad-blocker warning shown: ' + el.tagName.toLowerCase()); } catch (e) {}
    }
  }

  setInterval(tick, 500);
})();
