/*
 * Tests for the Chrome extension's build and its ports of StatsStore.kt and HealthMonitor.kt.
 * Like AdBlockerTest.kt, they run against the real rules.json, so a bad revision fails here.
 *
 *   node --test tools/*.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveRules, dnrRules, urlFilter, chromeVersion } from './extension-lib.mjs';
import { StatsStore, dayOf, WINDOW_DAYS } from '../extension/src/stats.js';
import { HealthMonitor, SNOOZE_MS } from '../extension/src/health.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/src/main/assets/rules.json'), 'utf8'));
const desktop = effectiveRules(raw, 'desktop');

// A small model of declarativeNetRequest urlFilter matching for the patterns urlFilter() produces:
// "||" = start of the host or of a subdomain, "^" = a separator or the end.
function filterMatches(filter, url) {
  const u = new URL(url);
  const rest = u.host + u.pathname + u.search;
  const body = filter.slice(2);
  const sep = body.endsWith('^');
  const needle = sep ? body.slice(0, -1) : body;
  for (let i = 0; i <= u.host.length; i++) {
    if (i > 0 && u.host[i - 1] !== '.') continue;
    if (!rest.startsWith(needle, i)) continue;
    const next = rest[i + needle.length];
    if (!sep || next === undefined || /[^\w.%-]/.test(next)) return true;
  }
  return false;
}

/** The winning action for a request YouTube makes, as Chrome would pick it (highest priority, allow on ties). */
function verdict(url, type = 'xmlhttprequest') {
  const hits = dnrRules(desktop).filter((r) =>
    (r.condition.resourceTypes ? r.condition.resourceTypes.includes(type) : type !== 'main_frame') &&
    filterMatches(r.condition.urlFilter, url));
  if (!hits.length) return 'none';
  hits.sort((a, b) => b.priority - a.priority || (a.action.type === 'allow' ? -1 : 1));
  return hits[0].action.type;
}

test('desktop profile replaces the TV site and keeps the shared lists', () => {
  assert.equal(desktop.startUrl, 'https://www.youtube.com/');
  assert.deepEqual(desktop.userAgents, []);
  assert.deepEqual(desktop.guestFlow, {});
  assert.equal(desktop.phone, undefined);
  assert.equal(desktop.desktop, undefined);
  assert.deepEqual(desktop.adUrls, raw.adUrls);
  assert.deepEqual(desktop.adDataKeys, raw.adDataKeys);
  assert.ok(desktop.hideSelectors.includes('ytd-ad-slot-renderer'));
  assert.ok(desktop.enforcementSelectors.length > 0);
  const watch = new RegExp(desktop.watchRoutePattern);
  assert.equal('/watch?v=dQw4w9WgXcQ&t=1'.match(watch)[1], 'dQw4w9WgXcQ');
  assert.equal('/shorts/dQw4w9WgXcQ'.match(watch)[1], 'dQw4w9WgXcQ');
});

