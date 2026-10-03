/*
 * Makes Android WebView answer YouTube TV's codec probes the way a real TV does.
 * YouTube TV calls MediaSource.isTypeSupported() with TV-only parameters (width=, eotf=,
 * channels=, ...) and deliberately impossible values (width=99999, eotf=catavision) to check the
 * device actually honours them. WebView ignores unknown parameters and says "yes" to everything,
 * so YouTube distrusts it and refuses playback ("This video format is not supported").
 * Here: reject impossible values, then ask WebView about the plain type/codec only.
 */
(function () {
  'use strict';
  if (window.__tcCompat || !window.MediaSource || !MediaSource.isTypeSupported) return;
  window.__tcCompat = true;

  var native = MediaSource.isTypeSupported.bind(MediaSource);
  var MAX = { width: 3840, height: 2160, framerate: 60, bitrate: 100000000, channels: 8 };
  var ALLOWED = {
    eotf: ['bt709', 'smpte2084', 'arib-std-b67'],
    cryptoblockformat: ['subsample'],
    'decode-to-texture': ['true', 'false'],
    experimental: ['allowed'],
    tunnelmode: ['false'] // WebView can't do tunnelled playback
  };

  function supported(type) {
    var parts = String(type).split(';').map(function (s) { return s.trim(); }).filter(Boolean);
    var keep = [parts[0]];
    for (var i = 1; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      var key = (eq === -1 ? parts[i] : parts[i].slice(0, eq)).trim().toLowerCase();
      var val = eq === -1 ? '' : parts[i].slice(eq + 1).trim().replace(/^"|"$/g, '').toLowerCase();
      if (key === 'codecs') { keep.push(parts[i]); continue; }
      if (key in MAX) {
        var n = parseFloat(val);
        if (!isFinite(n) || n > MAX[key]) return false;
      } else if (key in ALLOWED) {
        if (ALLOWED[key].indexOf(val) === -1) return false;
      }
      // Any other TV-only parameter is dropped before asking WebView.
    }
    return native(keep.join('; '));
  }

  try {
    Object.defineProperty(MediaSource, 'isTypeSupported', {
      configurable: true, writable: true,
      value: function isTypeSupported(type) { return supported(type); }
    });
  } catch (e) {
    MediaSource.isTypeSupported = function isTypeSupported(type) { return supported(type); };
  }
})();
