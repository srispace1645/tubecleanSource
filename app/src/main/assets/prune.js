/*
 * TubeClean layer 4: strip ad data out of YouTube's video responses before the player reads it,
 * so the ads are never scheduled. Runs at document start; patterns come from rules.json
 * (window.__TC_RULES). Per-video ad counts live in page memory only and leave as plain numbers.
 */
(function () {
  'use strict';
  if (window.__tcPrune) return;
  window.__tcPrune = true;

  var R = window.__TC_RULES || {};
  var bridge = window.TubeCleanBridge;
  var AD_KEYS = R.adDataKeys || [];
  var COUNT_KEY = R.adCountKey || 'adPlacements';
  var IGNORE = new Set(R.ignoreAdLikeKeys || []);
  // Top-level keys that look ad-related: "ads", "adFoo", "adsFoo", "playerAds".
  var AD_LIKE = /^ads?$|^ads?[A-Z_]|Ads?$/;
  var adsByVideo = new Map();
  var unknownReported = new Set();
  var tc = (window.__tc = window.__tc || {});

  tc.prunedFor = function (id) { return adsByVideo.get(id) || 0; };

  // Videos whose streams need DRM (Widevine); adskip.js leaves them gracefully on devices without it.
  var drmVideos = new Set();
  tc.isDrm = function (id) { return drmVideos.has(id); };

  function health(code, detail) {
    try { if (bridge) bridge.health(code, String(detail).slice(0, 200)); } catch (e) {}
  }

  function isPlayerResponse(o) {
    return !!o && typeof o === 'object' && !Array.isArray(o) &&
      ('videoDetails' in o || 'streamingData' in o || 'playabilityStatus' in o);
  }

  function prunePlayerResponse(pr) {
    var found = false, count = 0;
    AD_KEYS.forEach(function (k) {
      if (!(k in pr)) return;
      found = true;
      if (k === COUNT_KEY && Array.isArray(pr[k])) count = pr[k].length;
      delete pr[k];
    });
    if (found && count === 0) count = 1;

    var id = pr.videoDetails && pr.videoDetails.videoId;
    var sd = pr.streamingData;
    if (id && sd && (sd.licenseInfos || sd.drmParams ||
        (sd.adaptiveFormats || []).some(function (f) { return f.drmFamilies; }))) {
      drmVideos.add(id);
    }
    var unknown = Object.keys(pr).filter(function (k) { return AD_LIKE.test(k) && !IGNORE.has(k); }).sort();
    if (unknown.length) {
      var key = (id || '?') + '|' + unknown.join(',');
      if (!unknownReported.has(key)) {
        unknownReported.add(key);
        health('AD_UNDETECTED', unknown.join(','));
      }
    }

    // The same response is often parsed more than once, so keep the max rather than summing.
    if (id && count > (adsByVideo.get(id) || 0)) {
      adsByVideo.set(id, count);
      if (tc.onPruned) tc.onPruned(id);
    }
  }

  function walkOne(o) {
    if (!o || typeof o !== 'object') return;
    if (isPlayerResponse(o)) prunePlayerResponse(o);
    if (isPlayerResponse(o.playerResponse)) prunePlayerResponse(o.playerResponse);
    // Feed and "next" responses can carry ad slots too; drop them without counting.
    AD_KEYS.forEach(function (k) { if (k in o) delete o[k]; });
  }

  function walk(o) {
    if (Array.isArray(o)) {
      for (var i = 0; i < o.length && i < 8; i++) walkOne(o[i]);
    } else {
      walkOne(o);
    }
  }

  function guarded(o) {
    try { walk(o); } catch (e) {}
    return o;
  }

  // XHR text responses and inline data go through JSON.parse.
  var nativeParse = JSON.parse;
  JSON.parse = function parse() {
    return guarded(nativeParse.apply(this, arguments));
  };
  try { JSON.parse.toString = nativeParse.toString.bind(nativeParse); } catch (e) {}

  // fetch() responses.
  if (window.Response && Response.prototype.json) {
    var nativeJson = Response.prototype.json;
    Response.prototype.json = function json() {
      return nativeJson.apply(this, arguments).then(guarded);
    };
  }

  // XHR with responseType "json" is parsed natively, so wrap the getter.
  try {
    var desc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
    if (desc && desc.get) {
      Object.defineProperty(XMLHttpRequest.prototype, 'response', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          var r = desc.get.call(this);
          return this.responseType === 'json' ? guarded(r) : r;
        }
      });
    }
  } catch (e) {}

  // Player data embedded in the page itself.
  try {
    var initial;
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: function () { return initial; },
      set: function (v) { initial = guarded(v); }
    });
  } catch (e) {}
})();
