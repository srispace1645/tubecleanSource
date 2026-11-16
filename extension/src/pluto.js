/*
 * TubeClean for Pluto TV (pluto.tv), on-demand titles. Pluto stitches ads into the video: the title's
 * playlist (DASH .mpd, "manifestUrlPattern") lists the movie in pieces with ad breaks between them, and
 * the player's schedule (session.json, "sessionUrlPattern") drives the ad countdown and locks the
 * controls during a break. This removes the ad pieces from both as the player reads them, and closes
 * the gaps, so the movie plays straight through. Live channels (dynamic playlists) are left alone.
 * Runs in the page at document start; patterns come from pluto.json (window.__TC_PLUTO).
 * Like prune.js, only counts leave the page.
 */
(function () {
  'use strict';
  if (window.__tcPluto) return;
  var P = window.__TC_PLUTO || {};
  var bridge = window.TubeCleanBridge;
  var api = (window.__tcPluto = {});
  var MANIFEST = new RegExp(P.manifestUrlPattern || '/stitch/.*\\.mpd(\\?|$)', 'i');
  var SESSION = new RegExp(P.sessionUrlPattern || '/playout/.*session\\.json', 'i');
  var EPISODE = new RegExp(P.episodeIdPattern || '/(?:episode|series|movie)/([0-9a-f]{24})/', 'i');
  var AD_PERIOD = new RegExp(P.adPeriodPattern || '_ad%2Fcreative|_ad/creative|/ad/creative', 'i');
  var AD_CLIP = P.adClipType || 'creative';

  function call(fn) {
    try { if (bridge) fn(bridge); } catch (e) {}
  }

  var reported = {};
  function health(detail) {
    if (reported[detail]) return; // once per page per problem
    reported[detail] = true;
    call(function (b) { b.health('PLUTO_CHANGED', String(detail).slice(0, 200)); });
  }

  // ---- Playlist (DASH .mpd) -------------------------------------------------------
  function toSeconds(iso) {
    var m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso || '');
    if (!m) return null;
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  }
  function toIso(s) { return 'PT' + s.toFixed(3) + 'S'; }

  /**
   * Keeps only the title's own pieces. The title is the Period ID with the most running time; ad pieces
   * (marked "adPeriodPattern") and anything else (Pluto promos, bumpers) are dropped, and the pieces
   * that are left are re-timed to follow each other. Returns { xml, removed }.
   */
  function pruneMpd(xml) {
    if (!/<MPD\b[^>]*\btype="static"/.test(xml)) return { xml: xml, removed: 0 }; // live channel
    var periods = xml.match(/<Period\b[\s\S]*?<\/Period>/g);
    if (!periods) {
      health('on-demand playlist has no <Period> pieces; check "manifestUrlPattern"');
      return { xml: xml, removed: 0 };
    }
    var idOf = function (p) { return ((/<Period\b[^>]*\bid="([^"-]+)/.exec(p) || [])[1] || ''); };
    var durOf = function (p) { return toSeconds((/<Period\b[^>]*\bduration="([^"]+)"/.exec(p) || [])[1]) || 0; };
    var total = {};
    periods.forEach(function (p) { total[idOf(p)] = (total[idOf(p)] || 0) + durOf(p); });
    var mainId = Object.keys(total).sort(function (a, b) { return total[b] - total[a]; })[0];
    var keep = periods.filter(function (p) { return !AD_PERIOD.test(p) && idOf(p) === mainId; });
    if (keep.length === periods.length || keep.length === 0) return { xml: xml, removed: 0 };

    var t = 0;
    var fixed = keep.map(function (p) {
      var d = durOf(p);
      var out = p.replace(/(<Period\b[^>]*\bstart=")[^"]+(")/, '$1' + toIso(t) + '$2');
      t += d;
      return out;
    });
    var first = periods[0], last = periods[periods.length - 1];
    var head = xml.slice(0, xml.indexOf(first)).replace(/mediaPresentationDuration="[^"]+"/, 'mediaPresentationDuration="' + toIso(t) + '"');
    var tail = xml.slice(xml.lastIndexOf(last) + last.length);
    return { xml: head + fixed.join('') + tail, removed: periods.length - keep.length };
  }
  api.pruneMpd = pruneMpd;

  // ---- Player schedule (session.json) ---------------------------------------------
  /** Drops the ad clips and ad breaks, and closes the gaps between the title's clips. Returns { text, ads }. */
  function pruneSession(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) {
      health('player schedule is not JSON; check "sessionUrlPattern"');
      return { text: text, ads: 0 };
    }
    if (!d || !Array.isArray(d.clips) || !Array.isArray(d.adBreaks)) {
      health('player schedule has no "clips"/"adBreaks"; Pluto changed its format');
      return { text: text, ads: 0 };
    }
    var ads = d.adBreaks.reduce(function (n, b) { return n + ((b && b.ads && b.ads.length) || 0); }, 0);
    var clips = d.clips.filter(function (c) { return c.type !== AD_CLIP; });
    if (!ads && clips.length === d.clips.length) return { text: text, ads: 0 };
    var t = clips.length ? Date.parse(clips[0].startTime) : NaN;
    if (!isNaN(t)) {
      clips.forEach(function (c) {
        var len = Date.parse(c.endTime) - Date.parse(c.startTime);
        c.startTime = new Date(t).toISOString();
        t += len;
        c.endTime = new Date(t).toISOString();
      });
    }
    d.clips = clips;
    d.adBreaks = [];
    return { text: JSON.stringify(d), ads: ads || (d.clips.length - clips.length) };
  }
  api.pruneSession = pruneSession;

  // ---- Counting -------------------------------------------------------------------
  var lastEpisode = null;
  function onManifest(url) {
    var m = String(url).match(EPISODE);
    var id = m ? m[1] : null; // page memory only; never sent out
    if (id && id !== lastEpisode) {
      lastEpisode = id;
      call(function (b) { b.videoStarted(); });
    }
  }

  /** Rewrites one response body, or returns null to leave it alone. */
  function rewrite(url, text) {
    if (MANIFEST.test(url)) {
      var r = pruneMpd(text);
      if (/<MPD\b[^>]*\btype="static"/.test(text)) onManifest(url);
      return r.removed ? r.xml : null;
    }
    if (SESSION.test(url)) {
      var s = pruneSession(text);
      if (s.ads) call(function (b) { b.adsPruned(s.ads); });
      return s.text !== text ? s.text : null;
    }
    return null;
  }
  api.rewrite = rewrite;
  function wanted(url) { return MANIFEST.test(url) || SESSION.test(url); }

  // ---- fetch (what Pluto's player uses) ---------------------------------------------
  if (window.fetch && window.Response) {
    var nativeFetch = window.fetch;
    window.fetch = function fetch(input) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var p = nativeFetch.apply(this, arguments);
      if (!wanted(url)) return p;
      return p.then(function (res) {
        if (!res.ok) return res;
        return res.clone().text().then(function (text) {
          var body = rewrite(url, text);
          if (body === null) return res;
          return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
        }, function () { return res; });
      });
    };
    try { window.fetch.toString = nativeFetch.toString.bind(nativeFetch); } catch (e) {}
  }

  // ---- XHR (in case the player switches to it) --------------------------------------
  if (window.XMLHttpRequest) {
    var XHR = XMLHttpRequest.prototype;
    var nativeOpen = XHR.open;
    var xhrs = new WeakMap(); // XHR -> { url, done }: kept out of sight of the page's own XHR objects
    XHR.open = function open(method, url) {
      if (wanted(String(url))) xhrs.set(this, { url: String(url), done: undefined });
      else xhrs.delete(this);
      return nativeOpen.apply(this, arguments);
    };
    try { XHR.open.toString = nativeOpen.toString.bind(nativeOpen); } catch (e) {}
    var respDesc = Object.getOwnPropertyDescriptor(XHR, 'response');
    var textDesc = Object.getOwnPropertyDescriptor(XHR, 'responseText');
    var rewritten = function (xhr) {
      var st = xhrs.get(xhr);
      if (!st || xhr.readyState !== 4 || xhr.status < 200 || xhr.status > 299) return null;
      if (st.done !== undefined) return st.done;
      var type = xhr.responseType, body = null;
      try { if (type === '' || type === 'text') body = rewrite(st.url, textDesc.get.call(xhr)); } catch (e) {}
      st.done = body;
      return body;
    };
    try {
      if (textDesc && textDesc.get) {
        Object.defineProperty(XHR, 'responseText', {
          configurable: true, enumerable: textDesc.enumerable,
          get: function () { var b = rewritten(this); return b !== null ? b : textDesc.get.call(this); }
        });
      }
      if (respDesc && respDesc.get) {
        Object.defineProperty(XHR, 'response', {
          configurable: true, enumerable: respDesc.enumerable,
          get: function () { var b = rewritten(this); return b !== null ? b : respDesc.get.call(this); }
        });
      }
    } catch (e) {}
  }
})();
