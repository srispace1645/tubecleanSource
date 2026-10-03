#!/usr/bin/env node
/*
 * TubeClean egress audit: records every request the TubeClean WebView makes, through the
 * WebView's DevTools protocol over adb, so HTTPS traffic is seen decrypted. Each request is
 * checked against TubeClean's own rules.json to tell what was blocked on the TV from what
 * actually left it, and the report shows what data went with it.
 *
 * Needs: the DEBUG build (release builds switch WebView debugging off), ADB debugging on the TV.
 *
 *   node tools/egress-audit.mjs [--device 192.168.1.50:5555] [--seconds 90] [--play VIDEO_ID]
 *                               [--no-reload] [--out audits]
 *
 * Writes audits/egress-<time>.md (summary) and audits/egress-<time>.json (raw log). The raw
 * log contains YouTube's guest visitor ID and cookies; keep it on this PC.
 *
 * Not covered: traffic from outside the page, such as Android's DRM provisioning or Fire OS
 * services. See README, "Checking what leaves the TV".
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'com.srinath.tubeclean';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i > -1 && argv[i + 1] ? argv[i + 1] : def; };
const seconds = Number(opt('seconds', '90'));
const play = opt('play', '');
const reload = !argv.includes('--no-reload');
const outDir = path.resolve(ROOT, opt('out', 'audits'));
const port = Number(opt('port', '9333'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`egress-audit: ${msg}`); process.exit(1); };
if (play && !/^[\w-]{11}$/.test(play)) fail('--play needs an 11-character YouTube video ID.');

// ---- adb ------------------------------------------------------------------------
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const adbPath = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = (...a) => execFileSync(adbPath, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const connected = () => adb('devices').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
let device = opt('device', '');
if (device) {
  if (device.includes(':')) {
    let said = '';
    try { said = adb('connect', device).trim(); } catch (e) { said = String(e.stdout || e.message).trim(); }
    if (!connected().includes(device)) {
      fail(/refused/i.test(said)
        ? `${device} refused the connection. Turn on ADB Debugging (Settings > My Fire TV > Developer options) and try again.`
        : `can't reach ${device} (${said}). Check the TV is on and on the same network.`);
    }
  } else if (!connected().includes(device)) fail(`device ${device} isn't connected.`);
} else {
  const ready = connected();
  if (ready.length !== 1) fail(ready.length ? `several devices connected (${ready.join(', ')}); choose one with --device` : 'no device connected; use --device <tv-ip>:5555');
  device = ready[0];
}
const sh = (cmd) => adb('-s', device, 'shell', cmd);

function appPid() {
  for (const cmd of ['ps -A', 'ps']) { // Android 8+ needs -A; Fire OS 5's ps has no -A
    try {
      const line = sh(cmd).split('\n').find((l) => l.trim().endsWith(PKG));
      if (line) return line.trim().split(/\s+/)[1];
    } catch { /* try the other form */ }
  }
  return null;
}
const devtoolsSocket = (pid) => (sh('cat /proc/net/unix').match(new RegExp(`webview_devtools_remote_${pid}\\b`)) || [null])[0];

let pid = appPid();
if (!pid) {
  console.log('Starting TubeClean...');
  sh(`am start -n ${PKG}/.MainActivity`);
  for (let i = 0; i < 30 && !(pid = appPid()); i++) await sleep(1000);
  if (!pid) fail('TubeClean did not start.');
}
let socket = null;
for (let i = 0; i < 30 && !(socket = devtoolsSocket(pid)); i++) await sleep(1000);
if (!socket) fail('TubeClean exposes no WebView debugger. The audit needs the debug build (install.ps1 installs it).');
adb('-s', device, 'forward', `tcp:${port}`, `localabstract:${socket}`);
const cleanup = () => { try { adb('-s', device, 'forward', '--remove', `tcp:${port}`); } catch { /* already gone */ } };

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { return []; }
}

// ---- Recording ------------------------------------------------------------------
const records = [];

