#!/usr/bin/env node
/*
 * Builds the TubeClean Chrome extension from the same rules.json and page scripts as the app, so a
 * rules revision fixes both. Writes:
 *   extension/dist/                          load this with chrome://extensions -> Load unpacked
 *   build/TubeClean-chrome-<version>.zip     the same files, for sharing (unzip, then Load unpacked)
 *
 *   node tools/build-extension.mjs
 *
 * The extension gets the rules' "desktop" section laid over the top level (see extension-lib.mjs).
 * Tubi and Pluto have their own rules, extension/tubi.json and pluto.json, since the app doesn't cover them.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { effectiveRules, dnrRules, siteBlockRules, chromeVersion, pageBundle } from './extension-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'app/src/main/assets');
const SRC = path.join(ROOT, 'extension');
const OUT = path.join(SRC, 'dist');
const RES = path.join(ROOT, 'app/src/main/res');

const read = (p) => fs.readFileSync(p, 'utf8');
const rules = effectiveRules(JSON.parse(read(path.join(ASSETS, 'rules.json'))), 'desktop');
const tubi = JSON.parse(read(path.join(SRC, 'tubi.json')));
const pluto = JSON.parse(read(path.join(SRC, 'pluto.json')));
const ytNetRules = dnrRules(rules);
const netRules = [...ytNetRules, ...siteBlockRules([tubi, pluto], ytNetRules.length)];
const versionName = (read(path.join(ROOT, 'app/build.gradle.kts')).match(/versionName\s*=\s*"([^"]+)"/) || [])[1] || '0';

fs.rmSync(OUT, { recursive: true, force: true });
const files = new Map(); // path inside the extension -> contents
const put = (name, data) => files.set(name, typeof data === 'string' ? Buffer.from(data) : data);

// Page scripts: one bundle per site, with the rules and the bridge kept inside it (see pageBundle).
const shared = (f) => [f, read(path.join(ASSETS, f))];
const own = (f) => [`src/${f}`, read(path.join(SRC, 'src', f))];
put('page-youtube.js', pageBundle('YouTube (rules.json, desktop profile)', { __TC_RULES: rules },
  [own('bridge-shim.js'), shared('prune.js'), shared('adskip.js'), own('enforcement.js')]));
put('page-tubi.js', pageBundle('Tubi', { __TC_TUBI: tubi }, [own('bridge-shim.js'), own('tubi.js')]));
put('page-pluto.js', pageBundle('Pluto TV', { __TC_PLUTO: pluto }, [own('bridge-shim.js'), own('pluto.js')]));
put('dnr_rules.json', JSON.stringify(netRules, null, 1));
// The health monitor starts over when either rules file gets a new version.
put('meta.json', JSON.stringify({ rulesVersion: `${rules.version} · tubi ${tubi.version} · pluto ${pluto.version}`, version: versionName }));

// Extension sources.
const PAGE_SCRIPTS = new Set(['bridge-shim.js', 'enforcement.js', 'tubi.js', 'pluto.js']);
for (const name of fs.readdirSync(path.join(SRC, 'src')).filter((n) => !PAGE_SCRIPTS.has(n))) put(`src/${name}`, fs.readFileSync(path.join(SRC, 'src', name)));
for (const name of ['popup.html', 'popup.css', 'popup.js']) put(name, fs.readFileSync(path.join(SRC, name)));
put('icons/icon16.png', fs.readFileSync(path.join(RES, 'mipmap-mdpi/ic_launcher.png')));
put('icons/icon48.png', fs.readFileSync(path.join(RES, 'mipmap-mdpi/ic_launcher.png')));
put('icons/icon128.png', fs.readFileSync(path.join(RES, 'mipmap-xxxhdpi/ic_launcher.png')));

const manifest = JSON.parse(read(path.join(SRC, 'manifest.json')));
const sites = {
  '<youtube>': rules.allowedHosts.map((h) => `https://${h}/*`),
  '<tubi>': tubi.hosts.map((h) => `https://${h}/*`),
  '<pluto>': pluto.hosts.map((h) => `https://${h}/*`),
};
manifest.version = chromeVersion(versionName);
manifest.version_name = `${versionName} (rules ${rules.version}, tubi ${tubi.version}, pluto ${pluto.version})`;
manifest.host_permissions = Object.values(sites).flat();
manifest.content_scripts.forEach((cs) => { cs.matches = cs.matches.flatMap((m) => sites[m] || [m]); });
put('manifest.json', JSON.stringify(manifest, null, 2));

for (const [name, data] of files) {
  fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true });
  fs.writeFileSync(path.join(OUT, name), data);
}

const zipPath = path.join(ROOT, 'build', `TubeClean-chrome-${versionName}.zip`);
fs.mkdirSync(path.dirname(zipPath), { recursive: true });
fs.writeFileSync(zipPath, zip(files));

console.log(`TubeClean ${versionName}, rules ${rules.version}, tubi ${tubi.version}, pluto ${pluto.version}: ${netRules.length} network rules`);
console.log(`  unpacked: ${path.relative(ROOT, OUT)}`);
console.log(`  zip:      ${path.relative(ROOT, zipPath)}`);

/** Minimal zip writer (deflate, no dependencies). */
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name);
    const body = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);           // version needed
    head.writeUInt16LE(0x0800, 6);       // UTF-8 names
    head.writeUInt16LE(8, 8);            // deflate
    head.writeUInt32LE(0x00210000, 10);  // 1980-01-01 00:00, so builds are byte-identical
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0x00210000, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}
