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
    else if (ev && ev.type === 'final') onSpoken(ev);
  };

  // A spoken answer to "did you fall?". A fixed rule on the wearer's own matched voice, not a model's judgement:
  // only a clear "I'm okay / I'm fine / I didn't fall" from Mom's voice closes the check; "help", "I can't get up"
  // or "I'm not okay" from her escalates at once. Other voices, and phrases the voice model is unsure about, change nothing.
  const NOT_OK = /\bnot\s+(?:okay|ok|fine|all ?right|alright|good)\b|\bcan(?:'|’)?t\s+get\s+up\b|\bi(?:'|’)?m\s+hurt\b|\bcall\s+(?:lisa|an ambulance|911|for help)\b/i;
  const NO_HELP = /\b(?:don(?:'|’)?t|do not|no)\s+(?:need\s+)?(?:any\s+)?help\b|\bdon(?:'|’)?t\s+call\b/i;
  const OK = /\b(?:i(?:'|’)?m|i am)\s+(?:okay|ok|fine|all ?right|alright|good|alive)\b|\bi\s+didn(?:'|’)?t\s+fall\b|\bnothing\s+hurts\b|\bdon(?:'|’)?t\s+call\b/i;
  function onSpoken(ev) {
    if (ev.voice !== 'main' || !ev.text) return;
    const active = care.engine.state.active || {};
    if (!active.fall && !active.help && !active.checkin) return;
    const text = String(ev.text);
    const wantsHelp = NOT_OK.test(text) || (/\bhelp\b/i.test(text) && !NO_HELP.test(text));
    if (wantsHelp) { if (active.fall || active.checkin) care.engine.userAction('help', 'she said so'); return; }
    if (OK.test(text)) {
      care.engine.userAction('ok', 'by voice');
      const heard = care.engine.state.alerts.find((x) => x.key === 'heard-help' && !x.ack);
      if (heard) { care.engine.ack(heard.id); care.engine.note('💚', 'Mom then said she is OK (by voice). Worth a call to check.', 'good'); }
    }
  }
  state.handle = onAlert;
  state.spoken = onSpoken;
})();