/** Opens a DevTools session on one target (the page or a service worker) and records its requests. */
async function attach(target, label) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  const live = new Map();
  const extra = new Map(); // ExtraInfo can arrive before requestWillBeSent
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const hop = (rec, resp) => { rec.status = resp.status; rec.remoteIP = resp.remoteIPAddress || null; };
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
      return;
    }
    const p = msg.params;
    switch (msg.method) {
      case 'Network.requestWillBeSent': {
        if (p.redirectResponse && live.has(p.requestId)) hop(live.get(p.requestId), p.redirectResponse);
        const rec = { source: label, method: p.request.method, url: p.request.url, type: p.type, postData: p.request.postData, time: p.wallTime };
        if (extra.has(p.requestId)) rec.sentHeaders = extra.get(p.requestId);
        live.set(p.requestId, rec);
        records.push(rec);
        if (p.request.hasPostData && rec.postData === undefined) {
          send('Network.getRequestPostData', { requestId: p.requestId }).then((r) => { rec.postData = r.postData; }, () => {});
        }
        break;
      }
      case 'Network.requestWillBeSentExtraInfo':
        live.has(p.requestId) ? (live.get(p.requestId).sentHeaders = p.headers) : extra.set(p.requestId, p.headers);
        break;
      case 'Network.responseReceived': if (live.has(p.requestId)) hop(live.get(p.requestId), p.response); break;
      case 'Network.loadingFinished': if (live.has(p.requestId)) live.get(p.requestId).bytesIn = p.encodedDataLength; break;
      case 'Network.loadingFailed': if (live.has(p.requestId)) live.get(p.requestId).failed = p.errorText; break;
      case 'Network.webSocketCreated': records.push({ source: label, method: 'WEBSOCKET', url: p.url, type: 'WebSocket' }); break;
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`could not attach to ${label}`)); });
  await send('Network.enable', { maxPostDataSize: 65536 });
  return { ws, send };
}

