/* Band 39 care app: Margaret's screen + Lisa's app, live from the Vexo Open band.
 * band events → motion lab (7 labels) + care engine (prompts, light, alerts)
 * Margaret's voice → band mic → /api/transcribe (Deepgram) → /api/analyze (OpenAI) → insights
 * /api/tts (ElevenLabs) reads to Margaret · /api/checkout (Stripe) · /api/doctor
 * Keys never reach this page.
 */
(function () {
  'use strict';
  const BAND = 39;                                    // our band only: Vexo-HACK-39
  const BAND_NAME = 'Vexo-HACK-' + String(BAND).padStart(2, '0');
  const KIT = new URL('vexo-open-kit/js/src/index.js', document.baseURI).href;
  const SAMPLE_VOICE = new URL('vexo-open-kit/dashboard/speech/sample-speech.opus', document.baseURI).href;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { createEngine, atToday, fmtTime } = window.VexoLive;
  const { createMotionLab, SIGNALS } = window.VexoMotion;
  const { CONDITIONS, ELIG, forConditions } = window.VexoCatalog;
  const root = $('live');

  // ---- clock: real time, or "pretend it's 2 am" (same speed, shifted) ----------------------
  let offset = 0;
  const clock = { scene: () => Date.now() + offset, real: () => Date.now() };
  const engine = createEngine(clock);
  const lab = createMotionLab(clock);
  let cfg = {};
  fetch('api/config').then((r) => r.json()).then((c) => { cfg = c; renderAll(); }).catch(() => { cfg = { offline: true }; });

  // ---- state from motion + voice -----------------------------------------------------------
  const conditions = new Map();                      // condition → detail for doctor/shop
  const insightsLog = [];                            // analyses of voice notes
  const transcripts = [];
  let banner = null;                                 // Margaret-side prompt from voice analysis (scam warning, reminder, tip)
  function addCondition(key, detail) { conditions.set(key, Object.assign({ at: clock.scene() }, conditions.get(key) || {}, detail)); renderAll(); }

  lab.on((type, d) => {
    const now = clock.scene();
    if (type === 'fall') { engine.ingest({ type: 'free-fall' }); addCondition('fall', { time: fmtTime(now), g: d.stages.impactG }); engine.note('📉', `Fall pattern: impact ${d.stages.impactG} g${d.stages.still ? ', then still' : ''}${d.stages.turnedDeg > 45 ? `, wrist turned ${d.stages.turnedDeg}°` : ''}`, 'safety'); }
    if (type === 'seizure') {
      engine.raise('urgent', 'Seizure-like movement', `Rhythmic ${d.hz} Hz shaking for ${d.seconds}+ seconds at ${fmtTime(now)}. Call Mom now; if she doesn’t answer, call 911. Not a diagnosis.`, 'seizure');
      addCondition('seizure', { hz: d.hz, s: d.seconds, time: fmtTime(now) }); banner = { kind: 'seizure', title: 'Lisa is being called', body: 'Your band noticed strong shaking. Help is on the way. Stay where you are if you can.' };
    }
    if (type === 'tremor' && d.score >= 2) { addCondition('tremor', { hz: d.hz, score: d.score }); }
    if (type === 'balance' && d.score != null && d.score < 55 && lab.labels.balance.walkWindows > 3) addCondition('balance', { score: d.score });
    if (type === 'sleep' && d.restless >= 30 && d.epochs >= 6) addCondition('sleep', { pct: d.restless });
    if (type === 'wander') addCondition('wander', { n: lab.labels.wander.episodes, min: Math.round(d.minutes) });
    renderAll();
  });
  engine.subscribe(() => { renderAll(); applyLed(); });

  // ---- band connection ---------------------------------------------------------------------
  let kit = null, band = null, sim = null, kind = 'none', busy = false, lastLedKey = '', ledBusy = false, micOn = false;
  async function loadKit() { if (!kit) kit = await import(KIT); return kit; }
  function setConn(text, level) { const el = $('lvConnState'); el.textContent = text; el.dataset.level = level || ''; }

  async function connect(which) {
    if (busy) return; busy = true; renderConn();
    try {
      await disconnect(true);
      const k = await loadKit();
      if (which === 'ble') {
        setConn(`Looking for ${BAND_NAME}… pick it in the list`, 'wait');
        band = await k.Band.connect(BAND, window.VexoNativeBle ? { transport: new window.VexoNativeBle.NativeBleTransport(BAND), autoReconnect: true } : { autoReconnect: true });
        kind = 'ble';
      } else {
        let audioPackets;
        try { audioPackets = k.oggPackets(new Uint8Array(await (await fetch(SAMPLE_VOICE)).arrayBuffer())); } catch (_) { /* no sample voice */ }
        sim = new k.SimTransport(BAND, { autoTap: false, audioPackets });
        band = await k.Band.connect(BAND, { transport: sim, autoReconnect: true });
        kind = 'sim'; sim.setActivity('still'); sim.playMotion(SIGNALS.rest());
      }
      wire(band);
      await band.setMotion({ accelRange: 8 });       // falls hit harder than 2 g: don't clip the impact
      await band.configure({ events: true, activity: true, battery: true, temperature: true, motion: 50, link: true });
      engine.state.connected = true;
      engine.ingest({ type: 'connect', transport: kind, name: band.name });
      lastLedKey = ''; applyLed();
      setConn(kind === 'ble' ? `Connected to ${band.name}` : `Pretend ${BAND_NAME} (kit simulator)`, 'ok');
    } catch (e) {
      band = sim = null; kind = 'none';
      setConn(location.protocol === 'file:' ? 'Open this page through the server (python3 server/server.py), not as a file.' : (e.message || String(e)), 'err');
    } finally { busy = false; renderConn(); }
  }
  async function disconnect(quiet) {
    const b = band; band = sim = null; kind = 'none'; micOn = false;
    if (b) { try { await b.disconnect(); } catch (_) { /* gone */ } }
    if (!quiet) { engine.ingest({ type: 'disconnect', reason: 'closed' }); setConn('Not connected', ''); renderConn(); }
  }
  function wire(b) {
    for (const g of ['tap', 'double-tap', 'tilt', 'orientation', 'motion-start', 'motion-stop']) b.on(g, () => engine.ingest({ type: g }));
    b.on('free-fall', () => lab.event('free-fall'));            // the lab decides if it was a fall
    b.on('motion', (m) => lab.push({ t: m.t, ax: m.ax, ay: m.ay, az: m.az, gx: m.gx, gy: m.gy, gz: m.gz }));
    b.on('activity', (a) => { lab.activity(a); engine.ingest({ type: 'activity', state: a.state, steps: a.steps, cadence: a.cadence, motion: a.motion }); });
    b.on('battery', (e) => engine.ingest({ type: 'battery', percent: e.percent, state: e.state }));
    b.on('temperature', (e) => engine.ingest({ type: 'temperature', celsius: e.celsius }));
    b.on('link', (e) => { lab.link(e.rssi); engine.ingest({ type: 'link', rssi: e.rssi }); });
    b.on('notice', (e) => engine.ingest({ type: 'notice', kind: e.kind }));
    b.on('disconnect', (e) => { if (b !== band) return; engine.ingest({ type: 'disconnect', reason: e.reason }); if (e.reason !== 'closed') { band = sim = null; kind = 'none'; setConn(`Lost ${BAND_NAME}. Double-tap it, then Connect`, 'err'); renderConn(); } });
    b.on('reconnecting', () => setConn(`Reconnecting to ${BAND_NAME}…`, 'wait'));
    b.on('reconnected', () => { setConn(`Reconnected to ${BAND_NAME}`, 'ok'); lastLedKey = ''; engine.ingest({ type: 'reconnected' }); });
  }
  async function applyLed() {
    if (!band || ledBusy || micOn) return;          // the band refuses light changes while the mic is on
    const want = engine.led();
    const key = want ? `${want.color}/${want.pattern}/${want.period}/${want.brightness}` : 'off';
    if (key === lastLedKey) return;
    ledBusy = true;
    try { if (want) await band.setLed(want.color, { brightness: want.brightness, pattern: want.pattern, period: want.period }); else await band.ledOff(); }
    catch (_) { /* denied while mic on */ }
    lastLedKey = key; ledBusy = false;
  }

  // ---- Margaret talks: band mic → WAV → Deepgram → OpenAI -----------------------------------
  function wav(int16) {
    const b = new ArrayBuffer(44 + int16.length * 2); const v = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + int16.length * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, int16.length * 2, true);
    new Int16Array(b, 44).set(int16); return new Blob([b], { type: 'audio/wav' });
  }
  let recording = null;
  async function talk() {
    if (recording) return stopTalk();
    if (!band) return note('Connect band 39 (or the pretend band) first, then press Talk.');
    const k = await loadKit();
    if (!(await k.canDecodeAudio())) return note('This browser can’t decode the band’s sound. Use Chrome or Edge.');
    const chunks = [];
    const sound = new k.BandAudio((samples) => chunks.push(k.toInt16(samples)));
    const off = band.on('audio', (a) => sound.push(a));
    micOn = true; await band.configure({ audio: true });
    recording = { chunks, sound, off, timer: setTimeout(stopTalk, 12000) };
    note('Listening… speak now. Press again when you’re done. (Your words go to Deepgram to be written down.)'); renderAll();
  }
  async function stopTalk() {
    const r = recording; if (!r) return; recording = null; clearTimeout(r.timer);
    try { await band.configure({ audio: false }); } catch (_) { /* link gone */ }
    micOn = false; r.off(); r.sound.close(); lastLedKey = ''; applyLed(); renderAll();
    const n = r.chunks.reduce((s, c) => s + c.length, 0); if (n < 8000) return note('That was very short. Try again and speak for a few seconds.');
    const all = new Int16Array(n); let o = 0; for (const c of r.chunks) { all.set(c, o); o += c.length; }
    note('Writing down what you said…');
    try {
      const res = await fetch('api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(all) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || res.status);
      if (!j.text) return note('I couldn’t hear any words. Try again a little closer to the band.');
      await handleNote(j.text, 'band mic → Deepgram');
    } catch (e) { note('Couldn’t write it down: ' + e.message); }
  }
  async function handleNote(text, how) {
    transcripts.push(text);
    engine.sendMessage('🎙 ' + text, 'Margaret');
    note('Sent to Lisa. Pip is reading it…');
    let a;
    try { const res = await fetch('api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: text, history: transcripts.slice(0, -1) }) }); a = await res.json(); }
    catch (e) { return note('Sent to Lisa (the reader is offline).'); }
    a.text = text; a.how = how; a.at = clock.scene(); insightsLog.unshift(a); if (insightsLog.length > 12) insightsLog.pop();
    applyInsights(a); renderAll();
  }
  function applyInsights(a) {
    const r = a.risk || {}, m = a.medical || {}, d = a.dementia || {};
    banner = null;
    if (r.scam && r.scam.level !== 'none') {
      engine.raise(r.scam.level === 'high' ? 'urgent' : 'warn', 'Possible scam call', `${r.scam.evidence || 'From Mom’s voice note.'} Call Mom before she pays anyone.`, 'scam');
      banner = { kind: 'scam', title: 'That sounds like a scam 🛡️', body: 'Please don’t buy gift cards or share bank details. Lisa has been told and will call you.' };
    }
    if (r.abuse && r.abuse.level !== 'none' && r.abuse.level !== 'low') {
      engine.raise(r.abuse.level === 'high' ? 'urgent' : 'warn', 'Possible abuse or exploitation', `${r.abuse.evidence || ''} Check in privately. Adult Protective Services can help.`, 'abuse');
    }
    for (const rem of m.reminders || []) { engine.note('⏰', `Reminder from Mom: ${rem.what}${rem.when ? ' · ' + rem.when : ''}`, 'health'); if (!banner) banner = { kind: 'remember', title: 'I’ll remind you ⏰', body: `${rem.what}${rem.when ? ', ' + rem.when : ''}.` }; }
    const map = { nausea: 'nausea', dizziness: 'balance', tremor: 'tremor', sleep: 'sleep' };
    for (const se of m.side_effects || []) { const c = map[se.condition]; if (c) addCondition(c, { reported: se.symptom }); engine.raise('info', 'Possible side effect', `Mom said: “${se.symptom}”. Worth mentioning to Dr. Patel.`, 'se:' + se.condition); }
    const dem = ['cognitive', 'memory', 'language'].map((k) => (d[k] && d[k].concern) || 0);
    if (Math.max(...dem) >= 50) engine.raise('info', 'Memory or language change', 'A recent voice note showed signs worth sharing with Dr. Patel. One note is not a trend.', 'dementia');
    if (!banner && (a.lifestyle || []).length) banner = { kind: 'tip', title: 'A little idea from Pip 🌱', body: a.lifestyle[0] };
    note('Lisa got your note. ' + (a.summary || ''));
  }

  // ---- voice for Margaret (ElevenLabs via the server; only after a tap) ---------------------
  async function speak(text) {
    if (!text) return;
    try {
      const res = await fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error('voice unavailable');
      const url = URL.createObjectURL(await res.blob()); const el = $('voice'); el.src = url; await el.play();
    } catch (e) { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
  }
  function currentWords() {
    const p = engine.prompt(); const s = engine.state;
    if (p && p.kind === 'message') { const m = s.messages.find((x) => x.from === 'Lisa' && !x.read); return m ? `Lisa says: ${m.text}` : ''; }
    const v = p ? PROMPTS[p.kind](s, clock.scene(), p) : banner;
    return v ? `${v.title}. ${v.body || ''}` : $('pipSay').textContent;
  }

  // ---- shop + doctor ------------------------------------------------------------------------
  const picked = new Set();
  async function pay() {
    const items = forConditions([...conditions.keys()]).filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, name: p.name, price: p.price, qty: 1 }));
    if (!items.length) return;
    $('payNote').textContent = 'Opening Stripe…';
    try {
      const j = await (await fetch('api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, origin: location.origin }) })).json();
      if (j.url) location.href = j.url; else $('payNote').textContent = j.message || j.error || 'Checkout unavailable.';
    } catch (e) { $('payNote').textContent = 'Checkout unavailable: ' + e.message; }
  }
  function doctorSummary() {
    const lines = [];
    for (const [k, d] of conditions) {
      const t = CONDITIONS[k]; if (!t) continue;
      lines.push('• ' + t.doctor.replace('{hz}', d.hz ?? '?').replace('{score}', d.score ?? '?').replace('{min}', Math.round(lab.labels.tremor.minutesToday) || d.min || 1)
        .replace('{time}', d.time || fmtTime(d.at)).replace('{g}', d.g ?? '?').replace('{answered}', '').replace('{n}', d.n ?? 1).replace('{pct}', d.pct ?? '?').replace('{s}', d.s ?? 10)
        .replace('{which}', d.which || '') + (d.reported ? ` (she said: “${d.reported}”)` : ''));
    }
    for (const a of insightsLog.slice(0, 3)) if (a.medical && a.medical.doctor_notes) lines.push('• From voice note: ' + a.medical.doctor_notes);
    const dem = insightsLog[0] && insightsLog[0].dementia;
    if (dem) lines.push(`• Latest voice note concern (0-100): cognitive ${dem.cognitive.concern}, memory ${dem.memory.concern}, language ${dem.language.concern}`);
    return lines.length ? `Margaret (78), via Vexo band 39 and voice notes:\n${lines.join('\n')}\nSignals for review, not diagnoses.` : '';
  }
  async function sendDoctor() {
    const summary = doctorSummary(); if (!summary) return;
    try { const j = await (await fetch('api/doctor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'Dr. Patel', summary }) })).json(); $('docNote').textContent = j.ok ? `Sent ✓ (${fmtTime(clock.scene())}) to the clinic inbox` : 'Not sent'; engine.note('🩺', 'Summary sent to Dr. Patel', 'health'); }
    catch (e) { $('docNote').textContent = 'Not sent: ' + e.message; }
  }

  // ---- render ---------------------------------------------------------------------------------
  const PROMPTS = {
    fall: () => ({ title: 'Did you fall, Margaret?', body: 'If you’re all right, double-tap your band or press “I’m OK”.', btns: [['ok', 'I’m OK', 'go'], ['help', 'I need help', 'sos']], countdown: true }),
    help: () => ({ title: 'Help is on the way', body: 'Lisa has been told and is calling you now. Stay where you are.', btns: [['ok', 'I’m OK now', 'go']] }),
    checkin: () => ({ title: 'Just checking in 🤍', body: 'You’ve been resting a while. Tap your band or press below so Lisa knows you’re fine.', btns: [['ok', 'I’m OK', 'go'], ['help', 'I need help', 'sos']], countdown: true }),
    night: (s, now) => ({ title: `It’s ${fmtTime(now)}, night-time 🌙`, body: 'Everyone is asleep. Your bed is warm. Lisa visits on Saturday.', btns: [['ok', 'Back to bed ✓', 'go']] }),
    reminder: (s, now, p) => ({ title: `Time for your ${engine.medName(p.med)} pills 💊`, body: 'They’re in the blue box by the kettle. Tap your band when you’ve taken them.', btns: [['done', 'Done ✓', 'go']] }),
    message: (s) => { const m = s.messages.find((x) => x.from === 'Lisa' && !x.read); return { title: 'A message from Lisa 💌', quote: m ? m.text : '', btns: [['read', 'Got it ❤️', 'go'], ['speak', '🔈 Read it to me', 'soft']] }; },
    notworn: () => ({ title: 'Please put your band on ⌚', body: 'It keeps you safe when you’re up and about.', btns: [['ok', 'It’s on ✓', 'go']] }),
  };
  let pipNote = null, pipNoteUntil = 0;
  function note(text) { pipNote = text; pipNoteUntil = Date.now() + 9000; renderAll(); }
  const greet = (now) => { const h = new Date(now).getHours(); return h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

  function renderMargaret() {
    const s = engine.state, now = clock.scene(), p = engine.prompt(), led = micOn ? { color: '#3E8EF7', pattern: 'solid', say: 'solid blue: listening to you' } : engine.led();
    $('gmGreet').textContent = `${greet(now)}, Margaret`;
    $('gmTime').textContent = fmtTime(now);
    $('gmDate').textContent = new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const ring = $('gmRing'); ring.style.setProperty('--led', led ? led.color : '#d9d3ea'); ring.dataset.pattern = led ? led.pattern : 'off';
    $('gmBandSay').textContent = led ? `Your band is ${led.say}` : (band ? 'Your band is resting quietly' : 'Your band is not connected');
    const night = (() => { const h = new Date(now).getHours(); return h >= 22 || h < 6; })();
    const worried = p && ['fall', 'help', 'checkin'].includes(p.kind) || (banner && ['scam', 'seizure'].includes(banner.kind));
    $('pip').dataset.mood = worried ? 'worried' : night ? 'sleepy' : (engine.led() && engine.led().kind === 'good') ? 'happy' : 'calm';
    $('pipSay').textContent = Date.now() < pipNoteUntil ? pipNote : worried ? 'I’m right here with you.' : night ? 'Sleepy time. I’ll keep watch. 🌙' : s.steps > 1500 ? `Lovely walking today: ${s.steps.toLocaleString()} steps! 🌼` : 'I’m keeping an eye on things. Talk to Lisa anytime.';
    const box = $('gmPrompt');
    const v = p ? PROMPTS[p.kind](s, now, p) : banner ? Object.assign({ btns: [['clear', 'OK ✓', 'go'], ['speak', '🔈 Read it to me', 'soft']] }, banner) : null;
    if (v) {
      let left = ''; if (v.countdown && p && p.deadline) left = `<div class="gm-count">${Math.max(0, Math.ceil((p.deadline - Date.now()) / 1000))}s</div>`;
      box.className = 'gm-prompt kind-' + (p ? p.kind : banner.kind);
      box.innerHTML = `${left}<h4>${esc(v.title)}</h4>${v.body ? `<p>${esc(v.body)}</p>` : ''}${v.quote ? `<blockquote>${esc(v.quote)}</blockquote>` : ''}<div class="gm-btns">${v.btns.map(([a, l, c]) => `<button class="gm-btn ${c}" data-gm="${a}">${esc(l)}</button>`).join('')}</div>`;
    } else {
      const nx = engine.nextUp(); const goal = lab.labels.steps.goal; const st = s.steps;
      box.className = 'gm-prompt kind-calm';
      box.innerHTML = `<h4>All is well today 🌷</h4><ul class="gm-today">
        <li><span>👣</span><div style="flex:1">${st ? `<b>${st.toLocaleString()}</b> of ${goal.toLocaleString()} steps` : 'A gentle walk would be lovely today'}<div class="energy"><i style="width:${Math.min(100, st / goal * 100)}%"></i></div></div></li>
        <li><span>💊</span>${nx ? `Next: <b>${esc(nx.text)}</b> at ${fmtTime(nx.at)}` : 'Your pills are all sorted for today'}</li></ul>`;
    }
    $('mTalk').classList.toggle('on', !!recording); $('mTalkLabel').textContent = recording ? 'Listening… tap when done' : 'Talk to Lisa';
  }

  function sigTile(icon, name, value, sub, level, meter) {
    return `<div class="sig ${level}"><span class="ic">${icon}</span><small>${esc(name)}</small><b>${value}</b><span>${sub}</span>${meter != null ? `<div class="meter"><i style="width:${Math.max(3, Math.min(100, meter))}%"></i></div>` : ''}</div>`;
  }
  function renderLisa() {
    const s = engine.state, L = lab.labels, st = engine.status();
    const pill = $('cgStatus'); pill.textContent = st.label; pill.dataset.level = st.level;
    const act = { walk: 'walking', run: 'moving briskly', still: 'resting', unknown: '—' }[s.activity] || s.activity;
    $('cgSummary').textContent = band ? `${act} · ${s.steps.toLocaleString()} steps · band ${s.battery == null ? '—' : s.battery + '%'}` : 'Band not connected';
    const fallTxt = L.fall.at ? `${fmtTime(L.fall.at)} · impact ${L.fall.stages.impactG} g` : 'none today';
    $('sigGrid').innerHTML = [
      sigTile('📉', 'Falling', L.fall.count ? `${L.fall.count} today` : 'None', fallTxt, L.fall.count ? 'alert' : 'ok'),
      sigTile('✋', 'Shaking score', `${L.tremor.score}/4`, L.tremor.hz ? `${L.tremor.hz} Hz rest tremor · ${L.tremor.rms} °/s` : `${Math.round(L.tremor.minutesToday)} min today`, L.tremor.score >= 3 ? 'alert' : L.tremor.score ? 'watch' : 'ok', L.tremor.score * 25),
      sigTile('👣', 'Steps', s.steps.toLocaleString(), `${L.steps.cadence || 0} steps/min · goal ${L.steps.goal.toLocaleString()}`, 'ok', s.steps / L.steps.goal * 100),
      sigTile('⚖️', 'Balance', L.balance.score == null ? '—' : `${L.balance.score}/100`, L.balance.score == null ? 'measured on walks' : `gait regularity ${Math.round((L.balance.regularity || 0) * 100)}%`, L.balance.score == null ? '' : L.balance.score < 55 ? 'alert' : L.balance.score < 70 ? 'watch' : 'ok', L.balance.score),
      sigTile('🛏️', 'Sleep movement', L.sleep.epochs ? `${L.sleep.restless}% restless` : '—', L.sleep.epochs ? `${L.sleep.asleep ? 'asleep' : 'awake'} · ${L.sleep.epochs} epochs` : 'scored at night', L.sleep.restless >= 30 ? 'watch' : 'ok', L.sleep.restless),
      sigTile('🌙', 'Night wandering', L.wander.active ? 'Now' : `${L.wander.episodes} episode${L.wander.episodes === 1 ? '' : 's'}`, L.wander.active ? `${Math.round(L.wander.minutes)} min${L.wander.far ? ' · away from home' : ''}` : '22:30–06:00', L.wander.active ? 'alert' : L.wander.episodes ? 'watch' : 'ok'),
      sigTile('⚡', 'Seizure-like', L.seizure.active ? 'Now' : L.seizure.count ? `${L.seizure.count} today` : 'None', L.seizure.seconds ? `${L.seizure.seconds}s rhythmic ${L.seizure.hz || ''} Hz` : 'rhythmic 2–7 Hz ≥10 s', L.seizure.active || L.seizure.count ? 'alert' : 'ok'),
    ].join('');
    const alerts = s.alerts.slice().sort((a, b) => (a.ack - b.ack) || (b.at - a.at)).slice(0, 6);
    $('cgAlerts').innerHTML = alerts.length ? alerts.map((a) => `<li class="al al-${a.level}${a.ack ? ' acked' : ''}"><div class="al-top"><b>${esc(a.title)}</b><time>${fmtTime(a.at)}</time></div><p>${esc(a.body)}</p>${a.ack ? '<span class="al-ack">Seen ✓</span>' : `<button data-ack="${a.id}">Mark as seen</button>`}</li>`).join('') : '<li class="empty">No alerts. Mom’s day is going quietly.</li>';
    renderInsights();
    // shop
    const recs = forConditions([...conditions.keys()]);
    $('shop').innerHTML = recs.length ? recs.map((p) => `<div class="prod"><span class="pi">${p.icon}</span><div><b>${esc(p.name)}</b><small>${esc(p.why)} · for ${p.for.filter((c) => conditions.has(c)).map((c) => CONDITIONS[c].label.toLowerCase()).join(', ')}</small><span class="tag ${p.elig}">${ELIG[p.elig]}</span></div><label>$${p.price}<input type="checkbox" data-pick="${p.id}" ${picked.has(p.id) ? 'checked' : ''}/></label></div>`).join('') : '<p class="empty">Nothing needed right now. Suggestions appear when the band or Mom’s notes point to something equipment could help with.</p>';
    const total = recs.filter((p) => picked.has(p.id)).reduce((t, p) => t + p.price, 0);
    $('shopFoot').hidden = !recs.length; $('shopTotal').textContent = `$${total}`; $('payBtn').disabled = !total;
    $('payBtn').textContent = cfg.stripe ? 'Pay with Stripe' : 'Pay with Stripe (not connected)';
    const sum = doctorSummary(); $('docSum').textContent = sum || 'No findings to share yet.'; $('docBtn').disabled = !sum;
    $('cgThread').innerHTML = s.messages.slice(-6).map((m) => `<li class="msg ${m.from === 'Lisa' ? 'me' : 'her'}"><span>${esc(m.text)}</span><small>${fmtTime(m.at)}${m.from === 'Lisa' ? (m.read ? ' · read ✓' : ' · delivered') : m.viaBand ? ' · from her band' : ''}</small></li>`).join('') || '<li class="empty">Messages appear on Mom’s screen, and her band glows violet until she reads them.</li>';
    $('cgTimeline').innerHTML = s.timeline.slice(0, 14).map((t) => `<li class="tl tl-${t.kind}"><time>${fmtTime(t.at)}</time><span>${t.icon}</span>${esc(t.text)}</li>`).join('');
    const n = s.alerts.filter((a) => !a.ack && a.level !== 'good').length; $('tabBadge').textContent = n ? '· ' + n : '';
  }
  function renderInsights() {
    const a = insightsLog[0]; const box = $('insights');
    if (!a) return;
    $('insSource').textContent = `· ${a.source && a.source.startsWith('openai') ? 'read by OpenAI' : 'offline rules'} · ${a.how}`;
    const lv = (x) => `<span class="lvl ${x.level}">${x.level}</span>`;
    const r = a.risk, m = a.medical, d = a.dementia;
    const avg = (k) => Math.round(insightsLog.slice(0, 5).reduce((t, x) => t + ((x.dementia && x.dementia[k].concern) || 0), 0) / Math.min(5, insightsLog.length));
    const bar = (label, k) => `<div class="bar3">${label}<i><b style="width:${d[k].concern}%"></b></i>${d[k].concern}</div>`;
    box.innerHTML = `
      <div class="ins-g ${r.scam.level === 'high' || r.abuse.level === 'high' ? 'alert' : r.scam.level !== 'none' || r.abuse.level !== 'none' ? 'watch' : ''}"><h5>🛡️ Risk</h5><ul><li>Scam ${lv(r.scam)} ${esc(r.scam.evidence)}</li><li>Abuse ${lv(r.abuse)} ${esc(r.abuse.evidence)}</li></ul></div>
      <div class="ins-g ${m.side_effects.length ? 'watch' : ''}"><h5>🩺 Medical</h5><ul>${m.reminders.map((x) => `<li>⏰ ${esc(x.what)}${x.when ? ' · ' + esc(x.when) : ''}</li>`).join('')}${m.side_effects.map((x) => `<li>⚠️ ${esc(x.symptom)} <span class="muted">(${esc(x.condition)})</span></li>`).join('')}${m.doctor_notes ? `<li>📝 ${esc(m.doctor_notes)}</li>` : ''}${!m.reminders.length && !m.side_effects.length && !m.doctor_notes ? '<li>Nothing medical in this note.</li>' : ''}</ul></div>
      <div class="ins-g ${Math.max(d.cognitive.concern, d.memory.concern, d.language.concern) >= 50 ? 'watch' : ''}"><h5>🧠 Memory & language <span class="muted">· this note</span></h5>${bar('Cognitive', 'cognitive')}${bar('Memory', 'memory')}${bar('Language', 'language')}
        <ul>${[...d.cognitive.signals, ...d.memory.signals, ...d.language.signals].slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="fine">5-note average: cognitive ${avg('cognitive')} · memory ${avg('memory')} · language ${avg('language')} · words ${a.metrics.words}, variety ${a.metrics.type_token_ratio}, fillers ${a.metrics.fillers}</p></div>
      <div class="ins-g"><h5>🌼 Lifestyle</h5><ul>${(a.lifestyle || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
      <div class="ins-g"><h5>📒 Track</h5><ul>${(a.track || []).map((x) => `<li><b>${esc(x.metric)}</b> ${esc(x.value)}</li>`).join('') || '<li>Nothing to log.</li>'}</ul></div>
      <div class="ins-g"><h5>💬 What she said</h5><ul><li>“${esc(a.text)}”</li><li class="muted">${esc(a.summary || '')}</li></ul></div>`;
  }
  function renderConn() {
    $('lvConnect').disabled = busy || kind === 'ble'; $('lvUseSim').disabled = busy || kind === 'sim'; $('lvDisc').disabled = busy || kind === 'none';
    root.dataset.conn = kind;
  }
  let raf = 0;
  function renderAll() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderMargaret(); renderLisa(); }); }
  setInterval(() => { engine.tick(); renderAll(); }, 500);

  // ---- demo: play signals on the pretend band ------------------------------------------------
  async function demoSignal(name) {
    if (!sim) await connect('sim'); if (!sim) return;
    document.querySelectorAll('[data-sig]').forEach((b) => b.classList.toggle('on', b.dataset.sig === name && name !== 'stop'));
    sim.stopMotion();
    const play = (fn, sec) => sim.playMotion(fn, sec ? { seconds: sec } : undefined);
    if (name === 'tremor') { sim.setActivity('still'); play(SIGNALS.tremor(45, 5)); }
    else if (name === 'walk') { sim.setActivity('walk', { cadence: 108 }); play(SIGNALS.walk(0)); }
    else if (name === 'shaky') { sim.setActivity('walk', { cadence: 96 }); play(SIGNALS.walk(1)); }
    else if (name === 'fall') { sim.setActivity('still'); play(SIGNALS.rest(), 1); play(SIGNALS.fall(), 5); play(SIGNALS.rest()); setTimeout(() => sim && sim.tap('free-fall'), 1650); }
    else if (name === 'seizure') { sim.setActivity('still'); play(SIGNALS.seizure(4), 16); play(SIGNALS.rest()); }
    else if (name === 'restless') { setNight(true); sim.setActivity('still'); play(SIGNALS.restless()); }
    else if (name === 'nightwalk') { setNight(true); sim.setActivity('walk', { cadence: 90 }); play(SIGNALS.walk(0.3)); }
    else { sim.setActivity('still'); play(SIGNALS.rest()); }
  }
  function setNight(on) {
    offset = on ? atToday(Date.now(), '02:30') - Date.now() : 0;
    lab.cfg.sleep.epochS = on ? 10 : 30; lab.cfg.wander.minMin = on ? 0.5 : 2;   // demo timing at night
    engine.reset(clock.scene()); Object.assign(engine.state, { connected: !!band, transport: kind });
    note(on ? 'Pretending it’s 2:30 am (sleep epochs 10 s and wander after 30 s, demo timing).' : 'Back to the real time.');
  }

  // ---- controls ---------------------------------------------------------------------------------
  $('lvConnect').onclick = () => connect('ble');
  $('lvUseSim').onclick = () => connect('sim');
  $('lvDisc').onclick = () => disconnect(false);
  $('mTalk').onclick = talk;
  $('mRead').onclick = () => speak(currentWords());
  $('payBtn').onclick = pay;
  $('docBtn').onclick = sendDoctor;
  $('nightBtn').onclick = () => setNight(true);
  $('dayBtn').onclick = () => setNight(false);
  $('voiceDemo').onclick = async () => { if (!sim) await connect('sim'); if (sim) talk(); };
  $('cgSend').onsubmit = (e) => { e.preventDefault(); engine.sendMessage($('cgMsg').value, 'Lisa'); $('cgMsg').value = ''; };
  $('noteForm').onsubmit = (e) => { e.preventDefault(); const t = $('noteText').value.trim(); if (t) { handleNote(t, 'typed (demo)'); $('noteText').value = ''; } };
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, input[data-pick]'); if (!t) return;
    if (t.dataset.pick) { t.checked ? picked.add(t.dataset.pick) : picked.delete(t.dataset.pick); renderAll(); return; }
    if (t.dataset.tab) { root.dataset.tab = t.dataset.tab; document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === t))); }
    else if (t.dataset.gm) { const a = t.dataset.gm; if (a === 'speak') speak(currentWords()); else if (a === 'clear') { banner = null; renderAll(); } else engine.userAction(a, 'screen'); }
    else if (t.dataset.reply) engine.sendMessage(t.dataset.reply, 'Margaret');
    else if (t.dataset.ack) engine.ack(Number(t.dataset.ack));
    else if (t.dataset.quick) engine.sendMessage(t.dataset.quick, 'Lisa');
    else if (t.dataset.sig) demoSignal(t.dataset.sig);
    else if (t.dataset.note) handleNote(t.dataset.note, 'typed (demo)');
  });
  if (new URLSearchParams(location.search).get('paid') === '1') note('Thank you! Your order is paid. 🎉');
  renderConn(); renderAll();
  window.VexoCare = { engine, lab, connect, demoSignal, handleNote, conditions, get kind() { return kind; }, insightsLog };
})();
