/*
 * Runs in the extension's isolated world: takes bridge calls posted by bridge-shim.js and hands them to
 * the service worker. Only known methods from this same window get through.
 */
(() => {
  const TYPE = 'tubeclean-bridge';
  const METHODS = new Set(['videoStarted', 'adsPruned', 'adSkipped', 'playing', 'health']);

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.type !== TYPE || !METHODS.has(d.method)) return;
    const args = Array.isArray(d.args) ? d.args.slice(0, 2) : [];
    try {
      chrome.runtime.sendMessage({ bridge: d.method, args }).catch(() => {});
    } catch (err) {
      // The extension was reloaded or removed; this page keeps its old scripts until it reloads.
    }
  });
})();
