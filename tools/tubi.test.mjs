/*
 * Tests for the Tubi blocker (extension/src/tubi.js) against the real extension/tubi.json. The page
 * script runs in a sandbox with a fake bridge, and is fed ad-service answers shaped like Tubi's own
 * (Rainmaker's /v2/rev/vod: {"metadata": {...}, "items": [{"ad_id", "media": {"streamurl", ...}}]}).
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
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/tubi.json'), 'utf8'));
const script = fs.readFileSync(path.join(ROOT, 'extension/src/tubi.js'), 'utf8');

const AD_URL = 'https://rainmaker.production-public.tubi.io/v2/rev/vod/WEB?app_id=tubitv&content_id=100065059&now_pos=0';
const pod = (n) => ({
  version: 2,
  metadata: { logo: '', resultlength: n, resultduration: 30.0 * n, request_id: 'x' },
  items: Array.from({ length: n }, (_, i) => ({
    ad_id: `ad${i}`,
    media: { streamurl: `https://example.invalid/ad${i}.mp4`, duration: '30', trackingevents: {} },
    imptracking: [],
  })),
});

/** Loads tubi.js the way Chrome would (rules first), with a bridge that records calls. No XHR or fetch here. */
function load() {
  const calls = [];
  const bridge = {
    videoStarted: () => calls.push(['videoStarted']),
    adsPruned: (n) => calls.push(['adsPruned', n]),
    health: (code, detail) => calls.push(['health', code, detail]),
  };
  const window = { __TC_TUBI: rules, TubeCleanBridge: bridge };
  window.top = window;
  vm.runInNewContext(script, { window, JSON, RegExp, String, Array, Object });
  return { tc: window.__tcTubi, calls };
}

test('tubi.json is complete', () => {
  for (const key of ['version', 'hosts', 'adDecisionUrls', 'adListKey', 'adItemKeys']) assert.ok(rules[key], `tubi.json is missing ${key}`);
  assert.ok(rules.hosts.includes('tubitv.com'));
});

test('only Tubi ad-service requests are rewritten, matched on host and path', () => {
  const { tc } = load();
  assert.equal(tc.isAdDecision(AD_URL), true);
  assert.equal(tc.isAdDecision('https://rainmaker4.production-public.tubi.io/v2/rev/vod/WEB?x=1'), true);
  assert.equal(tc.isAdDecision('https://tubitv.com/movies/1?next=rainmaker.production-public.tubi.io/'), false);
  assert.equal(tc.isAdDecision('https://nc-fa.tubi.video/abc/scffpvsg.m3u8'), false);
  assert.equal(tc.isAdDecision('https://mcdn.tubitv.com/js/ads.js'), false, 'the ad-blocker bait is left alone');
});

test('an ad break comes back empty, with its summary zeroed', () => {
  const { tc } = load();
  const answer = pod(3);
  assert.equal(tc.pruneDecision(answer), 3);
  assert.deepEqual(answer.items, []);
  assert.equal(answer.metadata.resultlength, 0);
  assert.equal(answer.metadata.resultduration, 0);
  assert.equal(answer.metadata.request_id, 'x', 'other fields are kept');

  const r = tc.pruneText(JSON.stringify(pod(2)));
  assert.equal(r.ok, true);
  assert.equal(r.removed, 2);
  assert.deepEqual(JSON.parse(r.text).items, []);
});

test('an answer that already has no ads is fine and reports nothing', () => {
  const { tc, calls } = load();
  assert.equal(tc.pruneDecision(pod(0)), 0);
  assert.equal(tc.pruneText('').ok, false, '204 No Content');
  assert.deepEqual(calls, []);
});

test('a changed answer is left alone and flagged for revision', () => {
  const { tc, calls } = load();
  assert.equal(tc.pruneText('{"ads": []}').ok, false);
  assert.equal(tc.pruneText('<html>').ok, false);
  const codes = calls.map((c) => c[1]);
  assert.deepEqual(codes, ['TUBI_CHANGED', 'TUBI_CHANGED']);
  assert.match(calls[0][2], /adListKey/);

  // Entries that aren't recognisable ads are kept, and flagged.
  const answer = { items: [{ ad_id: 'a', media: {} }, { something: 'new' }] };
  assert.equal(tc.pruneDecision(answer), 1);
  assert.deepEqual(answer.items, [{ something: 'new' }]);
  assert.match(calls[2][2], /adItemKeys/);
});