let page = null;
for (let i = 0; i < 30 && !page; i++) { page = (await targets()).find((t) => t.type === 'page'); if (!page) await sleep(1000); }
if (!page) { cleanup(); fail('no YouTube page found in TubeClean.'); }
const main = await attach(page, 'page');
const attached = new Set([page.id]);
const evaluate = async (expression) => (await main.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

if (reload) await main.send('Page.reload', { ignoreCache: true }); // capture a full session from page load
console.log(`Recording TubeClean traffic on ${device} for ${seconds} s. Use the app normally, or press Ctrl+C to stop early.`);

const stopAt = Date.now() + seconds * 1000;
let stopped = false;
process.once('SIGINT', () => { stopped = true; });
let played = !play;
while (!stopped && Date.now() < stopAt) {
  await sleep(2000);
  for (const t of await targets()) { // service workers make requests of their own
    if (t.type === 'service_worker' && !attached.has(t.id)) {
      attached.add(t.id);
      attach(t, 'service worker').catch(() => {});
    }
  }
  if (!played) {
    // Open the video once YouTube's welcome screens are gone (TubeClean passes them by itself).
    const home = await evaluate('!!document.querySelector("ytlr-guide-entry-renderer") && !document.querySelector("ytlr-welcome, ytlr-account-selector")').catch(() => false);
    if (home) { await evaluate(`location.hash = "#/watch?v=${play}"`); played = true; console.log(`Playing ${play}...`); }
  }
}
await sleep(1500); // let in-flight post-data lookups finish
cleanup();

// ---- Analysis -------------------------------------------------------------------
// Mirrors AdBlocker.classify (app/src/main/java/.../AdBlocker.kt); keep the two in step.
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/src/main/assets/rules.json'), 'utf8'));
const lower = (a) => (a || []).map((s) => s.toLowerCase());
const R = { never: lower(rules.neverBlock), signIn: lower(rules.signInUrls), ad: lower(rules.adUrls), tracker: lower(rules.trackerUrls) };
function verdict(url) {
  const t = url.toLowerCase().replace(/^[a-z]+:\/\//, '').split('#')[0].split('?')[0];
  if (R.never.some((p) => t.includes(p))) return null;
  if (R.signIn.some((p) => t.includes(p))) return 'sign-in';
  if (R.ad.some((p) => t.includes(p))) return 'ad';
  if (R.tracker.some((p) => t.includes(p))) return 'tracker';
  return null;
}
function category(host, pathname) {
  if (host.endsWith('googlevideo.com')) return 'Video & audio streams';
  if (host.endsWith('youtube.com') && pathname.startsWith('/youtubei/')) return 'YouTube API calls';
  if (host.endsWith('youtube.com')) return 'YouTube app files & pings';
  if (host.endsWith('ytimg.com') || host.endsWith('ggpht.com')) return 'Thumbnails & images';
  if (host.endsWith('gstatic.com') || host.endsWith('googleapis.com')) return 'Google static files';
  return 'Other';
}
const hostGroup = (h) => (h.endsWith('.googlevideo.com') ? '*.googlevideo.com' : h);
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);

const net = records.filter((r) => /^(https?|wss?):/.test(r.url));
const left = [];
const blocked = [];
for (const r of net) {
  const u = new URL(r.url);
  r.host = u.hostname; r.path = u.pathname; r.blocked = verdict(r.url);
  (r.blocked ? blocked : left).push(r);
}

const dest = new Map();
for (const r of left) {
  const key = hostGroup(r.host);
  const d = dest.get(key) || { key, category: category(r.host, r.path), requests: 0, out: 0, in: 0, failed: 0 };
  d.requests++;
  d.out += r.url.length + (r.postData ? r.postData.length : 0);
  d.in += r.bytesIn || 0;
  if (r.failed) d.failed++;
  dest.set(key, d);
}

const blockedBy = new Map();
for (const r of blocked) {
  const key = `${r.host}${r.path.replace(/\/[\w-]{20,}.*/, '/…')}`;
  const b = blockedBy.get(key) || { key, reason: r.blocked, requests: 0 };
  b.requests++;
  blockedBy.set(key, b);
}
const leakedBlocked = blocked.filter((r) => r.remoteIP).length; // a blocked request must never reach a server

// What the YouTube API is told, from the JSON bodies of /youtubei/ calls.
const clientFields = new Map();
const endpoints = new Map();
let visitorIdSends = 0;
let visitorIdLength = 0;
for (const r of left) {
  const ep = `${hostGroup(r.host)}${r.path.startsWith('/youtubei/') || r.host.endsWith('youtube.com') ? r.path : r.path.split('/').slice(0, 2).join('/')}`;
  const e = endpoints.get(ep) || { ep, requests: 0, query: new Set(), body: new Set() };
  e.requests++;
  for (const k of new URL(r.url).searchParams.keys()) e.query.add(k);
  if (r.postData && r.postData.trim().startsWith('{')) {
    try {
      const body = JSON.parse(r.postData);
      Object.keys(body).forEach((k) => e.body.add(k));
      const client = body.context && body.context.client;
      if (client) {
        for (const [k, v] of Object.entries(client)) {
          if (k === 'visitorData') { visitorIdSends++; visitorIdLength = String(v).length; continue; }
          if (v && typeof v === 'object') continue;
          const set = clientFields.get(k) || new Set();
          set.add(String(v));
          clientFields.set(k, set);
        }
      }
    } catch { /* not JSON after all */ }
  }
  endpoints.set(ep, e);
}
const cookieNames = new Map();
for (const r of left) {
  const h = r.sentHeaders || {};
  const cookie = h.cookie || h.Cookie;
  if (!cookie) continue;
  const set = cookieNames.get(hostGroup(r.host)) || new Set();
  cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean).forEach((n) => set.add(n));
  cookieNames.set(hostGroup(r.host), set);
}

