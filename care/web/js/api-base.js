/* Band 39 · API base. In a browser the app calls its own server ("api/..."). Inside the iOS app the page is served from
 * the app bundle, so the native side sets window.B39_API_BASE (e.g. "https://<server>") before any script runs and
 * every "api/..." request goes there instead. Keys stay on that server. Without a base, nothing changes. */
(function () {
  'use strict';
  const base = (window.B39_API_BASE || '').replace(/\/+$/, '');
  if (!base) return;
  const raw = window.fetch.bind(window);
  window.fetch = (u, o) => {
    if (typeof u === 'string' && /^\/?api\//.test(u)) u = base + '/' + u.replace(/^\//, '');
    return raw(u, o);
  };
})();
