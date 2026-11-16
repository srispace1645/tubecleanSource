/*
 * Tests for the Pluto TV blocker (extension/src/pluto.js) against the real extension/pluto.json. The page
 * script runs in a sandbox with a fake bridge, and is fed playlists and player schedules shaped like
 * Pluto's own (an on-demand title split into pieces, with ad pieces in between).
 *
 *   node --test tools/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/pluto.json'), 'utf8'));
const script = fs.readFileSync(path.join(ROOT, 'extension/src/pluto.js'), 'utf8');

const MOVIE = '5e741e8c7255220014470098';
const MPD_URL = 'https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/dash/episode/5e741e8e72552200144700a0/main.mpd?includeExtendedEvents=true';
const SESSION_URL = 'https://ipv4.pluto.tv/api/tn/video/playout//v3/session.json?clientTime=1792603230';

const period = (id, start, dur, ad) =>
  `<Period id="${id}-17926032" duration="PT${dur}S" start="PT${start}S"><BaseURL>https://siloh-ns1.plutotv.net/${ad ? 'stitch_ad%2Fcreative' : 'content'}/x/</BaseURL></Period>`;
const mpd = (type, periods) =>
  `<?xml version="1.0"?><MPD type="${type}" mediaPresentationDuration="PT1000S">${periods.join('')}</MPD>`;
// 900 s of movie in three pieces, two 30 s ads after the first piece, a 10 s Pluto promo after the second.
const onDemand = mpd('static', [
  period(MOVIE, 0, 300), period('6abe04f195c6802a64fab65e', 300, 30, true), period('69d99c20740d897ed48525dd', 330, 30, true),
  period(MOVIE, 360, 300), period('promo0000000000000000000', 660, 10), period(MOVIE, 670, 300),
]);

const iso = (s) => new Date(Date.UTC(2026, 10, 15, 12) + s * 1000).toISOString();
const session = () => ({
  id: 'x',
  clips: [
    { type: 'clip', name: 'The Movie', startTime: iso(0), endTime: iso(300) },
    { type: 'creative', startTime: iso(300), endTime: iso(330) },
    { type: 'creative', startTime: iso(330), endTime: iso(360) },
    { type: 'clip', name: 'The Movie', startTime: iso(360), endTime: iso(660) },
  ],
  adBreaks: [{ startOffset: 300, adBreakDuration: 60, ads: [{}, {}] }],
  streamInfo: {},
});

function load() {
  const calls = [];
  const bridge = {
    videoStarted: () => calls.push(['videoStarted']),
    adsPruned: (n) => calls.push(['adsPruned', n]),
    health: (code, detail) => calls.push(['health', code, detail]),
  };
  const window = { __TC_PLUTO: rules, TubeCleanBridge: bridge };
  vm.runInNewContext(script, { window, JSON, RegExp, String, Array, Object, Date, isNaN });
  return { tc: window.__tcPluto, calls };
}

test('pluto.json is complete', () => {
  for (const key of ['version', 'hosts', 'manifestUrlPattern', 'sessionUrlPattern', 'adPeriodPattern', 'blockDomains']) {
    assert.ok(rules[key], `pluto.json is missing ${key}`);
  }
  assert.ok(new RegExp(rules.manifestUrlPattern, 'i').test(MPD_URL));
  assert.ok(new RegExp(rules.sessionUrlPattern, 'i').test(SESSION_URL));
});

test('an on-demand playlist keeps only the title, re-timed end to end', () => {
  const { tc } = load();
  const { xml, removed } = tc.pruneMpd(onDemand);
  assert.equal(removed, 3, 'two ads and a promo');
  assert.doesNotMatch(xml, /ad%2Fcreative|promo/);
  const starts = [...xml.matchAll(/<Period\b[^>]*\bstart="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(starts, ['PT0.000S', 'PT300.000S', 'PT600.000S']);
  assert.match(xml, /mediaPresentationDuration="PT900.000S"/);
  assert.match(xml, /^<\?xml version="1.0"\?><MPD type="static"/, 'the header is kept');
});

test('live channels are left alone', () => {
  const { tc, calls } = load();
  const live = mpd('dynamic', [period(MOVIE, 0, 300), period('6abe04f195c6802a64fab65e', 300, 30, true)]);
  assert.equal(tc.pruneMpd(live).removed, 0);
  assert.equal(tc.rewrite(MPD_URL, live), null);
  assert.deepEqual(calls, []);
});

test('the player schedule loses its ad breaks and counts the ads', () => {
  const { tc, calls } = load();
  const out = JSON.parse(tc.rewrite(SESSION_URL, JSON.stringify(session())));
  assert.deepEqual(out.adBreaks, []);
  assert.deepEqual(out.clips.map((c) => c.type), ['clip', 'clip']);
  assert.equal(out.clips[1].startTime, iso(300), 'the second piece now follows the first');
  assert.equal(out.clips[1].endTime, iso(600));
  assert.deepEqual(calls, [['adsPruned', 2]]);
});

test('a new title counts as a video once', () => {
  const { tc, calls } = load();
  assert.ok(tc.rewrite(MPD_URL, onDemand));
  tc.rewrite(MPD_URL, onDemand); // the player fetches the playlist again
  assert.deepEqual(calls, [['videoStarted']]);
});

test('a changed schedule is left alone and flagged for revision', () => {
  const { tc, calls } = load();
  const changed = JSON.stringify({ items: [] });
  assert.equal(tc.rewrite(SESSION_URL, changed), null);
  assert.equal(tc.rewrite(SESSION_URL, '<html>'), null);
  assert.deepEqual(calls.map((c) => c[1]), ['PLUTO_CHANGED', 'PLUTO_CHANGED']);
});
