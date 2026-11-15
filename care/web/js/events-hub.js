/* One connection to the server's live events per page, shared by every module that asks for it.
 * live.js, watch.js and ask.js each open EventSource('api/live/events'). A browser allows only six connections
 * to one server across all tabs, and these never close: with the page in one tab and the deck's embedded copy in
 * another, all six were taken and nothing else got through (the band's sound stopped reaching the server).
 * This must load before those modules. */
(function () {
  'use strict';
  const Real = window.EventSource;
  if (typeof Real !== 'function') return;
  let shared = null;
  const subs = [];
  const each = (fn) => { for (const p of subs.slice()) { try { fn(p); } catch (e) { console.error(e); } } };
  function Hub(url, opts) {
    if (!/(^|\/)api\/live\/events/.test(String(url))) return new Real(url, opts);
    const p = { url: String(url), readyState: 1, withCredentials: false, onmessage: null, onerror: null, onopen: null, _l: {},
      addEventListener(type, fn) { (p._l[type] = p._l[type] || []).push(fn); },
      removeEventListener(type, fn) { p._l[type] = (p._l[type] || []).filter((f) => f !== fn); },
      close() { const i = subs.indexOf(p); if (i >= 0) subs.splice(i, 1); p.readyState = 2; } };
    subs.push(p);
    if (!shared) {
      shared = new Real(url, opts);
      shared.onmessage = (m) => each((s) => { if (s.onmessage) s.onmessage(m); (s._l.message || []).forEach((f) => f(m)); });
      shared.onerror = (e) => each((s) => { if (s.onerror) s.onerror(e); (s._l.error || []).forEach((f) => f(e)); });
      shared.onopen = (e) => each((s) => { if (s.onopen) s.onopen(e); (s._l.open || []).forEach((f) => f(e)); });
    }
    return p;
  }
  Hub.CONNECTING = 0; Hub.OPEN = 1; Hub.CLOSED = 2;
  window.EventSource = Hub;
})();
