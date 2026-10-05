/*
 * Pure helpers for build-extension.mjs: turn the shared rules.json into what the Chrome extension
 * needs. Kept free of file access so tools/extension.test.mjs can check them directly.
 */

export const PROFILES = ['phone', 'desktop'];

/** Same merge as Rules.parse in the app: drop every profile section, then lay [profile] over the top level. */
export function effectiveRules(rules, profile) {
  const out = { ...rules };
  PROFILES.forEach((p) => delete out[p]);
  Object.assign(out, rules[profile] || {});
  return out;
}

// Network layer (AdBlocker.kt) as declarativeNetRequest rules. Priorities mirror classify():
// neverBlock wins over sign-in, which wins over ads and trackers.
const PRIORITY = { allow: 4, signIn: 3, ad: 2, tracker: 1 };
const ALL_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest',
  'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
];

/**
 * "doubleclick.net" -> "||doubleclick.net^" (the domain and its subdomains);
 * "youtube.com/pagead/" -> "||youtube.com/pagead/" (that path prefix on the domain and its subdomains).
 * The "||" anchor matches at the host only, so a query string can't cause a block, as in AdBlocker.hostAndPath.
 */
export function urlFilter(entry) {
  const e = entry.toLowerCase();
  return e.includes('/') ? `||${e}` : `||${e}^`;
}

/**
 * Only requests made by YouTube pages are touched, so the rest of Chrome is unaffected: Gmail and other
 * Google sign-ins keep working, and other sites' ads are left alone.
 */
export function dnrRules(rules) {
  const out = [];
  const add = (list, kind, action, resourceTypes) => {
    (list || []).forEach((entry) => {
      const condition = { urlFilter: urlFilter(entry), initiatorDomains: ['youtube.com'] };
      if (resourceTypes) condition.resourceTypes = resourceTypes;
      out.push({ id: out.length + 1, priority: PRIORITY[kind], action: { type: action }, condition });
    });
  };
  add(rules.neverBlock, 'allow', 'allow');
  // Sign-in also covers top-level navigation, e.g. the "Sign in" button: guest only.
  add(rules.signInUrls, 'signIn', 'block', ALL_TYPES);
  add(rules.adUrls, 'ad', 'block');
  add(rules.trackerUrls, 'tracker', 'block');
  return out;
}

/** Chrome wants 1-4 dot-separated integers: "1.1" stays, anything else is cut down to its digits. */
export function chromeVersion(versionName) {
  const parts = String(versionName).split('.').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
  return (parts.length ? parts : [0]).slice(0, 4).join('.');
}
