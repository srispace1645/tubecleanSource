/*
 * TubeClean for Tubi (tubitv.com). Tubi's player doesn't stitch ads into the movie: before a break it
 * asks its ad service (Rainmaker, "adDecisionUrls") for a list of ads ("adListKey"), then plays them
 * around the movie. This empties that list as the player reads it, so it has nothing to play and
 * carries on with the movie. Runs in the page at document start; patterns come from tubi.json
 * (window.__TC_TUBI).
 *
 * Tubi's ad-blocker bait (mcdn.tubitv.com/js/ads.js) is left alone, so the site still sees "ads allowed".
 * Like prune.js, only counts leave the page: ads removed, and that a new title started.
 */
(function () {
  'use strict';
  if (window.__tcTubi) return;
  var T = window.__TC_TUBI || {};
  var bridge = window.TubeCleanBridge;
  var api = (window.__tcTubi = {});
  var DECISION = (T.adDecisionUrls || []).map(function (u) { return u.toLowerCase(); });
  var LIST_KEY = T.adListKey || 'items';
  var ITEM_KEYS = T.adItemKeys || ['ad_id', 'media'];

  function call(fn) {
    try { if (bridge) fn(bridge); } catch (e) {}
  }

  var reported = {};
  function health(detail) {
    if (reported[detail]) return; // once per page per problem
    reported[detail] = true;
    call(function (b) { b.health('TUBI_CHANGED', String(detail).slice(0, 200)); });
  }

  /** Host and path only (as AdBlocker.hostAndPath), so a query parameter can't cause or dodge a match. */
  function isAdDecision(url) {
    var target = String(url || '').toLowerCase().replace(/^[a-z]+:\/\//, '').split('#')[0].split('?')[0];
    return DECISION.some(function (d) { return target.indexOf(d) === 0 || target.indexOf('.' + d) !== -1; });
  }
  api.isAdDecision = isAdDecision;

  function isAdItem(o) {
    return !!o && typeof o === 'object' && ITEM_KEYS.some(function (k) { return k in o; });
  }

  /** Empties the ad list in a decoded answer. Returns the number of ads removed, or -1 if it isn't an ad list. */
  function pruneDecision(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj[LIST_KEY])) return -1;
    var list = obj[LIST_KEY];
    var ads = list.filter(isAdItem).length;
    if (ads < list.length) health('unknown entries in the ad list; check "adItemKeys"');
    obj[LIST_KEY] = list.filter(function (o) { return !isAdItem(o); });
    // Keep the summary consistent with the now-empty list ("metadata.resultlength" and the like).
    (T.adCountFields || []).forEach(function (path) {
      var parts = path.split('.'), o = obj;
      for (var i = 0; i < parts.length - 1 && o; i++) o = o[parts[i]];
      if (o && typeof o === 'object' && parts[parts.length - 1] in o) o[parts[parts.length - 1]] = 0;
    });
    return ads;
  }
  api.pruneDecision = pruneDecision;

  /** Text version for XHR text and fetch. ok is false when the text isn't an ad list (left untouched). */
  function pruneText(text) {
    if (!text) return { ok: false }; // e.g. 204 No Content: no ads at all
    var obj;
    try { obj = JSON.parse(text); } catch (e) {
      health('ad service answer is not JSON');
      return { ok: false };
    }
    var removed = pruneDecision(obj);
    if (removed < 0) {
      health('ad service answer has no "' + LIST_KEY + '" list; check "adListKey"');
      return { ok: false };
    }
    return { ok: true, removed: removed, text: JSON.stringify(obj) };
  }
  api.pruneText = pruneText;

  // ---- Counting -------------------------------------------------------------------
  var lastContent = null, decisions = 0;

  function counted(url, removed) {
    var m = String(url).match(new RegExp('[?&]' + (T.contentIdParam || 'content_id') + '=([^&#]+)'));
    var id = m ? m[1] : null; // page memory only; never sent out
    if (id && id !== lastContent) {
      lastContent = id;
      call(function (b) { b.videoStarted(); });
    }
    if (removed > 0) call(function (b) { b.adsPruned(removed); });
  }

  // ---- XHR (what Tubi's player uses, with responseType "json") ---------------------
  if (window.XMLHttpRequest) {
    var XHR = XMLHttpRequest.prototype;
    var nativeOpen = XHR.open;
    XHR.open = function open(method, url) {
      this.__tcUrl = isAdDecision(url) ? String(url) : null;
      this.__tcDone = undefined;
      // Any answer counts as the player asking, including 204 "no ads" that it never reads.
      if (this.__tcUrl) this.addEventListener('loadend', function () { decisions++; }, { once: true });
      return nativeOpen.apply(this, arguments);
    };
    try { XHR.open.toString = nativeOpen.toString.bind(nativeOpen); } catch (e) {}

    var respDesc = Object.getOwnPropertyDescriptor(XHR, 'response');
    var textDesc = Object.getOwnPropertyDescriptor(XHR, 'responseText');

    // Rewrites once per response, when it's complete; later reads get the same answer.
    var pruneXhr = function (xhr) {
      if (!xhr.__tcUrl || xhr.readyState !== 4) return null;
      if (xhr.__tcDone !== undefined) return xhr.__tcDone;
      var type = xhr.responseType, done = null;
      try {
        if (type === 'json') {
          var obj = respDesc.get.call(xhr);
          var removed = obj ? pruneDecision(obj) : -1;
          if (removed >= 0) done = { ok: true, removed: removed, obj: obj };
          else if (obj) health('ad service answer has no "' + LIST_KEY + '" list; check "adListKey"');
        } else if (type === '' || type === 'text') {
          var r = pruneText(textDesc.get.call(xhr));
          if (r.ok) done = r;
        }
      } catch (e) {}
      xhr.__tcDone = done;
      if (done) counted(xhr.__tcUrl, done.removed);
      return done;
    };

    try {
      if (respDesc && respDesc.get) {
        Object.defineProperty(XHR, 'response', {
          configurable: true,
          enumerable: respDesc.enumerable,
          get: function () {
            var d = pruneXhr(this);
            if (!d) return respDesc.get.call(this);
            return d.obj || d.text;
          }
        });
      }
      if (textDesc && textDesc.get) {
        Object.defineProperty(XHR, 'responseText', {
          configurable: true,
          enumerable: textDesc.enumerable,
          get: function () {
            var d = pruneXhr(this);
            return d && d.text !== undefined ? d.text : textDesc.get.call(this);
          }
        });
      }
    } catch (e) {}
  }

  // ---- fetch (in case the player switches to it) ----------------------------------
  if (window.fetch && window.Response) {
    var nativeFetch = window.fetch;
    window.fetch = function fetch(input) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var p = nativeFetch.apply(this, arguments);
      if (!isAdDecision(url)) return p;
      decisions++;
      return p.then(function (res) {
        return res.clone().text().then(function (text) {
          var r = pruneText(text);
          if (!r.ok) return res;
          counted(url, r.removed);
          return new Response(r.text, { status: res.status, statusText: res.statusText, headers: res.headers });
        }, function () { return res; });
      });
    };
    try { window.fetch.toString = nativeFetch.toString.bind(nativeFetch); } catch (e) {}
  }

  // ---- Health probe ---------------------------------------------------------------
  // A title has played for a while but the player never asked the ad service: it moved, so ads may get through.
  if (window.top === window && typeof setInterval === 'function') {
    var watchRe = new RegExp(T.watchPathPattern || '^/(movies|tv-shows|series)/');
    var playedSince = 0, lastPath = null;
    setInterval(function () {
      if (location.pathname !== lastPath) { lastPath = location.pathname; playedSince = 0; }
      if (!watchRe.test(location.pathname) || decisions > 0) return;
      var v = document.querySelector('video');
      var main = v && isFinite(v.duration) && v.duration >= (T.minContentSeconds || 600) && !v.paused;
      if (!main) return;
      if (!playedSince) playedSince = Date.now();
      if (Date.now() - playedSince > (T.noDecisionProbeSeconds || 30) * 1000) {
        health('a title played with no request to the ad service; check "adDecisionUrls"');
      }
    }, 1000);
  }
})();
