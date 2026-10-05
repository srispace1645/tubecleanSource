/*
 * TubeClean service worker: the extension's side of MainActivity.kt + PrivacyGuard.kt.
 *  - receives bridge calls from the page scripts (counts and problem codes only)
 *  - keeps the 30-day stats and the health monitor in chrome.storage.local
 *  - shows ads blocked in the current video on the toolbar badge ("!" when the rules need revising)
 *  - guest only: wipes YouTube's site data when the last YouTube tab closes and when Chrome starts,
 *    and keeps YouTube out of Chrome's history
 */
import { StatsStore } from './stats.js';
import { HealthMonitor } from './health.js';

const MAX_ADS_PER_EVENT = 50;
const YT_ORIGINS = ['https://www.youtube.com', 'https://m.youtube.com', 'https://youtube.com'];
const YT_TAB_PATTERNS = ['*://*.youtube.com/*', '*://youtube.com/*'];
const RULESET = 'tubeclean';
const TEAL = '#00897B';
const RED = '#D32F2F';

const isYouTube = (url) => {
  try {
    const host = new URL(url).hostname;
    return host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch (e) {
    return false;
  }
};

// ---- Build metadata ---------------------------------------------------------------
let metaPromise = null;
function meta() {
  if (!metaPromise) {
    metaPromise = Promise.all([
      fetch(chrome.runtime.getURL('meta.json')).then((r) => r.json()),
      fetch(chrome.runtime.getURL('dnr_rules.json')).then((r) => r.json()),
    ]).then(([m, rules]) => ({
      rulesVersion: m.rulesVersion,
      // Allow rules (neverBlock) match too; only refusals count as blocked requests.
      blockIds: new Set(rules.filter((r) => r.action.type === 'block').map((r) => r.id)),
    }));
  }
  return metaPromise;
}

// ---- State ------------------------------------------------------------------------
// The worker can stop at any time, so every change loads, edits and saves; the queue keeps changes in order.
let queue = Promise.resolve();
function withState(fn) {
  const run = queue.then(async () => {
    const { rulesVersion } = await meta();
    const local = await chrome.storage.local.get(['stats', 'health']);
    const session = await chrome.storage.session.get(['tabs']);
    const s = {
      stats: new StatsStore(local.stats),
      health: new HealthMonitor(local.health, rulesVersion),
      tabs: session.tabs || {}, // per tab: ads in the current video, and whether that video was counted
      rulesVersion,
    };
    const result = await fn(s);
    await chrome.storage.local.set({ stats: s.stats.toJSON(), health: s.health.toJSON() });
    await chrome.storage.session.set({ tabs: s.tabs });
    return result;
  });
  queue = run.catch((e) => console.warn('TubeClean:', e));
  return run;
}

function tabEntry(s, tabId) {
  return (s.tabs[tabId] = s.tabs[tabId] || { ads: 0, inVideo: false });
}

// ---- Badge ------------------------------------------------------------------------
function paintBadge(s, tabId) {
  const prompt = s.health.shouldPrompt();
  chrome.action.setBadgeBackgroundColor({ color: RED });
  chrome.action.setBadgeText({ text: prompt ? '!' : '' });
  if (tabId == null) return;
  const ads = (s.tabs[tabId] || {}).ads || 0;
  chrome.action.setBadgeBackgroundColor({ tabId, color: prompt ? RED : TEAL });
  chrome.action.setBadgeText({ tabId, text: ads ? String(ads) : prompt ? '!' : '' });
}

// ---- Bridge -----------------------------------------------------------------------
function onBridge(tabId, frameId, method, args) {
  withState((s) => {
    const tab = tabEntry(s, tabId);
    const addAds = (n) => {
      const count = Math.max(0, Math.min(MAX_ADS_PER_EVENT, n | 0));
      if (!count) return;
      s.stats.addAds(count, tab.inVideo);
      if (!tab.inVideo) tab.ads = 0;
      tab.inVideo = true;
      tab.ads += count;
    };
    switch (method) {
      case 'videoStarted':
        if (frameId !== 0) return;
        s.stats.videoStarted();
        tab.ads = 0;
        tab.inVideo = true;
        break;
      case 'adsPruned': addAds(args[0]); break;
      case 'adSkipped': addAds(1); break;
      case 'health':
        if (s.health.report(String(args[0]), String(args[1] || ''))) console.warn('TubeClean: rules need revision:', args[0]);
        break;
      default: return; // "playing": Chrome keeps the screen awake for video itself
    }
    paintBadge(s, tabId);
  });
  markYouTubeOpen();
}

// ---- Requests blocked -------------------------------------------------------------
// Unpacked installs (how TubeClean is shared) get every match as it happens; otherwise poll.
let pendingBlocked = 0, flushTimer = null;
function addBlocked(n) {
  if (n <= 0) return;
  pendingBlocked += n;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      const count = pendingBlocked;
      pendingBlocked = 0;
      flushTimer = null;
      withState((s) => s.stats.addBlockedRequests(count));
    }, 3000);
  }
}

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    const { blockIds } = await meta();
    if (info.rule.rulesetId === RULESET && blockIds.has(info.rule.ruleId)) addBlocked(1);
  });
}