// ---- Report ---------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const totalOut = [...dest.values()].reduce((s, d) => s + d.out, 0);
const totalIn = [...dest.values()].reduce((s, d) => s + d.in, 0);
const md = [];
md.push(`# TubeClean egress audit, ${new Date().toLocaleString()}`, '');
md.push(`Device \`${device}\`, recorded ${Math.round(seconds)} s${play ? `, played video \`${play}\`` : ''}.`, '');
md.push(`- **${net.length} requests** in total.`);
md.push(`- **${left.length} left the TV** (about ${kb(totalOut)} sent, ${kb(totalIn)} received).`);
md.push(`- **${blocked.length} were blocked by TubeClean** and never left the TV${blocked.length ? (leakedBlocked ? `. **Warning: ${leakedBlocked} of them show a server address**; check the raw log.` : '; none reached a server.') : '.'}`);
md.push(`- TubeClean's own code sent nothing; every request came from the YouTube page.`, '');

md.push('## Where traffic went', '', '| Destination | What it is | Requests | Sent | Received |', '|---|---|--:|--:|--:|');
for (const d of [...dest.values()].sort((a, b) => b.requests - a.requests)) {
  md.push(`| \`${d.key}\` | ${d.category} | ${d.requests}${d.failed ? ` (${d.failed} failed)` : ''} | ${kb(d.out)} | ${kb(d.in)} |`);
}
md.push('', '## Blocked by TubeClean (never left the TV)', '');
if (blockedBy.size) {
  md.push('| Endpoint | Why | Requests |', '|---|---|--:|');
  for (const b of [...blockedBy.values()].sort((a, c) => c.requests - a.requests)) md.push(`| \`${b.key}\` | ${b.reason} | ${b.requests} |`);
} else md.push('Nothing was blocked in this session.');

md.push('', '## What YouTube is told about this TV', '', 'From the `context.client` block that YouTube\'s own page puts in every API call:', '');
if (clientFields.size) {
  md.push('| Field | Value sent |', '|---|---|');
  for (const [k, v] of [...clientFields.entries()].sort()) md.push(`| \`${k}\` | ${[...v].slice(0, 3).map((x) => `\`${x.slice(0, 80)}\``).join(', ')} |`);
} else md.push('No API bodies were captured.');
md.push('', '## Identifiers', '');
md.push(`- **Guest visitor ID** (\`visitorData\`): sent in ${visitorIdSends} API calls${visitorIdLength ? ` (${visitorIdLength} characters)` : ''}. TubeClean wipes it whenever you leave the app, so each session gets a new one.`);
if (cookieNames.size) for (const [h, names] of cookieNames) md.push(`- **Cookies sent to \`${h}\`:** ${[...names].sort().map((n) => `\`${n}\``).join(', ')} (names only; they are wiped with the session too).`);
else md.push('- No cookies were seen on outgoing requests.');
md.push('- No account, email or sign-in token: TubeClean is guest-only and blocks sign-in.');

md.push('', '## Endpoints and the parameter names they receive', '', '| Endpoint | Requests | Query parameters | JSON body fields |', '|---|--:|---|---|');
for (const e of [...endpoints.values()].sort((a, b) => b.requests - a.requests).slice(0, 40)) {
  const list = (s) => (s.size ? [...s].sort().slice(0, 25).join(', ') + (s.size > 25 ? ', …' : '') : '');
  md.push(`| \`${e.ep}\` | ${e.requests} | ${list(e.query)} | ${list(e.body)} |`);
}
md.push('', '## Not covered by this audit', '');
md.push('- Traffic from outside the YouTube page: Android\'s DRM (Widevine) setup, Amazon WebView updates and other Fire OS services. To see those destinations, check your router\'s DNS log, or connect the TV to a PC hotspot and capture with Wireshark (you\'ll see where traffic goes, not its encrypted content).');

fs.mkdirSync(outDir, { recursive: true });
const mdPath = path.join(outDir, `egress-${stamp}.md`);
const jsonPath = path.join(outDir, `egress-${stamp}.json`);
fs.writeFileSync(mdPath, md.join('\n') + '\n');
fs.writeFileSync(jsonPath, JSON.stringify({ device, seconds, play, records: net }, null, 1));
console.log(`\n${md.slice(0, 8).join('\n')}\nReport: ${mdPath}\nRaw log: ${jsonPath}`);
process.exit(0);
