/*
 * Port of HealthMonitor.kt. Detects when YouTube has changed enough that rules.json needs revising.
 * The page scripts report problems; once a problem reaches its daily threshold it becomes an active
 * issue, and the extension flags it until the rules version changes. Stores problem codes and short
 * technical details only (selector/key names), never video IDs.
 */
import { dayOf } from './stats.js';

export const DEFAULT_THRESHOLD = 3;
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
const MAX_DETAILS = 5;
const MAX_DETAIL_CHARS = 200;

export const HINTS = {
  PLAYER_NOT_FOUND: 'The video player element wasn\'t found. Update "playerSelectors" (desktop section).',
  SKIP_FAILED: 'An ad kept playing after the skip attempt. Update "adClassNames" / "skipButtonSelectors".',
  AD_DATA_CHANGED: 'An ad played although ad data was stripped (or none was found). Update "adDataKeys" / "adUrls".',
  AD_UNDETECTED: 'Video data has new ad-like fields (listed below). Add them to "adDataKeys", or to "ignoreAdLikeKeys" if harmless.',
  SITE_CHANGED: 'YouTube showed its ad-blocker warning or refused the page. Update "enforcementSelectors" / "hideSelectors".',
};
export const CODES = Object.keys(HINTS);

const thresholdFor = (code) => (code === 'SITE_CHANGED' ? 1 : DEFAULT_THRESHOLD);

export class HealthMonitor {
  constructor(data, rulesVersion, clock = Date.now) {
    this.rulesVersion = rulesVersion;
    this.clock = clock;
    const o = data || {};
    this.day = typeof o.day === 'number' ? o.day : -1;
    this.today = { ...(o.today || {}) };
    this.totals = { ...(o.totals || {}) };
    this.details = {};
    Object.entries(o.details || {}).forEach(([k, v]) => { this.details[k] = [...v]; });
    this.active = new Set(o.active || []);
    this.snoozeUntil = o.snoozeUntil || 0;
    // A new rules version means you revised the rules: start over.
    if (o.version !== rulesVersion) this.clearAll();
  }

  /** Records one occurrence. Returns true when this makes [code] a newly active issue. */
  report(code, detail) {
    if (!CODES.includes(code)) return false;
    this.rollDay();
    const n = (this.today[code] || 0) + 1;
    this.today[code] = n;
    this.totals[code] = (this.totals[code] || 0) + 1;
    const list = (this.details[code] = this.details[code] || []);
    const d = String(detail || '').slice(0, MAX_DETAIL_CHARS);
    if (d && !list.includes(d)) {
      list.push(d);
      if (list.length > MAX_DETAILS) list.shift();
    }
    if (n >= thresholdFor(code) && !this.active.has(code)) {
      this.active.add(code);
      return true;
    }
    return false;
  }

  issues() {
    return [...this.active].sort().map((code) => ({
      code, total: this.totals[code] || 0, details: [...(this.details[code] || [])], hint: HINTS[code],
    }));
  }

  shouldPrompt() { return this.active.size > 0 && this.clock() >= this.snoozeUntil; }

  snooze(ms = SNOOZE_MS) { this.snoozeUntil = this.clock() + ms; }

  toJSON() {
    return {
      version: this.rulesVersion, day: this.day, today: this.today, totals: this.totals,
      details: this.details, active: [...this.active].sort(), snoozeUntil: this.snoozeUntil,
    };
  }

  rollDay() {
    const t = dayOf(this.clock());
    if (t !== this.day) {
      this.day = t;
      this.today = {};
    }
  }

  clearAll() {
    this.day = -1;
    this.today = {}; this.totals = {}; this.details = {}; this.active = new Set();
    this.snoozeUntil = 0;
  }
}
