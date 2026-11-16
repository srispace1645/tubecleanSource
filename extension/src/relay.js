/*
 * Runs in the extension's isolated world: takes bridge calls from bridge-shim.js and hands them to the
 * service worker. The calls come over a private link (see bridge-shim.js) that is only accepted while
 * the page is still empty, before any of the site's own scripts can run, so the site can't fake them.
 * Only known methods get through.
 */
(() => {
  const METHODS = new Set(['videoStarted', 'adsPruned', 'adSkipped', 'playing', 'health']);
  let link = null;

  const onCall = (e) => {
    let d;
    try { d = JSON.parse(typeof e.detail === 'string' ? e.detail : ''); } catch (err) { return; }
    if (!d || !METHODS.has(d.method)) return;
    const args = Array.isArray(d.args) ? d.args.slice(0, 2) : [];
    try {
      chrome.runtime.sendMessage({ bridge: d.method, args }).catch(() => {});
    } catch (err) {
      // The extension was reloaded or removed; this page keeps its old scripts until it reloads.
    }
  };

  const onHello = (e) => {
    const t = e.relatedTarget;
    if (link || !(t instanceof Element) || t.isConnected) return;
    // A page script could only send this once it runs, and by then the page has a <script>.
    if (document.querySelector('script')) return;
    link = t;
    document.removeEventListener('tubeclean-hello', onHello, true);
    link.addEventListener('tubeclean-call', onCall);
    link.dispatchEvent(new CustomEvent('tubeclean-ack'));
  };

  document.addEventListener('tubeclean-hello', onHello, true);
  document.dispatchEvent(new CustomEvent('tubeclean-ready'));
  // Nothing linked by the time the page is parsed: stop listening, so the site can't link in later.
  document.addEventListener('DOMContentLoaded', () => document.removeEventListener('tubeclean-hello', onHello, true), { once: true });
})();