async function pollBlocked() {
  if (chrome.declarativeNetRequest.onRuleMatchedDebug) return;
  const { lastMatchTs = 0 } = await chrome.storage.local.get('lastMatchTs');
  let info;
  try {
    info = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: lastMatchTs + 1 });
  } catch (e) {
    return; // rate-limited: the next poll picks these up
  }
  const { blockIds } = await meta();
  const matches = info.rulesMatchedInfo;
  const hits = matches.filter((m) => m.rule.rulesetId === RULESET && blockIds.has(m.rule.ruleId)).length;
  const newest = matches.reduce((t, m) => Math.max(t, m.timeStamp), lastMatchTs);
  await chrome.storage.local.set({ lastMatchTs: newest });
  addBlocked(hits);
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll-blocked') pollBlocked(); });

// ---- Guest only: wipe YouTube's site data ----------------------------------------
async function wipe(reason) {
  await chrome.browsingData.remove({ origins: YT_ORIGINS }, {
    cookies: true, localStorage: true, indexedDB: true, cacheStorage: true,
    serviceWorkers: true, cache: true, fileSystems: true,
  });
  console.info('TubeClean: wiped YouTube site data:', reason);
}

async function markYouTubeOpen() {
  const { ytOpen } = await chrome.storage.session.get('ytOpen');
  if (ytOpen) return;
  await chrome.storage.session.set({ ytOpen: true });
  chrome.alarms.create('poll-blocked', { periodInMinutes: 1 });
}

/** Called when a tab closes or leaves YouTube: once no YouTube tab is left, wipe. */
async function maybeWipe() {
  const { ytOpen } = await chrome.storage.session.get('ytOpen');
  if (!ytOpen) return;
  const left = await chrome.tabs.query({ url: YT_TAB_PATTERNS });
  if (left.length) return;
  await chrome.storage.session.set({ ytOpen: false });
  chrome.alarms.clear('poll-blocked');
  await pollBlocked();
  await wipe('last YouTube tab closed');
}

chrome.tabs.onRemoved.addListener((tabId) => {
  withState((s) => { delete s.tabs[tabId]; });
  maybeWipe();
});

// Without the "tabs" permission Chrome only shows URLs on YouTube (our host permission), so a tab that
// navigates elsewhere reports no URL at all: treat any navigation to a URL we can't see as leaving YouTube.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url && change.status !== 'loading') return;
  if (tab.url && isYouTube(tab.url)) {
    markYouTubeOpen();
    return;
  }
  withState((s) => {
    if (!s.tabs[tabId]) return;
    delete s.tabs[tabId]; // left YouTube: "this video" no longer applies
    paintBadge(s, tabId);
  });
  maybeWipe();
});

chrome.runtime.onStartup.addListener(() => wipe('Chrome started'));

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  await wipe('installed');
  // Anyone signed in to YouTube in Chrome is now signed out of YouTube (not of Google); the popup says so once.
  await chrome.storage.local.set({ installNotice: true });
});

// No watch or search history: YouTube pages leave Chrome's history as soon as they're added.
chrome.history.onVisited.addListener((item) => {
  if (isYouTube(item.url)) chrome.history.deleteUrl({ url: item.url });
});

// ---- Messages ---------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.bridge && sender.tab) {
    onBridge(sender.tab.id, sender.frameId, msg.bridge, Array.isArray(msg.args) ? msg.args : []);
    return;
  }
  if (msg.popup) {
    onPopup(msg).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true; // answer asynchronously
  }
});

async function onPopup(msg) {
  if (msg.popup === 'get') await pollBlocked();
  const { installNotice } = await chrome.storage.local.get('installNotice');
  if (msg.popup === 'dismissNotice') await chrome.storage.local.remove('installNotice');
  return withState((s) => {
    if (msg.popup === 'snooze') s.health.snooze();
    if (msg.popup === 'reset') s.stats.reset();
    paintBadge(s, msg.tabId);
    return {
      today: s.stats.todayStats(),
      month: s.stats.lastDays(),
      currentVideoAds: msg.tabId != null && s.tabs[msg.tabId] ? s.tabs[msg.tabId].ads : 0,
      issues: s.health.issues(),
      shouldPrompt: s.health.shouldPrompt(),
      rulesVersion: s.rulesVersion,
      installNotice: !!installNotice && msg.popup !== 'dismissNotice',
    };
  });
}
