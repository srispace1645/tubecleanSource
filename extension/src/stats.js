/*
 * Port of StatsStore.kt. The only thing TubeClean remembers: ad-block counts. For each of the last
 * 30 days it keeps how many videos were watched, how many ads were blocked in each one, and how
 * many ad/tracker requests were refused. No video IDs, titles, searches or timestamps finer than a
 * day are ever stored.
 *
 * Plain data in, plain data out (toJSON), so the service worker can keep it in chrome.storage.local
 * and the tests can run it in Node.
 */
export const WINDOW_DAYS = 30;
const DAY_MS = 86400000;

/** Local calendar day as a day number. */
export function dayOf(ms) {
  return Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / DAY_MS);
}

/** "Oct 4" for a day number. */
export function dayLabel(day) {
  return new Date(day * DAY_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function avgPerVideo(d) {
  return d.videos === 0 ? 0 : d.adsBlocked / d.videos;
}

function emptyDay(day) {
  return { day, videos: 0, adsBlocked: 0, requestsBlocked: 0, perVideo: [] };
}

export class StatsStore {
  /** [data]: what toJSON() returned last time, or nothing. */
  constructor(data, clock = Date.now) {
    this.clock = clock;
    this.days = new Map();
    try {
      ((data && data.days) || []).forEach((o) => {
        this.days.set(o.day, {
          day: o.day, videos: o.videos | 0, adsBlocked: o.ads | 0, requestsBlocked: o.requests | 0,
          perVideo: (o.perVideo || []).map((n) => n | 0),
        });
      });
    } catch (e) {
      this.days.clear(); // unreadable: start fresh
    }
    this.prune();
  }

  today() { return dayOf(this.clock()); }

  videoStarted() {
    const d = this.dayEntry();
    d.videos++;
    d.perVideo.push(0);
  }

  /** Adds [n] ads to the video playing now; [inVideo] false means no video was counted for it yet. */
  addAds(n, inVideo) {
    if (n <= 0) return;
    if (!inVideo) this.videoStarted();
    const d = this.dayEntry();
    // A video that started before midnight counts as a video of the new day too.
    if (d.perVideo.length === 0) { d.videos++; d.perVideo.push(0); }
    d.adsBlocked += n;
    d.perVideo[d.perVideo.length - 1] += n;
  }

  addBlockedRequests(n) {
    if (n > 0) this.dayEntry().requestsBlocked += n;
  }

  /** The last [n] days, oldest first, today last; days without data are zero-filled. */
  lastDays(n = WINDOW_DAYS) {
    const t = this.today();
    const out = [];
    for (let day = t - n + 1; day <= t; day++) out.push(structuredClone(this.days.get(day) || emptyDay(day)));
    return out;
  }

  todayStats() { return structuredClone(this.days.get(this.today()) || emptyDay(this.today())); }

  reset() { this.days.clear(); }

  toJSON() {
    this.prune();
    const days = [...this.days.values()].sort((a, b) => a.day - b.day).map((d) => ({
      day: d.day, videos: d.videos, ads: d.adsBlocked, requests: d.requestsBlocked, perVideo: d.perVideo,
    }));
    return { v: 1, days };
  }

  dayEntry() {
    const t = this.today();
    if (!this.days.has(t)) this.days.set(t, emptyDay(t));
    return this.days.get(t);
  }

  prune() {
    const oldest = this.today() - WINDOW_DAYS + 1;
    for (const day of [...this.days.keys()]) if (day < oldest) this.days.delete(day);
  }
}
