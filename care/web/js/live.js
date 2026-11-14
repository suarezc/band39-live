/* Band 39 care · Live transcript for Lisa.
 * Streams the band's microphone (Opus packets) to the server in ~200 ms batches; the server sends
 * the words back over Server-Sent Events, each finished phrase labelled with the person who said it
 * (Mom, Voice 2, ... or a name given here). A search box looks over everything written down so far.
 * Batch framing: [u16 LE seq][u16 LE byte length][packet bytes], repeated. One request in flight.
 * All server and band text goes in with textContent: transcripts are untrusted.
 */
(function (root) {
  'use strict';
  const care = root.VexoCare;
  const carer = document.querySelector('.carer');
  if (!care || !carer) return;

  const VOICE = { main: 'Mom', other: 'Someone else', unsure: 'Not sure', unknown: 'Voice not learned' };
  const BATCH_MS = 200, WATCHDOG_MS = 2500, POLL_MS = 1000, RETRY_MS = 5000;
  const PREF_KEY = 'band39-live-always-on';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const clock = (at) => (at ? new Date(at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(1)} kB`);

  // "Always on" preference. Storage can be missing or throw (private window, blocked site data):
  // then the preference lives only as long as the page.
  let alwaysOn = false;
  try { alwaysOn = root.localStorage.getItem(PREF_KEY) === '1'; } catch (_) { /* no storage */ }
  function setAlwaysOn(on) {
    alwaysOn = !!on;
    try { if (alwaysOn) root.localStorage.setItem(PREF_KEY, '1'); else root.localStorage.removeItem(PREF_KEY); } catch (_) { /* no storage */ }
  }

  const api = {};
  function getBand() { return Object.prototype.hasOwnProperty.call(api, '_bandForTest') ? api._bandForTest : care.band; }

  async function call(path, opts) {
    const r = await fetch(path, opts);
    let body = null; try { body = await r.json(); } catch (_) { /* not JSON */ }
    if (!r.ok) throw new Error((body && body.error) || `Server said ${r.status}`);
    if (body && body.error) throw new Error(body.error);
    return body;
  }

  // ---- the block ------------------------------------------------------------------------------
  const wrap = el('div', 'block live-tx'); wrap.setAttribute('aria-label', 'Live transcript');
  const head = el('div', 'lt-head');
  const title = el('div', 'h', 'Live transcript');
  const state = el('span', 'lt-state'); const dot = el('i', 'lt-dot'); const stateText = el('span', '', 'Off'); state.append(dot, stateText);
  state.setAttribute('role', 'status');
  const toggle = button('pill violet lt-toggle', 'Start listening');
  const left = el('div', 'lt-title'); left.append(title, state);
  head.append(left, toggle);
  const always = el('p', 'fine lt-always', 'Always on: listening starts by itself whenever the band is connected.');
  const hint = el('p', 'fine lt-hint', 'Connect band 39 (or the pretend band) first');
  const notice = el('p', 'lt-notice', 'Listening. Everything the band’s microphone hears is sent to Deepgram to be written down. Tell the people near the band.');
  notice.hidden = true;
  const counts = el('p', 'fine lt-counts'); counts.hidden = true;
  const err = el('p', 'lt-err'); err.hidden = true; err.setAttribute('role', 'alert');
  const strip = el('div', 'lt-people'); strip.setAttribute('role', 'group'); strip.setAttribute('aria-label', 'Voices heard: pick one to show only their lines'); strip.hidden = true;
  const list = el('ol', 'lt-list'); list.setAttribute('aria-label', 'What was said, newest at the bottom');
  const empty = el('li', 'lt-empty fine', 'Nothing written down yet.');
  const interim = el('p', 'lt-interim'); interim.hidden = true; interim.setAttribute('aria-live', 'polite');
  const voiceRow = el('div', 'lt-voice'); const voiceText = el('span', 'fine'); const forget = button('pill ghost lt-small', 'Forget voice');
  voiceRow.append(voiceText, forget);
  const search = el('div', 'lt-search');
  const sRow = el('div', 'lt-srow');
  const q = el('input'); q.type = 'search'; q.placeholder = 'Search what was said'; q.setAttribute('aria-label', 'Search the transcript');
  const who = el('select'); who.setAttribute('aria-label', 'Whose words');
  for (const [v, label] of [['', 'Anyone'], ['main', 'Mom'], ['other', 'Someone else']]) { const o = el('option', '', label); o.value = v; who.append(o); }
  sRow.append(q, who);
  const results = el('ul', 'lt-results'); results.setAttribute('aria-live', 'polite');
  search.append(sRow, results);
  wrap.append(head, always, hint, notice, counts, err, strip, list, interim, voiceRow, search);
  list.append(empty);

  const anchor = document.querySelector('.carer .scores') || document.querySelector('.carer .cg-head');
  if (anchor) anchor.after(wrap); else carer.append(wrap);

  // ---- the one-line strip at the top of the page (visible on both tabs, at any width) ---------
  const top = button('lt-top', ''); top.setAttribute('aria-label', 'Live transcript: show it');
  const topState = el('span', 'lt-state'); const topDot = el('i', 'lt-dot'); const topStateText = el('span', '', 'Off'); topState.append(topDot, topStateText);
  const topText = el('span', 'lt-top-text', 'Nothing heard yet');
  top.append(el('span', 'lt-top-h', 'Live'), topState, topText);
  {
    const connBtn = document.getElementById('lvConnect');
    const conn = connBtn && (connBtn.closest('.conn') || connBtn.closest('.card'));
    const mainEl = document.querySelector('main');
    if (conn) conn.after(top); else if (mainEl) mainEl.prepend(top); else document.body.prepend(top);
  }
  top.onclick = () => {
    const tabs = document.querySelector('.tabs'); const lisaTab = tabs && tabs.querySelector('button[data-tab="lisa"]');
    const tabbed = tabs && root.getComputedStyle && root.getComputedStyle(tabs).display !== 'none';
    if (tabbed && lisaTab && lisaTab.getAttribute('aria-selected') !== 'true') lisaTab.click();   // app.js switches the tab
    if (typeof wrap.scrollIntoView === 'function') wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  let lastFinal = null;            // the newest finished phrase, for the top strip
  function renderTop() {
    const live = interim.textContent;
    topText.classList.toggle('interim', !!live);
    if (live) topText.textContent = live;
    else if (lastFinal) topText.textContent = `${chip(lastFinal).textContent}: ${lastFinal.text || ''}`;
    else topText.textContent = 'Nothing heard yet';
  }

  // ---- state ----------------------------------------------------------------------------------
  let unavailable = null;        // error text when the server has no live feature (503)
  let status = null;
  let listening = false, boundBand = null, offAudio = null, startedAt = 0, lastPacketAt = 0, reviving = false;
  let queue = [], inFlight = null, sendError = '', batchTimer = null;
  let statusKnown = false, stopping = null, autoFailed = false, autoNextAt = 0;
  // this session's counters: a session starts with Start (or the first automatic start on a page),
  // carries on across automatic resumes after the band drops out, and ends with Stop
  let session = null;             // { ms: listened before the current stretch, bytes }

  function render() {
    const band = getBand();
    const canStart = !unavailable && (listening || !!band);
    const armed = listening || (alwaysOn && !unavailable);   // Stop shows while always-on is waiting too
    toggle.disabled = !(canStart || armed);
    toggle.textContent = armed ? 'Stop' : 'Start listening';
    toggle.classList.toggle('violet', !armed); toggle.classList.toggle('dark', armed);
    always.hidden = !alwaysOn || !!unavailable;
    hint.hidden = listening || !!band || !!unavailable || alwaysOn;
    notice.hidden = !listening;
    let txt, level;
    if (unavailable) { txt = unavailable; level = 'err'; }
    else if (listening) { txt = `Listening · ${mmss((Date.now() - startedAt) / 1000)}`; level = sendError ? 'warn' : 'on'; }
    else if (alwaysOn && !band) { txt = 'Waiting for the band…'; level = 'wait'; }
    else if (alwaysOn && autoFailed) { txt = `Couldn’t start · trying again in ${Math.max(1, Math.ceil((autoNextAt - Date.now()) / 1000))} s`; level = 'warn'; }
    else if (alwaysOn) { txt = 'Starting…'; level = 'wait'; }
    else { txt = 'Off'; level = ''; }
    counts.hidden = !session;
    if (session) {
      const ms = session.ms + (listening ? Date.now() - startedAt : 0);
      const n = status && typeof status.phrases === 'number' ? status.phrases : rows.size;
      counts.textContent = `This session: ${mmss(ms / 1000)} listened · ${size(session.bytes)} of sound sent · ${n} phrase${n === 1 ? '' : 's'} stored`;
    }
    stateText.textContent = txt; state.dataset.level = level;
    topState.dataset.level = level;
    topStateText.textContent = unavailable ? 'Not available' : listening ? 'Listening' : (alwaysOn && !band) ? 'Waiting for the band…'
      : (alwaysOn && autoFailed) ? 'Couldn’t start' : alwaysOn ? 'Starting…' : 'Off';
    err.textContent = sendError; err.hidden = !sendError;
    voiceText.textContent = status && status.main_voice ? `Mom’s voice: ${status.main_voice}` : 'No main voice learned yet: the first long phrase is used, or press This is Mom on a line';
    forget.disabled = !!unavailable || !(status && status.main_voice);
    q.disabled = who.disabled = !!unavailable;
  }

  // ---- transcript list ------------------------------------------------------------------------
  const rows = new Map();
  // The chip names the person (text, never colour alone); a tint per person; "?" when only Deepgram's speaker number said who.
  function chip(p) {
    if (p && p.person_id != null && isStray(p.person_id) && !expanded) {
      const c = el('span', 'lt-chip', 'Another voice' + (p.inferred ? ' ?' : '')); c.dataset.voice = 'stray';
      c.title = 'A voice heard only once or twice (often a shout or two people at once). Show all voices to see which.';
      return c;
    }
    if (p && p.person_id != null && p.person) {
      const c = el('span', 'lt-chip', p.person + (p.inferred ? ' ?' : ''));
      c.dataset.voice = p.voice === 'main' ? 'main' : 'person'; c.dataset.tint = String(p.person_id % 6);
      if (p.inferred) c.title = 'Inferred: the line was too short to recognise the voice, so it goes with the speaker heard just before or after';
      return c;
    }
    const v = p && VOICE[p.voice] ? p.voice : 'unknown'; const c = el('span', 'lt-chip', VOICE[v]); c.dataset.voice = v; return c;
  }
  let people = [], only = null;          // the people heard so far; only: a person id to show alone
  let expanded = false;                  // the Voices strip shows the stray voices too
  const shown = (li) => only == null || li.dataset.person === String(only);
  const personOf = (id) => people.find((x) => String(x.id) === String(id));
  const isNamed = (x) => (x.named != null ? !!x.named : !/^Voice \d+$/.test(x.name || ''));
  // a stray: an unnamed voice with only 1-2 lines (a shout, or two people at once filed as someone new)
  const strayP = (x) => !!x && x.kind !== 'main' && !isNamed(x) && (x.phrases || 0) < 3;
  const isStray = (id) => strayP(personOf(id));
  const isMainRow = (p) => { const x = personOf(p.person_id); return x ? x.kind === 'main' : p.voice === 'main'; };
  const heardPeople = () => people.filter((x) => x.phrases > 0 || x.kind === 'main');
  // "Same as…": fold this line's person into another one (never offered for the main person)
  function fillMerge(sel, pid) {
    if (document.activeElement === sel) return;
    sel.textContent = ''; const first = el('option', '', 'Same as…'); first.value = ''; sel.append(first);
    for (const x of heardPeople()) if (String(x.id) !== String(pid)) { const o = el('option', '', x.name); o.value = String(x.id); sel.append(o); }
    sel.value = ''; sel.hidden = sel.options.length < 2;
  }
  function freshen(li) {
    const p = li._p; if (!p) return;
    const c = li.querySelector('.lt-chip'); if (c) c.replaceWith(chip(p));
    const sel = li.querySelector('.lt-merge');
    if (sel) { if (isMainRow(p)) sel.hidden = true; else fillMerge(sel, p.person_id); }
  }
  function meta(p) {
    const bits = [clock(p.at)];
    if (p.match != null) bits.push(`match ${Math.round(p.match * 100)}%`);
    if (p.inferred) bits.push('who: from the speaker before or after');
    if (p.loud_db != null) bits.push(`${Math.round(p.loud_db)} dB`);
    return bits.filter(Boolean).join(' · ');
  }
  function row(p) {
    const li = el('li', 'lt-row'); li.dataset.id = p.id; li.dataset.person = p.person_id == null ? '' : String(p.person_id);
    const body = el('div', 'lt-body'); body.append(el('span', 'lt-text', p.text || ''), el('span', 'lt-meta', meta(p)));
    const mom = button('lt-mom', 'This is Mom'); const rowErr = el('span', 'lt-rowerr'); rowErr.hidden = true;
    mom.onclick = async () => {
      mom.disabled = true; rowErr.hidden = true;
      try { await call('api/live/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [p.id] }) }); refreshStatus(); }
      catch (e) { rowErr.textContent = e.message; rowErr.hidden = false; }
      finally { mom.disabled = false; }
    };
    const side = el('div', 'lt-side'); side.append(mom);
    if (p.person_id != null) {
      const name = button('lt-mom lt-name', 'Name this voice'); side.append(name);
      name.onclick = () => {
        const box = el('form', 'lt-rename'); const input = el('input'); input.type = 'text'; input.maxLength = 40; input.value = p.voice === 'main' && p.person === 'Mom' ? '' : (p.person || '');
        input.setAttribute('aria-label', 'Name for this voice'); input.placeholder = 'Name';
        const save = button('lt-mom', 'Save'); save.type = 'submit'; const cancel = button('lt-mom', 'Cancel');
        box.append(input, save, cancel); name.replaceWith(box); input.focus();
        const close = () => box.replaceWith(name);
        cancel.onclick = close;
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
        box.onsubmit = async (e) => {
          e.preventDefault(); save.disabled = true; rowErr.hidden = true;
          try { await call('api/live/person', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.person_id, name: input.value.trim() }) }); close(); loadPeople(); loadTranscript(); }
          catch (er) { rowErr.textContent = er.message; rowErr.hidden = false; save.disabled = false; }
        };
      };
      const merge = el('select', 'lt-merge'); merge.setAttribute('aria-label', 'Same voice as another person: put this voice’s lines under them');
      fillMerge(merge, p.person_id); if (isMainRow(p)) merge.hidden = true;
      merge.onchange = async () => {
        const into = merge.value; if (!into) return;
        merge.disabled = true; rowErr.hidden = true;
        try { await call('api/live/person', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.person_id, merge_into: Number(into) }) }); loadPeople(); loadTranscript(); }
        catch (er) { rowErr.textContent = er.message; rowErr.hidden = false; merge.value = ''; }
        finally { merge.disabled = false; }
      };
      side.append(merge);
    }
    side.append(rowErr);
    li._p = p;
    li.append(chip(p), body, side);
    li.hidden = !shown(li);
    return li;
  }
  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  function addPhrase(p, stick) {
    if (p == null || p.id == null) return;
    const follow = stick != null ? stick : atBottom();
    const li = row(p); const old = rows.get(p.id);
    if (old) old.replaceWith(li); else list.append(li);
    rows.set(p.id, li); empty.remove();
    if (follow) list.scrollTop = list.scrollHeight;
  }
  async function loadTranscript() {
    try {
      const r = await call('api/live/transcript?limit=60');
      const follow = atBottom() || !rows.size;
      for (const li of rows.values()) li.remove(); rows.clear();
      const ps = (r && r.phrases) || [];
      if (!ps.length) list.append(empty);
      for (const p of ps) addPhrase(p, false);
      if (follow) list.scrollTop = list.scrollHeight;
      lastFinal = ps.length ? ps[ps.length - 1] : null; renderTop();
    } catch (e) { if (!unavailable) { empty.textContent = `Could not load the transcript: ${e.message}`; list.append(empty); } }
  }

  // ---- status and events ----------------------------------------------------------------------
  async function refreshStatus() {
    try {
      const r = await fetch('api/live/status'); let body = null; try { body = await r.json(); } catch (_) { /* */ }
      statusKnown = true;
      if (r.status === 503 || (!r.ok && body && body.error)) { unavailable = (body && body.error) || 'Live transcript is not available'; }
      else if (r.ok && body) { unavailable = null; status = body; }
    } catch (e) { unavailable = unavailable || null; statusKnown = true; }
    render();
  }
  let es = null;
  function openEvents() {
    if (typeof root.EventSource !== 'function' || es) return;
    es = new root.EventSource('api/live/events');
    es.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch (_) { return; }
      if (!d || !d.type) return;
      if (d.type === 'status') { status = d; render(); }
      else if (d.type === 'interim') { interim.textContent = d.text || ''; interim.hidden = !d.text; renderTop(); }
      else if (d.type === 'final') { interim.textContent = ''; interim.hidden = true; addPhrase(d); if (d.id != null) lastFinal = d; renderTop(); peopleSoon(); }
      else if (d.type === 'relabel') { loadTranscript(); refreshStatus(); loadPeople(); }
      else if (d.type === 'people') loadPeople();
    };
  }

  // ---- streaming ------------------------------------------------------------------------------
  function frame(pkts) {
    let n = 0; for (const p of pkts) n += 4 + p.opus.length;
    const out = new Uint8Array(n); const v = new DataView(out.buffer); let o = 0;
    for (const p of pkts) { v.setUint16(o, p.seq & 0xffff, true); v.setUint16(o + 2, p.opus.length, true); out.set(p.opus, o + 4); o += 4 + p.opus.length; }
    return out;
  }
  function onAudio(a) {
    if (!listening || !a || !a.opus) return;
    lastPacketAt = Date.now();
    queue.push({ seq: a.seq, opus: a.opus instanceof Uint8Array ? a.opus : new Uint8Array(a.opus) });
  }
  function flush() {
    if (inFlight || !queue.length) return inFlight;
    const pkts = queue; queue = [];
    inFlight = (async () => {
      try {
        const body = frame(pkts);
        const r = await fetch('api/live/audio', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
        if (!r.ok) { let b = null; try { b = await r.json(); } catch (_) { /* */ } throw new Error((b && b.error) || `Server said ${r.status}`); }
        if (session) session.bytes += body.byteLength;
        sendError = '';
      } catch (e) { sendError = `Couldn’t send sound: ${e.message || e}. Still trying.`; }
      finally { inFlight = null; render(); }
      if (listening && queue.length) flush();
    })();
    return inFlight;
  }
  async function revive(b) {
    if (reviving) return; reviving = true; lastPacketAt = Date.now();
    try { await b.configure({ audio: true }); } catch (_) { /* try again next tick */ }
    finally { reviving = false; }
  }
  function tick() {
    if (!listening) return;
    const b = getBand();
    if (!b || b !== boundBand) { stop(alwaysOn ? undefined : 'The band disconnected, so listening stopped.'); return; }
    if (Date.now() - lastPacketAt > WATCHDOG_MS) revive(b);     // e.g. "Talk to Lisa" turned the mic off
  }

  async function start(opts) {
    if (listening || unavailable) return false;
    const b = getBand(); if (!b) { render(); return false; }
    if (!(opts && opts.resume && session)) session = { ms: 0, bytes: 0 };
    listening = true; boundBand = b; startedAt = lastPacketAt = Date.now(); sendError = ''; queue = [];
    offAudio = b.on('audio', onAudio);
    render();
    try { await b.configure({ audio: true }); }
    catch (e) { await stop(`The band would not turn its microphone on: ${e.message || e}`); render(); return false; }
    batchTimer = setInterval(() => { flush(); tick(); }, BATCH_MS);
    return true;
  }
  function stop(reason) {
    if (!listening) return stopping || Promise.resolve();
    stopping = doStop(reason).finally(() => { stopping = null; });
    return stopping;
  }
  async function doStop(reason) {
    listening = false; clearInterval(batchTimer); batchTimer = null;
    if (session) session.ms += Date.now() - startedAt;
    if (offAudio) { try { offAudio(); } catch (_) { /* */ } offAudio = null; }
    const b = boundBand; boundBand = null;
    render();
    if (b && getBand() === b) { try { await b.configure({ audio: false }); } catch (_) { /* link gone */ } }
    try { if (inFlight) await inFlight; if (queue.length) await flush(); } catch (_) { /* reported */ }
    queue = [];
    try { const s = await call('api/live/stop', { method: 'POST' }); if (s && s.type === 'status') status = s; sendError = typeof reason === 'string' ? reason : ''; }
    catch (e) { sendError = typeof reason === 'string' ? reason : `Couldn’t tell the server to stop: ${e.message}`; }
    interim.textContent = ''; interim.hidden = true; renderTop();
    render();
  }

  // While always-on is set: start whenever a band is connected and we are not listening (not while
  // the server says the feature is unavailable). A failed start is retried at most every RETRY_MS.
  let autoBusy = false;
  async function autoTick() {
    if (!alwaysOn || listening || unavailable || !statusKnown || stopping || autoBusy || !getBand()) return;
    if (Date.now() < autoNextAt) return;
    autoBusy = true;
    try {
      const ok = await start({ resume: true });
      autoFailed = !ok && alwaysOn && !listening;
      if (autoFailed) autoNextAt = Date.now() + RETRY_MS;
    } finally { autoBusy = false; render(); }
  }

  toggle.onclick = () => {
    if (listening || alwaysOn) { setAlwaysOn(false); autoFailed = false; autoNextAt = 0; sendError = ''; render(); return stop(); }
    setAlwaysOn(true); autoNextAt = Date.now() + RETRY_MS;   // the poll must not race this click
    return start().then((ok) => { if (ok) autoNextAt = 0; else if (alwaysOn) autoFailed = true; render(); return ok; });
  };
  forget.onclick = async () => {
    forget.disabled = true;
    try { await call('api/live/forget', { method: 'POST' }); } catch (e) { sendError = e.message; }
    await refreshStatus(); loadTranscript();
  };

  // ---- the voices heard: one pill each; a pill shows only that person's lines --------------------
  function filter(id) {
    only = id; for (const li of rows.values()) li.hidden = !shown(li);
    for (const b of strip.querySelectorAll('.lt-pill')) b.setAttribute('aria-pressed', String(b.dataset.person === String(only)));
  }
  function renderPeople() {
    strip.textContent = '';
    const heard = heardPeople();
    const kept = heard.filter((p) => !strayP(p)), strays = heard.filter(strayP);
    if (!strays.length) expanded = false;
    if (!expanded && only != null && isStray(only)) only = null;
    strip.hidden = !heard.length;
    for (const p of expanded ? kept.concat(strays) : kept) {
      const b = button('lt-pill', ''); b.dataset.person = String(p.id); b.dataset.tint = String(p.id % 6); if (p.kind === 'main') b.dataset.voice = 'main';
      b.append(el('b', '', p.name), el('span', '', ` · ${p.phrases} line${p.phrases === 1 ? '' : 's'}`));
      b.setAttribute('aria-pressed', String(String(p.id) === String(only)));
      b.onclick = () => filter(String(p.id) === String(only) ? null : p.id);
      strip.append(b);
    }
    if (strays.length) {
      const more = button('lt-pill lt-more', expanded ? 'Show fewer' : `+${strays.length} other${strays.length === 1 ? '' : 's'}`);
      more.setAttribute('aria-expanded', String(expanded));
      if (!expanded) more.title = 'Voices heard only once or twice, often a shout or two people talking at once';
      more.onclick = () => { expanded = !expanded; renderPeople(); const m = strip.querySelector('.lt-more'); if (m) m.focus(); };
      strip.append(more);
    }
    if (only != null && !people.some((p) => String(p.id) === String(only))) only = null;
    filter(only);
    for (const li of rows.values()) freshen(li);
    renderTop();
    // the search filter: anyone, or one of the people in the tidy strip (falls back to Mom / someone else while no one is known)
    const keep = who.value; who.textContent = '';
    const opts = kept.length ? [['', 'Anyone'], ...kept.map((p) => ['p:' + p.id, p.name])] : [['', 'Anyone'], ['main', 'Mom'], ['other', 'Someone else']];
    for (const [v, label] of opts) { const o = el('option', '', label); o.value = v; who.append(o); }
    who.value = opts.some(([v]) => v === keep) ? keep : '';
  }
  let pSeq = 0, pTimer = null;
  async function loadPeople() {
    const mine = ++pSeq;
    try { const r = await call('api/live/people'); if (mine === pSeq && r && Array.isArray(r.people)) { people = r.people; renderPeople(); } }
    catch (_) { /* the strip stays as it was */ }
  }
  function peopleSoon() { clearTimeout(pTimer); pTimer = setTimeout(loadPeople, 600); }

  // ---- search ---------------------------------------------------------------------------------
  let sTimer = null, sSeq = 0;
  async function runSearch() {
    clearTimeout(sTimer);
    const text = q.value.trim(); const mine = ++sSeq;
    results.textContent = '';
    if (!text) return;
    try {
      const f = who.value.startsWith('p:') ? '&person=' + who.value.slice(2) : who.value ? '&voice=' + who.value : '';
      const r = await call(`api/live/search?q=${encodeURIComponent(text)}${f}&limit=8`);
      if (mine !== sSeq) return;
      results.textContent = '';
      const hits = (r && r.hits) || [];
      if (!hits.length) { results.append(el('li', 'fine lt-none', 'Nothing found.')); return; }
      for (const h of hits) {
        const li = el('li', 'lt-hit'); const body = el('div', 'lt-body');
        const how = [h.word_rank != null ? `words #${h.word_rank}` : '', h.meaning_rank != null ? `meaning #${h.meaning_rank}` : '', clock(h.at)].filter(Boolean).join(' · ');
        body.append(el('span', 'lt-text', h.text || ''), el('span', 'lt-meta', how));
        li.append(chip(h), body); results.append(li);
      }
    } catch (e) { if (mine === sSeq) { results.textContent = ''; results.append(el('li', 'lt-rowerr', `Search failed: ${e.message}`)); } }
  }
  q.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 300); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  who.addEventListener('change', runSearch);

  // ---- go -------------------------------------------------------------------------------------
  setInterval(() => { render(); autoTick(); }, POLL_MS);
  render();
  refreshStatus().then(() => { if (!unavailable) { loadTranscript(); loadPeople(); openEvents(); } autoTick(); });

  api.start = start; api.stop = stop;
  Object.defineProperty(api, 'listening', { get() { return listening; }, enumerable: true });
  api._frame = frame;
  root.VexoLiveTranscript = api;
})(typeof window !== 'undefined' ? window : globalThis);
