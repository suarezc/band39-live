/* Band 39 care · scam and fall alerts heard in the live transcript (Lisa's side).
 * The server's watcher (server/watch.py) judges the last 45 s of the transcript and sends
 * {type:'alert', kind:'scam'|'help', ...} on api/live/events. This turns each one into a care-engine alert:
 * key 'scam' (money.js freezes Mom's card on it) or 'heard-help'. Adds nothing to app.js.
 */
(function () {
  'use strict';
  const care = window.VexoCare;
  const state = (window.VexoWatch = { alerts: [] });
  if (!care || !care.engine || typeof window.EventSource !== 'function') return;
  const engine = care.engine;
  const seen = new Set();

  function body(a) {
    const text = String(a.text || '').trim();
    const quote = String(a.quote || '').trim();
    return quote ? text + ' Heard: “' + quote + '”' : text;
  }

  function onAlert(a) {
    if (!a || a.type !== 'alert' || a.id == null || seen.has(String(a.id))) return;
    seen.add(String(a.id));
    if (a.kind === 'scam') engine.raise('urgent', 'Possible scam call', body(a), 'scam');
    else if (a.kind === 'help') engine.raise('urgent', 'Possible fall or call for help', body(a), 'heard-help');
    else return;
    state.alerts.push(a);
  }

  const es = new window.EventSource('api/live/events');
  es.onmessage = (m) => {
    let ev;
    try { ev = JSON.parse(m.data); } catch (e) { return; }
    if (ev && ev.type === 'alert') onAlert(ev);
  };
  state.handle = onAlert;
})();