test('network rules block what AdBlocker.kt blocks', () => {
  assert.equal(verdict('https://www.youtube.com/api/stats/ads?ver=2'), 'block');
  assert.equal(verdict('https://www.youtube.com/pagead/viewthroughconversion/1'), 'block');
  assert.equal(verdict('https://googleads.g.doubleclick.net/pagead/id'), 'block');
  assert.equal(verdict('https://www.youtube.com/api/stats/watchtime?docid=x'), 'block');
  assert.equal(verdict('https://accounts.google.com/ServiceLogin?service=youtube', 'main_frame'), 'block');
  assert.equal(verdict('https://www.youtube.com/youtubei/v1/player'), 'none');
  assert.equal(verdict('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'main_frame'), 'none');
});

test('video streams are never blocked and query strings never cause a block', () => {
  assert.equal(verdict('https://rr1---sn-x.googlevideo.com/videoplayback?ref=doubleclick.net', 'media'), 'allow');
  assert.equal(verdict('https://www.youtube.com/results?search_query=doubleclick.net'), 'none');
  assert.equal(verdict('https://www.youtube.com/watch?v=x&next=youtube.com/pagead/'), 'none');
  assert.equal(verdict('https://notdoubleclick.net/x'), 'none');
});

test('every rule only touches requests made by YouTube, with unique ids', () => {
  const rules = dnrRules(desktop);
  assert.equal(rules.length, raw.neverBlock.length + raw.signInUrls.length + raw.adUrls.length + raw.trackerUrls.length);
  rules.forEach((r) => assert.deepEqual(r.condition.initiatorDomains, ['youtube.com']));
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
  assert.deepEqual(dnrRules(desktop), rules, 'same output on every build');
  assert.equal(urlFilter('doubleclick.net'), '||doubleclick.net^');
  assert.equal(urlFilter('youtube.com/pagead/'), '||youtube.com/pagead/');
});

test('Chrome version from versionName', () => {
  assert.equal(chromeVersion('1.1'), '1.1');
  assert.equal(chromeVersion('1.2-beta'), '1.2');
  assert.equal(chromeVersion('1.2.3.4.5'), '1.2.3.4');
});

// ---- StatsStore port (cases from StatsStoreTest.kt's behaviour) ----------------------
const DAY = 86400000;
const clockAt = (start) => { const c = () => c.now; c.now = start; return c; };

test('stats count videos and ads per video, and survive a save', () => {
  const clock = clockAt(Date.UTC(2026, 9, 4, 12));
  const s = new StatsStore(null, clock);
  s.videoStarted();
  s.addAds(2, true);
  s.addAds(1, true);
  s.videoStarted();
  s.addAds(0, true);
  const t = s.todayStats();
  assert.equal(t.videos, 2);
  assert.equal(t.adsBlocked, 3);
  assert.deepEqual(t.perVideo, [3, 0]);
  const again = new StatsStore(JSON.parse(JSON.stringify(s.toJSON())), clock);
  assert.deepEqual(again.todayStats(), t);
});

test('ads without a counted video start one, and a video spanning midnight counts on both days', () => {
  const clock = clockAt(Date.UTC(2026, 9, 4, 12));
  const s = new StatsStore(null, clock);
  s.addAds(1, false);
  assert.equal(s.todayStats().videos, 1);
  clock.now += DAY;
  s.addAds(2, true);
  assert.equal(s.todayStats().videos, 1);
  assert.deepEqual(s.todayStats().perVideo, [2]);
});

test('stats keep 30 days, zero-filled, today last', () => {
  const clock = clockAt(Date.UTC(2026, 9, 4, 12));
  const s = new StatsStore(null, clock);
  s.addBlockedRequests(5);
  clock.now += (WINDOW_DAYS - 1) * DAY;
  let days = s.lastDays();
  assert.equal(days.length, WINDOW_DAYS);
  assert.equal(days[0].requestsBlocked, 5);
  assert.equal(days[WINDOW_DAYS - 1].day, dayOf(clock.now));
  clock.now += DAY;
  days = s.lastDays();
  assert.equal(days[0].requestsBlocked, 0);
  assert.equal(s.toJSON().days.length, 0, 'old days are dropped');
});

// ---- HealthMonitor port (cases from HealthMonitorTest.kt's behaviour) ---------------
test('a problem becomes active after 3 reports in one day; SITE_CHANGED after 1', () => {
  const clock = clockAt(Date.UTC(2026, 9, 4, 12));
  const h = new HealthMonitor(null, 'v1', clock);
  assert.equal(h.report('SKIP_FAILED', 'a'), false);
  assert.equal(h.report('SKIP_FAILED', 'b'), false);
  assert.equal(h.report('SKIP_FAILED', 'b'), true);
  assert.equal(h.report('SKIP_FAILED', 'c'), false, 'only newly active once');
  assert.deepEqual(h.issues()[0].details, ['a', 'b', 'c']);
  assert.equal(h.report('SITE_CHANGED', 'warning'), true);
  assert.equal(h.report('NOT_A_CODE', 'x'), false);
});

test('reports on different days do not add up', () => {
  const clock = clockAt(Date.UTC(2026, 9, 4, 12));
  const h = new HealthMonitor(null, 'v1', clock);
  h.report('AD_DATA_CHANGED', '');
  h.report('AD_DATA_CHANGED', '');
  clock.now += DAY;
  assert.equal(h.report('AD_DATA_CHANGED', ''), false);
  assert.equal(h.issues().length, 0);
});

test('snooze hides the prompt for 24 h, and a new rules version clears everything', () => {
  const clock = clockAt(Date.UTC(2026, 9, 4, 12));
  const h = new HealthMonitor(null, 'v1', clock);
  h.report('SITE_CHANGED', '');
  assert.equal(h.shouldPrompt(), true);
  h.snooze();
  assert.equal(h.shouldPrompt(), false);
  clock.now += SNOOZE_MS;
  assert.equal(h.shouldPrompt(), true);
  const same = new HealthMonitor(JSON.parse(JSON.stringify(h.toJSON())), 'v1', clock);
  assert.equal(same.issues().length, 1);
  const revised = new HealthMonitor(h.toJSON(), 'v2', clock);
  assert.equal(revised.issues().length, 0);
});
