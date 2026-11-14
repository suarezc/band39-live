/* Band 39 · Vexo Care: two portals (Margaret, caregiver) over one household.
 * Margaret's device = the hub: connects to band 39, runs the motion lab + care engine, talks to Pip,
 * and shares a snapshot under a private household code. The caregiver portal (same or another device)
 * renders that snapshot; its actions (messages, "I'm on it", day/night, demos) go back to the hub.
 * AI: /api/pip (Pip replies + actions), /api/analyze (risk/medical/memory), /api/recall, /api/digest,
 * /api/ask, /api/doctor-draft. Voice: /api/transcribe (Deepgram), /api/tts (ElevenLabs). Keys stay on the server.
 */
(function () {
  'use strict';
  const BAND = 39;                                    // our band only: Vexo-HACK-39
  const BAND_NAME = 'Vexo-HACK-' + String(BAND).padStart(2, '0');
  const KIT = new URL('vexo-open-kit/js/src/index.js', document.baseURI).href;
  const SAMPLE_VOICE = new URL('vexo-open-kit/dashboard/speech/sample-speech.opus', document.baseURI).href;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const { createEngine, atToday, fmtTime } = window.VexoLive;
  const { createMotionLab, SIGNALS } = window.VexoMotion;
  const { CONDITIONS, ELIG, forConditions } = window.VexoCatalog;
  const { INFO } = window.VexoInfo;
  const app = $('app');
  if (new URL(location.href).searchParams.get('embed')) app.classList.add('embed'); if (new URL(location.href).searchParams.get('phone')) app.classList.add('in-phone'); if (new URL(location.href).searchParams.get('product')) app.classList.add('in-product');   // inside product.html: no outer chrome
  const medName = (t) => (Number(t.split(':')[0]) < 12 ? 'morning' : Number(t.split(':')[0]) < 17 ? 'afternoon' : 'evening');
  const PIP = document.getElementById('pipArt').innerHTML;
  $$('svg[data-pip]').forEach((s) => { s.innerHTML = PIP; });   // inline copies so moods can restyle them

  // ---- household code (private key for sharing between Margaret's and Lisa's devices) -----------
  const url = new URL(location.href);
  let HOME = (url.searchParams.get('home') || localStorage.getItem('b39home') || '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(HOME)) { HOME = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join(''); }
  localStorage.setItem('b39home', HOME);
  $('homeCode').textContent = HOME;

  // ---- people -------------------------------------------------------------------------------------
  const PEOPLE = [
    { av: '👵', name: 'Margaret', role: 'Wears the band', about: '78, lives alone, early memory changes.', gets: 'Her portal and Pip. Decides what is shared.' },
    { av: '👩', name: 'Lisa', role: 'Primary caregiver', about: 'Her daughter, 400 miles away.', gets: 'Every alert, the daily digest, messages; pays for care items.' },
    { av: '👩‍🦳', name: 'Ruth', role: 'Backup responder', about: 'Neighbour next door with a spare key.', gets: 'Urgent alerts when Lisa can’t respond (planned: SMS).' },
    { av: '🩺', name: 'Dr. Patel', role: 'Clinician', about: 'Margaret’s doctor.', gets: 'Summaries Lisa chooses to send.' },
    { av: '🌱', name: 'Pip', role: 'AI companion', about: 'Talks with Margaret (OpenAI + ElevenLabs + Deepgram).', gets: 'Flags risks and reminders. Never diagnoses.' },
  ];
  const circleHtml = PEOPLE.map((p) => `<div class="person"><span class="av">${p.av}</span><span class="role">${esc(p.role)}</span><b>${esc(p.name)}</b><p>${esc(p.about)}</p><span class="gets">${esc(p.gets)}</span></div>`).join('');
  $('circle').innerHTML = circleHtml; $('circle2').innerHTML = circleHtml;

  // ---- hub: engine + motion lab -------------------------------------------------------------------
  let sceneOffset = 0;                                 // the simulator moves the scene clock through a day; real time keeps deadlines
  const clock = { scene: () => Date.now() + sceneOffset, real: () => Date.now() };
  const engine = createEngine(clock);
  const lab = createMotionLab(clock);
  const H = { mode: 'day', conditions: new Map(), insights: [], recall: [], chat: [], reminders: [], tracks: [], transcripts: [], banner: null, ackAt: 0, pipMood: 'calm', pendingRecall: null };
  let cfg = {};
  const L = { want: localStorage.getItem('b39listen') !== '0', src: null, rate: 16000, busy: false, again: false, paused: '', err: '', denied: false,
    floor: 0.006, seg: null, pre: [], pending: 0, heard: 0, directUntil: 0, followUntil: 0, quietUntil: 0, speaking: false, speakTimer: 0, dev: null, bandOff: null, bandSound: null };
  let raf = 0;                                        // render batching (declared early: changed() runs during setup)
  fetch('api/config').then((r) => r.json()).then((c) => { cfg = c; }).catch(() => {});

  function setMode(m) {
    H.mode = m === 'night' ? 'night' : 'day';
    engine.cfg.forceNight = H.mode === 'night'; lab.cfg.forceNight = H.mode === 'night';
    const fast = $('fastDemo').checked && H.mode === 'night';
    lab.cfg.sleep.epochS = fast ? 10 : 30; lab.cfg.wander.minMin = fast ? 0.5 : 2;
    engine.note(H.mode === 'night' ? '🌙' : '☀️', H.mode === 'night' ? 'Night mode: sleep scoring, wandering watch, quiet alerts' : 'Day mode', 'info');
    changed();
  }
  const h0 = new Date().getHours(); setMode(h0 >= 22 || h0 < 6 ? 'night' : 'day');
  function addCondition(k, d) { H.conditions.set(k, Object.assign({ at: Date.now() }, H.conditions.get(k) || {}, d)); changed(); }

  lab.on((type, d) => {
    if (type === 'fall') { engine.ingest({ type: 'free-fall' }); addCondition('fall', { time: fmtTime(Date.now()), g: d.stages.impactG }); engine.note('📉', `Fall pattern: impact ${d.stages.impactG} g${d.stages.still ? ', then still' : ''}`, 'safety'); }
    if (type === 'seizure') { engine.raise('urgent', 'Seizure-like movement', `Rhythmic ${d.hz} Hz shaking for ${d.seconds}+ s at ${fmtTime(Date.now())}. Call Mom now; if she doesn’t answer, call 911. Not a diagnosis.`, 'seizure'); addCondition('seizure', { hz: d.hz, s: d.seconds, time: fmtTime(Date.now()) }); H.banner = { kind: 'seizure', title: 'Lisa is being called', body: 'Your band noticed strong shaking. Help is on the way.' }; }
    if (type === 'tremor' && d.score >= 2) addCondition('tremor', { hz: d.hz, score: d.score });
    if (type === 'balance' && d.score != null && d.score < 55 && lab.labels.balance.walkWindows > 3) addCondition('balance', { score: d.score });
    if (type === 'sleep' && d.restless >= 30 && d.epochs >= 6) addCondition('sleep', { pct: d.restless });
    if (type === 'wander') addCondition('wander', { n: lab.labels.wander.episodes, min: Math.round(d.minutes) });
    if (type === 'wander-escalate') engine.raise('urgent', 'Mom is still up and walking', `Night walking for ${Math.round(d.minutes)} min${d.far ? ', far from the home tablet' : ''}. Call her or ask Ruth to knock.`, 'night');
    changed();
  });
  engine.subscribe(() => { changed(); applyLed(); queueMicrotask(syncListen); });   // microtask: runs after setup declares band/kit

  // ---- band connection (hub) ------------------------------------------------------------------------
  let kit = null, band = null, sim = null, kind = 'none', busy = false, lastLedKey = '', ledBusy = false, micOn = false, connText = 'Band not connected', samplePackets = null;
  const loadKit = async () => { if (!kit) kit = await import(KIT); return kit; };
  async function connect(which) {
    if (busy) return; busy = true;
    try {
      await disconnect(true);
      const k = await loadKit();
      if (which === 'ble') {
        connText = `Looking for ${BAND_NAME}… pick it in the list`; changed();
        band = await k.Band.connect(BAND, window.VexoNativeBle ? { transport: new window.VexoNativeBle.NativeBleTransport(BAND), autoReconnect: true } : { autoReconnect: true });
        kind = 'ble';
      } else {
        try { samplePackets = samplePackets || k.oggPackets(new Uint8Array(await (await fetch(SAMPLE_VOICE)).arrayBuffer())); } catch (_) { /* no voice */ }
        sim = new k.SimTransport(BAND, { autoTap: false });          // silent mic; Talk plays the sample once
        band = await k.Band.connect(BAND, { transport: sim, autoReconnect: true });
        kind = 'sim'; sim.setActivity('still'); sim.playMotion(SIGNALS.rest());
      }
      wire(band);
      await band.setMotion({ accelRange: 8 });
      await band.configure({ events: true, activity: true, battery: true, temperature: true, motion: 50, link: true });
      engine.state.connected = true; engine.ingest({ type: 'connect', transport: kind, name: band.name });
      lastLedKey = ''; applyLed();
      connText = kind === 'ble' ? `Connected to ${band.name}` : `Pretend ${BAND_NAME}`;
    } catch (e) { band = sim = null; kind = 'none'; connText = e.message || String(e); }
    finally { busy = false; changed(); syncListen(); }
  }
  async function disconnect(quiet) {
    const b = band; band = sim = null; kind = 'none'; micOn = false;
    if (b) { try { await b.disconnect(); } catch (_) { /* gone */ } }
    if (L.src === 'band') await stopBandMic();
    if (!quiet) { engine.ingest({ type: 'disconnect', reason: 'closed' }); connText = 'Band not connected'; changed(); syncListen(); }
  }
  function wire(b) {
    for (const g of ['tap', 'double-tap', 'tilt', 'orientation', 'motion-start', 'motion-stop']) b.on(g, () => engine.ingest({ type: g }));
    b.on('free-fall', () => lab.event('free-fall'));
    b.on('motion', (m) => lab.push({ t: m.t, ax: m.ax, ay: m.ay, az: m.az, gx: m.gx, gy: m.gy, gz: m.gz }));
    b.on('activity', (a) => { lab.activity(a); const L = lab.labels.steps; engine.ingest({ type: 'activity', state: L.state, steps: a.steps - (L.discarded || 0), cadence: L.cadence, motion: a.motion }); });
    b.on('battery', (e) => engine.ingest({ type: 'battery', percent: e.percent, state: e.state }));
    b.on('temperature', (e) => engine.ingest({ type: 'temperature', celsius: e.celsius }));
    b.on('link', (e) => { lab.link(e.rssi); engine.ingest({ type: 'link', rssi: e.rssi }); });
    b.on('notice', (e) => engine.ingest({ type: 'notice', kind: e.kind }));
    b.on('disconnect', (e) => { if (b !== band) return; engine.ingest({ type: 'disconnect', reason: e.reason }); if (e.reason !== 'closed') { band = sim = null; kind = 'none'; connText = `Lost ${BAND_NAME}. Double-tap it, then Connect`; stopBandMic().then(syncListen); changed(); } });
    b.on('reconnecting', () => { connText = `Reconnecting to ${BAND_NAME}…`; changed(); });
    b.on('reconnected', () => { connText = `Reconnected to ${BAND_NAME}`; lastLedKey = ''; engine.ingest({ type: 'reconnected' }); });
  }
  async function applyLed() {
    if (!band || ledBusy || micOn) return;
    let want = engine.led();
    if (!want && H.mode === 'night') want = null;                   // night: dark unless something needs her
    const key = want ? `${want.color}/${want.pattern}/${want.period}/${want.brightness}` : 'off';
    if (key === lastLedKey) return;
    ledBusy = true;
    try { if (want) await band.setLed(want.color, { brightness: H.mode === 'night' ? Math.min(want.brightness, 0.4) : want.brightness, pattern: want.pattern, period: want.period }); else await band.ledOff(); } catch (_) { /* mic on */ }
    lastLedKey = key; ledBusy = false;
  }

  // ---- Pip: voice in, reply + actions out -----------------------------------------------------------------
  function wav(int16, rate = 16000) {
    const b = new ArrayBuffer(44 + int16.length * 2); const v = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + int16.length * 2, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, int16.length * 2, true);
    new Int16Array(b, 44).set(int16); return new Blob([b], { type: 'audio/wav' });
  }
  let recording = null;
  const playSample = () => { if (sim && samplePackets) sim.playLoudness(0.6, { seconds: samplePackets.length * 0.02, packets: samplePackets }); };
  async function talk() {
    if (L.want && L.src) { L.directUntil = Date.now() + 15000; if (L.src === 'band' && kind === 'sim') playSample(); pipSays('I’m listening. Go ahead.'); return; }
    if (recording) return stopTalk();
    if (!band) return pipSays('Connect band 39 first (Today tab), or type to me below.');
    const k = await loadKit();
    if (!(await k.canDecodeAudio())) return pipSays('This browser can’t hear the band. Please type to me, or use Chrome.');
    const chunks = []; const sound = new k.BandAudio((x) => chunks.push(k.toInt16(x)));
    const off = band.on('audio', (a) => sound.push(a));
    micOn = true; await band.configure({ audio: true });
    recording = { chunks, sound, off, timer: setTimeout(stopTalk, 15000) }; if (kind === 'sim') playSample();
    pipSays('I’m listening… tap again when you’re done.'); changed();
  }
  async function stopTalk() {
    const r = recording; if (!r) return; recording = null; clearTimeout(r.timer);
    try { await band.configure({ audio: false }); } catch (_) { /* gone */ }
    micOn = false; r.off(); r.sound.close(); lastLedKey = ''; applyLed(); changed();
    const n = r.chunks.reduce((s, c) => s + c.length, 0); if (n < 8000) return pipSays('That was very short. Try again and speak for a few seconds.');
    const all = new Int16Array(n); let o = 0; for (const c of r.chunks) { all.set(c, o); o += c.length; }
    pipSays('Writing that down…');
    try {
      const res = await fetch('api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(all) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || res.status);
      if (!j.text) return pipSays('I couldn’t hear words. Try a little closer to the band.');
      said(j.text, 'voice');
    } catch (e) { pipSays('I couldn’t write it down: ' + e.message); }
  }
  let pipLine = 'Hi Margaret! I’m Pip.', pipLineAt = 0;
  function pipSays(t) { pipLine = t; pipLineAt = Date.now(); changed(); }
  async function said(text, how) {
    H.chat.push({ from: 'me', text, at: Date.now(), how }); H.transcripts.push(text); changed();
    if (H.pendingRecall) {                                         // answering a memory moment
      const q = H.pendingRecall; H.pendingRecall = null;
      const s = await post('api/recall', { question: q.question, hint: q.hint, answer: text }).catch(() => ({ result: 'partial', reply: 'Thank you.' }));
      H.recall.unshift({ q: q.question, hint: q.hint, a: text, result: s.result, at: Date.now() }); H.recall.length = Math.min(H.recall.length, 20);
      reply(s.reply, s.result === 'remembered' ? 'happy' : 'calm'); engine.note('🧩', `Memory moment: ${s.result}`, s.result === 'forgot' ? 'warn' : 'good');
      analyze(text, how); return;
    }
    const ctx = { time: fmtTime(Date.now()), mode: H.mode, next_pill: engine.nextUp() ? `${engine.nextUp().text} at ${fmtTime(engine.nextUp().at)}` : 'none today',
      unread_from_lisa: engine.state.messages.filter((m) => m.from === 'Lisa' && !m.read).map((m) => m.text) };
    const history = H.chat.slice(0, -1).filter((m) => m.from !== 'heard').slice(-7).map((m) => (m.from === 'me' ? 'Margaret: ' : 'Pip: ') + m.text);
    post('api/pip', { said: text, context: ctx, history }).then((p) => {
      reply(p.reply, p.mood);
      for (const a of p.actions || []) runAction(a, text);
    }).catch(() => reply('I’m here. I couldn’t think just now; Lisa can still see your note.', 'calm'));
    analyze(text, how);
  }
  function reply(text, mood) { L.followUntil = Date.now() + 20000; H.chat.push({ from: 'pip', text, at: Date.now() }); H.pipMood = mood || 'calm'; pipSays(text); if (voiceWanted()) speak(text); }
  function runAction(a, said) {
    if (a.type === 'set_reminder') { H.reminders.unshift({ what: a.text, when: a.when, at: Date.now() }); engine.note('⏰', `Reminder: ${a.text}${a.when ? ' · ' + a.when : ''}`, 'health'); }
    else if (a.type === 'tell_lisa') engine.sendMessage('🗣 ' + a.text, 'Margaret');
    else if (a.type === 'scam_guard') { engine.raise('urgent', 'Possible scam call', `${a.text} Call Mom before she pays anyone.`, 'scam'); H.banner = { kind: 'scam', title: 'That sounds like a scam 🛡️', body: 'Please don’t pay anyone or share numbers. Lisa has been told and will call you.' }; }
    else if (a.type === 'need_help') engine.userAction('help', 'voice');
    else if (a.type === 'log') H.tracks.unshift({ text: a.text, at: Date.now() });
    changed();
  }
  async function analyze(text, how) {
    const a = await post('api/analyze', { transcript: text, history: H.transcripts.slice(0, -1) }).catch(() => null); if (!a) return;
    a.text = text; a.how = how; a.at = Date.now(); H.insights.unshift(a); H.insights.length = Math.min(H.insights.length, 12);
    const r = a.risk || {}, m = a.medical || {}, d = a.dementia || {};
    if (r.scam && r.scam.level === 'high') engine.raise('urgent', 'Possible scam call', `${r.scam.evidence} Call Mom before she pays anyone.`, 'scam');
    if (r.abuse && (r.abuse.level === 'medium' || r.abuse.level === 'high')) engine.raise(r.abuse.level === 'high' ? 'urgent' : 'warn', 'Possible abuse or exploitation', `${r.abuse.evidence} Check in privately; Adult Protective Services can help.`, 'abuse');
    const map = { nausea: 'nausea', dizziness: 'balance', tremor: 'tremor', sleep: 'sleep' };
    for (const se of m.side_effects || []) { if (map[se.condition]) addCondition(map[se.condition], { reported: se.symptom }); engine.raise('info', 'Possible side effect', `Mom said: “${se.symptom}”. Worth telling Dr. Patel.`, 'se:' + se.condition); }
    if (Math.max(d.cognitive?.concern || 0, d.memory?.concern || 0, d.language?.concern || 0) >= 50) engine.raise('info', 'Memory or language change', 'A recent conversation showed signs worth sharing with Dr. Patel. One note is not a trend.', 'dementia');
    changed();
  }
  async function askRecall() {
    pipSays('Let me think of something…');
    const q = await post('api/recall', { notes: H.transcripts.slice(-6) }).catch(() => ({ question: 'What did you have for breakfast today?', hint: '' }));
    H.pendingRecall = Object.assign({ at: Date.now() }, q); L.followUntil = Date.now() + 60000; H.chat.push({ from: 'pip', text: q.question, at: Date.now() }); pipSays(q.question); if (voiceWanted()) speak(q.question);
  }
  // Pip talks back out loud with ElevenLabs (server /api/tts), hands-free: replies to "Pip, …" heard by the
  // always-on mic are spoken too, not only replies to taps. Browsers block sound until the page has had one
  // tap or key press, so the first gesture anywhere unlocks the <audio> element (a silent clip is played
  // inside the gesture, which iOS Safari needs). A reply that arrives while sound is still blocked is held and
  // a "Tap to hear Pip" pill appears; the browser's own voice is only a fallback when ElevenLabs is down.
  let voiceUnlocked = false, heldVoice = '';
  const voiceWanted = () => $('voiceOn').checked && (app.dataset.portal !== 'sim' || !!($('simVoice') && $('simVoice').checked));
  const SILENT = (() => { const n = 800, b = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
    b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); })();
  function unlockVoice() {
    if (voiceUnlocked) return; voiceUnlocked = true;
    const el = $('voice'); if (!el.src || el.paused) { el.src = SILENT; el.play().catch(() => {}); }
    if (heldVoice) { const t = heldVoice; heldVoice = ''; setTimeout(() => speak(t), 60); }
    changed();
  }
  addEventListener('pointerdown', unlockVoice, true); addEventListener('keydown', unlockVoice, true);
  async function speak(text) {
    if (!text) return;
    const done = () => { if (!L.speaking) return; L.speaking = false; clearTimeout(L.speakTimer); L.quietUntil = Date.now() + 700; L.followUntil = Date.now() + 20000; changed(); };
    L.speaking = true; L.seg = null; clearTimeout(L.speakTimer); L.speakTimer = setTimeout(done, 30000); changed();   // Pip mustn't hear itself
    let res = null;
    try { res = await fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) { res = null; }
    if (res && res.ok) {
      const el = $('voice'); el.onended = done; el.onerror = done; el.onpause = done; el.src = URL.createObjectURL(await res.blob());
      try { await el.play(); heldVoice = ''; return; }
      catch (e) { el.onpause = null; if (e && e.name === 'NotAllowedError') { heldVoice = text; voiceUnlocked = false; L.speaking = false; clearTimeout(L.speakTimer); changed(); return; } }
    }
    if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(text); u.onend = done; u.onerror = done; speechSynthesis.speak(u); } else done();
  }
  const hearHeld = () => { const t = heldVoice; heldVoice = ''; voiceUnlocked = true; if (t) speak(t); };

  // ---- always-on listening ------------------------------------------------------------------------------
  // The mic stays on. Band 39's mic when it is connected (the band then shows solid blue: its own "mic is on"
  // sign, which apps can't change); otherwise this device's mic while Margaret's portal is open. Loudness over
  // an adaptive noise floor cuts speech into utterances; each goes to Deepgram. Pip answers when called by name,
  // within 20 s of Pip speaking, or after Talk is tapped. Everything else is "overheard": checked for scams,
  // memory and health signs, with no reply. Paused while Pip talks and while a band prompt needs the light.
  const NAME = /\b(?:hey|hi|ok|okay)?[\s,]*\b(pip|pipp?y|pep|pipp)\b[,.!?]*\s*/i;
  function feed(x) {
    const now = Date.now();
    if (L.paused || L.speaking || now < L.quietUntil) { if (L.seg) { L.seg = null; changed(); } L.pre.length = 0; return; }
    let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i];
    const rms = Math.sqrt(e / x.length), loud = rms > Math.max(0.012, L.floor * 3);
    if (!L.seg) {
      if (!loud) { L.floor = L.floor * 0.98 + rms * 0.02; L.pre.push(x); while (L.pre.length * x.length > L.rate * 0.35) L.pre.shift(); return; }
      const pre = L.pre.splice(0); L.seg = { chunks: pre, n: pre.reduce((a, c) => a + c.length, 0), voiced: 0, last: now, rate: L.rate }; changed();
    }
    const s = L.seg; s.chunks.push(x); s.n += x.length; L.floor = L.floor * 0.999 + rms * 0.001;
    if (loud) { s.voiced += x.length; s.last = now; }
    if (now - s.last > 1100 || s.n > s.rate * 15) { L.seg = null; endUtterance(s); }
  }
  async function endUtterance(s) {
    if (s.voiced < s.rate * 0.35) return changed();                 // a cough or a door: not speech
    const all = new Int16Array(s.n); let o = 0;
    for (const c of s.chunks) { for (let i = 0; i < c.length; i++) all[o + i] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))); o += c.length; }
    L.pending++; changed();
    try {
      const res = await fetch('api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav(all, s.rate) });
      const j = await res.json(); if (!res.ok) throw new Error(j.error || res.status);
      const text = String(j.text || '').trim(); if (text) heard(text); L.err = '';
    } catch (e) { L.err = 'Couldn’t write that down: ' + (e.message || e); }
    finally { L.pending--; changed(); }
  }
  function heard(text) {
    const now = Date.now(), named = NAME.test(text);
    const recall = H.pendingRecall && now - (H.pendingRecall.at || now) < 60000;
    if (named || recall || now < L.directUntil || now < L.followUntil) {
      L.directUntil = 0;
      const t = named ? text.replace(NAME, ' ').replace(/\s+/g, ' ').trim() : text;
      return said(t.length > 1 ? t : text, 'voice');
    }
    L.heard++; H.chat.push({ from: 'heard', text, at: now }); H.transcripts.push(text); changed();
    analyze(text, 'overheard');                                      // scams, memory, health: Lisa sees what matters
  }
  async function startBandMic() {
    const k = await loadKit();
    if (!(await k.canDecodeAudio())) throw new Error('This browser can’t hear the band. Use Chrome or Edge');
    L.bandSound = new k.BandAudio((x) => feed(x)); L.bandOff = band.on('audio', (a) => L.bandSound && L.bandSound.push(a));
    micOn = true; await band.configure({ audio: true }); L.src = 'band'; L.rate = 16000;
  }
  async function stopBandMic() {
    if (L.bandOff) { L.bandOff(); L.bandOff = null; } if (L.bandSound) { try { L.bandSound.close(); } catch (_) { /* closed */ } L.bandSound = null; }
    if (band && L.src === 'band') { try { await band.configure({ audio: false }); } catch (_) { /* gone */ } }
    micOn = false; lastLedKey = ''; if (L.src === 'band') L.src = null; L.seg = null;
  }
  async function startDeviceMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser has no microphone access (use https or localhost)');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { L.denied = true; throw new Error('Microphone blocked. Allow it in the browser to let Pip listen'); }
    let ctx; try { ctx = new AudioContext({ sampleRate: 16000 }); } catch (_) { ctx = new AudioContext(); }
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(1024, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    proc.onaudioprocess = (ev) => feed(new Float32Array(ev.inputBuffer.getChannelData(0)));
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});      // resumes on her next tap otherwise
    L.dev = { stream, ctx, proc }; L.src = 'device'; L.rate = ctx.sampleRate;
  }
  function stopDeviceMic() {
    const d = L.dev; L.dev = null; if (d) { d.proc.onaudioprocess = null; d.stream.getTracks().forEach((t) => t.stop()); d.ctx.close().catch(() => {}); }
    if (L.src === 'device') L.src = null; L.seg = null;
  }
  async function syncListen() {
    if (L.busy) { L.again = true; return; }
    const needsLight = !!(band && engine.prompt());
    let want = null;
    if (L.want) {
      if (band) want = needsLight ? null : 'band';
      else if (app.dataset.portal === 'grandma' && !L.denied) want = 'device';
    }
    L.paused = L.want && needsLight ? 'light' : '';
    if (L.src === want) return;
    L.busy = true;
    try {
      if (L.src === 'band') await stopBandMic(); else if (L.src === 'device') stopDeviceMic();
      if (want === 'band') await startBandMic(); else if (want === 'device') await startDeviceMic();
      L.err = '';
    } catch (e) { L.err = e.message || String(e); if (want === 'band') { micOn = false; L.src = null; } }
    finally { L.busy = false; lastLedKey = ''; applyLed(); changed(); if (L.again) { L.again = false; syncListen(); } }
  }
  function listenLine(V) {
    const l = V.listen || {};
    if (!l.want) return { on: false, text: '🎙 Mic is off. Tap “Mic off” at the top to turn it back on.' };
    if (l.speaking) return { on: true, text: '🔈 Pip is talking…' };
    if (l.paused) return { on: false, text: '🎙 Paused so your band light can show you something' };
    if (l.hearing) return { on: true, hot: true, text: '👂 Hearing you…' };
    if (l.pending) return { on: true, text: '✍️ Writing it down…' };
    if (l.src === 'band') return { on: true, text: '🎙 Always listening through your band (blue light). Say “Pip” to talk to me.' };
    if (l.src === 'device') return { on: true, text: '🎙 Always listening on this device. Say “Pip” to talk to me.' };
    return { on: false, text: '🎙 ' + (l.err || 'Connect band 39, or allow this device’s microphone.') };
  }

  // ---- actions: local on the hub, or queued to the hub through the server --------------------------------
  const isHub = () => kind !== 'none' || !remote;                 // a device with the band, or alone
  function act(a) { if (isHub()) applyAction(a); else post(`api/actions?home=${HOME}`, a).catch(() => {}); }
  function applyAction(a) {
    switch (a.type) {
      case 'message': engine.sendMessage(a.text, a.from || 'Lisa'); break;
      case 'ack': engine.ack(a.id); break;
      case 'ack-urgent': engine.state.alerts.filter((x) => x.level === 'urgent' && !x.ack).forEach((x) => engine.ack(x.id)); H.ackAt = Date.now(); engine.note('💜', 'Lisa saw the alert and is calling', 'family'); break;
      case 'mode': setMode(a.mode); break;
      case 'gm': engine.userAction(a.action, a.via || 'screen'); break;
      case 'signal': demoSignal(a.name); break;
      case 'note': said(NOTES[a.name] || a.name, 'typed (demo)'); break;
      case 'connect-sim': connect('sim'); break;
      default: break;
    }
    changed();
  }
  const NOTES = {
    scam: 'A man called and said my grandson is in jail and needs bail. He wants me to buy gift cards today.',
    side: 'I feel sick to my stomach since the new pill, and dizzy when I stand up. Remind me to call the pharmacy tomorrow at 10.',
    memory: 'What day is it? I can’t remember if I ate. Where are my glasses? I had toast for breakfast. I had toast for breakfast.',
    language: 'Um, I went to the, um, the thingy, what’s it called, the place with the books. Um, and I got the, the thing.',
    abuse: 'My nephew yells at me and he took my bank card. I’m scared of him.',
  };

  // ---- sharing: hub posts snapshots; other devices poll -----------------------------------------------
  let remote = null, remoteAt = 0, actionSeq = 0;
  function snapshot() {
    const s = engine.state;
    return { v: 1, at: Date.now(), mode: H.mode, conn: { kind, text: connText }, status: engine.status(), prompt: engine.prompt(), led: micOn ? { color: '#3E8EF7', pattern: 'solid', say: 'solid blue: listening to you' } : engine.led(),
      nextUp: engine.nextUp(), s: { steps: s.steps, activity: s.activity, battery: s.battery, batteryState: s.batteryState, rssi: s.rssi, far: s.far, tempC: s.tempC, lastMoveAt: s.lastMoveAt, offWrist: s.offWrist, meds: s.meds, alerts: s.alerts.slice(0, 20), timeline: s.timeline.slice(0, 30), messages: s.messages.slice(-20) },
      labels: lab.labels, conditions: [...H.conditions], insights: H.insights.slice(0, 6), recall: H.recall.slice(0, 12), chat: H.chat.slice(-20), reminders: H.reminders.slice(0, 10), tracks: H.tracks.slice(0, 10),
      banner: H.banner, ackAt: H.ackAt, pipMood: H.pipMood, pipLine: Date.now() - pipLineAt < 12000 ? pipLine : null, recording: !!recording, transcripts: H.transcripts.length,
      listen: { want: L.want, src: L.src, paused: L.paused, hearing: !!L.seg, pending: L.pending, speaking: L.speaking, heard: L.heard, err: L.err } };
  }
  let lastPush = 0;
  setInterval(async () => {
    if (kind !== 'none') {                                              // the hub shares and takes actions
      if (Date.now() - lastPush > 1500) { lastPush = Date.now(); post(`api/state?home=${HOME}`, snapshot()).catch(() => {}); }
      try { const j = await (await fetch(`api/actions?home=${HOME}&after=${actionSeq}`)).json(); for (const a of j.actions || []) { actionSeq = Math.max(actionSeq, a.id); applyAction(a); } } catch (_) { /* offline */ }
    } else {                                                            // follow a hub elsewhere
      try { const j = await (await fetch(`api/state?home=${HOME}`)).json(); if (j.state && Date.now() - j.at < 30000) { remote = j.state; remoteAt = j.at; } else remote = null; render(); } catch (_) { /* offline */ }
    }
  }, 1500);
  // the first time this device becomes the hub, don't replay old queued actions
  fetch(`api/actions?home=${HOME}&after=0`).then((r) => r.json()).then((j) => { actionSeq = j.seq || 0; }).catch(() => {});

  // ---- render ---------------------------------------------------------------------------------------
  const view = () => (kind === 'none' && remote ? remote : snapshot());
  function changed() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  setInterval(() => { engine.tick(); changed(); }, 500);

  const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  function promptView(V) {
    const p = V.prompt, s = V.s, acked = Date.now() - V.ackAt < 10 * 60000;
    if (p) {
      if (p.kind === 'fall') return { kind: 'fall', title: 'Did you fall, Margaret?', body: 'If you’re all right, double-tap your band or press “I’m OK”.', btns: [['ok', 'I’m OK', 'go'], ['help', 'I need help', 'sos']], deadline: p.deadline };
      if (p.kind === 'help') return { kind: 'help', title: acked ? 'Lisa saw it 💜' : 'Help is on the way', body: acked ? 'She is calling you now. Stay where you are if you can.' : 'Lisa has been told and will call you. Stay where you are.', btns: [['ok', 'I’m OK now', 'go']] };
      if (p.kind === 'checkin') return { kind: 'checkin', title: 'Just checking in 🤍', body: 'You’ve been resting a while. Tap your band or press below so Lisa knows you’re fine.', btns: [['ok', 'I’m OK', 'go'], ['help', 'I need help', 'sos']], deadline: p.deadline };
      if (p.kind === 'night') return { kind: 'night', title: `It’s ${fmtTime(Date.now())}, night-time 🌙`, body: 'Everyone is asleep. Your bed is warm. Lisa visits on Saturday.', btns: [['ok', 'Back to bed ✓', 'go']] };
      if (p.kind === 'reminder') return { kind: 'reminder', title: `Time for your ${medName(p.med)} pills 💊`, body: 'They’re in the blue box by the kettle. Tap your band when you’ve taken them.', btns: [['done', 'Done ✓', 'go']] };
      if (p.kind === 'message') { const m = s.messages.find((x) => x.from === 'Lisa' && !x.read); return { kind: 'message', title: 'A message from Lisa 💌', quote: m ? m.text : '', btns: [['read', 'Got it ❤️', 'go'], ['speak', '🔈 Read it to me', 'soft']] }; }
      if (p.kind === 'notworn') return { kind: 'notworn', title: 'Please put your band on ⌚', body: 'It keeps you safe when you’re up and about.', btns: [['ok', 'It’s on ✓', 'go']] };
    }
    if (acked && V.banner && ['scam', 'seizure'].includes(V.banner.kind)) return { kind: 'ack', title: 'Lisa saw it 💜', body: 'She is calling you now.', btns: [['clear', 'OK ✓', 'go']] };
    if (V.banner) return Object.assign({ btns: [['clear', 'OK ✓', 'go'], ['speak', '🔈 Read it to me', 'soft']] }, V.banner);
    return null;
  }
  function promptHtml(v) {
    const left = v.deadline ? `<div class="gm-count">${Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000))}s</div>` : '';
    return `${left}<h4>${esc(v.title)}</h4>${v.body ? `<p>${esc(v.body)}</p>` : ''}${v.quote ? `<blockquote>${esc(v.quote)}</blockquote>` : ''}<div class="gm-btns">${v.btns.map(([a, l, c]) => `<button class="gm-btn ${c}" data-gm="${a}">${esc(l)}</button>`).join('')}</div>`;
  }

  // One mic switch, shown in Margaret's header and the simulator's top bar (plus the Talk tab checkbox).
  function setListen(on) { L.want = !!on; L.denied = false; localStorage.setItem('b39listen', L.want ? '1' : '0'); voiceUnlocked = true; syncListen(); changed(); }
  function renderMic(V) {
    const l = V.listen || {}, on = !!l.want, live = !!l.src;
    const label = !on ? 'Mic off' : l.paused ? 'Mic paused' : live ? 'Mic on' : 'Mic ready';
    $$('[data-mic]').forEach((b) => {
      if (b.dataset.on === String(on) && b.dataset.live === String(live) && b.dataset.label === label) return;
      b.dataset.on = String(on); b.dataset.live = String(live); b.dataset.label = label;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Microphone is on. Turn it off' : 'Microphone is off. Turn it on');
      b.querySelector('[data-mic-ico]').innerHTML = window.VexoIcons ? VexoIcons.svg(on ? 'mic' : 'micoff', 18) : '';
      b.querySelector('[data-mic-label]').textContent = label;
    });
  }
  function renderGrandma(V) {
    const s = V.s, night = V.mode === 'night';
    $('gConn').textContent = V.conn.kind !== 'none' ? V.conn.text : (remote && kind === 'none' ? 'Following Margaret’s device' : V.conn.text);
    $('gmGreet').textContent = night ? 'Sleep well, Margaret' : `${greet()}, Margaret`;
    $('gmTime').textContent = fmtTime(Date.now());
    $('gmDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const led = V.led; const ring = $('gmRing'); ring.style.setProperty('--led', led ? led.color : '#d9d3ea'); ring.dataset.pattern = led ? led.pattern : 'off';
    $('gmBandSay').textContent = led ? `Your band is ${led.say}` : V.conn.kind !== 'none' ? (night ? 'Your band is dark and watching quietly' : 'Your band is resting quietly') : 'Your band is not connected';
    const pv = promptView(V);
    const worried = pv && ['fall', 'help', 'checkin', 'scam', 'seizure'].includes(pv.kind);
    $$('svg[data-pip]').forEach((el) => { el.dataset.mood = worried ? 'worried' : night ? 'sleepy' : V.pipMood || 'calm'; });
    const idle = night ? 'Sleepy time. I’m keeping watch: if you get up, I’ll help you back. 🌙' : s.steps > 1500 ? `Lovely walking today: ${s.steps.toLocaleString()} steps! 🌼` : 'I’m keeping an eye on things. Talk to me anytime.';
    $('pipSay').textContent = V.pipLine || (worried ? 'I’m right here with you.' : idle);
    $('pipTalkSay').textContent = V.pipLine || 'Tell me anything. I’ll help, and Lisa will know what matters.';
    const box = $('gmPrompt');
    if (pv) { box.className = 'gm-prompt kind-' + pv.kind; box.innerHTML = promptHtml(pv); }
    else if (night) { box.className = 'gm-prompt kind-night'; box.innerHTML = `<h4>Goodnight 🌙</h4><ul class="gm-today"><li><span>🛏️</span>I’m listening to how you sleep</li><li><span>🚶‍♀️</span>If you get up, I’ll gently help you back</li><li><span>🆘</span>Need anything? Double-tap your band</li></ul>`; }
    else { const nx = V.nextUp, goal = V.labels.steps.goal; box.className = 'gm-prompt kind-calm'; box.innerHTML = `<h4>All is well today 🌷</h4><ul class="gm-today"><li><span>👣</span><div style="flex:1">${s.steps ? `<b>${s.steps.toLocaleString()}</b> of ${goal.toLocaleString()} steps` : 'A gentle walk would be lovely today'}<div class="energy"><i style="width:${Math.min(100, s.steps / goal * 100)}%"></i></div></div></li><li><span>💊</span>${nx ? `Next: <b>${esc(nx.text)}</b> at ${fmtTime(nx.at)}` : 'Your pills are all sorted for today'}</li>${V.reminders[0] ? `<li><span>⏰</span>${esc(V.reminders[0].what)}${V.reminders[0].when ? ' · ' + esc(V.reminders[0].when) : ''}</li>` : ''}</ul>`; }
    $('pipChat').innerHTML = V.chat.map((m) => `<li class="msg ${m.from === 'me' ? 'me' : m.from === 'heard' ? 'heard' : 'pip'}"><span>${esc(m.text)}</span><small>${m.from === 'me' ? 'You' : m.from === 'heard' ? 'Heard nearby (no reply)' : 'Pip'} · ${fmtTime(m.at)}</small></li>`).join('') || '';
    { const c = $('pipChat'), n = V.chat.length; if (c.dataset.n != n) { c.dataset.n = n; c.scrollTop = c.scrollHeight; } }
    const ll = listenLine(V); $$('[data-listen]').forEach((el) => { el.textContent = ll.text; el.classList.toggle('on', ll.on); el.classList.toggle('hot', !!ll.hot); });
    $('listenOn').checked = !!(V.listen && V.listen.want);
    $$('[data-hear]').forEach((el) => { el.hidden = !heldVoice; });
    $('mTalk').classList.toggle('on', !!V.recording || Date.now() < L.directUntil);
    $('mTalkLabel').textContent = V.recording ? 'Listening… tap when done' : Date.now() < L.directUntil ? 'Go ahead, I’m listening' : (V.listen && V.listen.src ? 'Talk to Pip (or just say “Pip”)' : 'Talk to Pip');
    $('gThread').innerHTML = s.messages.filter((m) => !String(m.text).startsWith('🎙')).slice(-10).map((m) => `<li class="msg ${m.from === 'Lisa' ? 'her' : 'me'}"><span>${esc(m.text)}</span><small>${m.from === 'Lisa' ? 'Lisa' : 'You'} · ${fmtTime(m.at)}</small></li>`).join('') || '<li class="empty">No messages yet.</li>';
    const unread = s.messages.filter((m) => m.from === 'Lisa' && !m.read).length; const b = $('gMsgBadge'); b.textContent = unread; b.classList.toggle('on', !!unread);
    const hp = $('gHelpState'); const hv = V.prompt && V.prompt.kind === 'help' ? promptView(V) : null;
    hp.className = hv ? 'gm-prompt kind-help' : 'gm-prompt kind-calm'; hp.innerHTML = hv ? promptHtml(hv) : '';
  }

  const tile = (key, value, sub, level, meter) => { const i = INFO[key]; return `<div class="sig ${level}"><button class="q" data-info="${key}" aria-label="How ${esc(i.name)} works">?</button><span class="ic">${i.icon}</span><small>${esc(i.name)}</small><b>${value}</b><span class="sub">${sub}</span>${meter != null ? `<div class="meter"><i style="width:${Math.max(3, Math.min(100, meter))}%"></i></div>` : ''}</div>`; };
  function renderCarer(V) {
    const s = V.s, L = V.labels, st = V.status;
    const pill = $('cgStatus'); pill.textContent = st.label; pill.dataset.level = st.level;
    const act = { walk: 'walking', run: 'moving briskly', still: 'resting', unknown: '—' }[s.activity] || s.activity;
    $('cSummary').textContent = V.conn.kind !== 'none' ? `${act} · ${s.steps.toLocaleString()} steps · band ${s.battery == null ? '—' : s.battery + '%'}${kind === 'none' ? ' · live from Margaret’s device' : ''}${V.listen && V.listen.src ? ' · 🎙 listening' : ''}` : (kind === 'none' && !remote && !H.chat.length && !H.transcripts.length ? 'Waiting for Margaret’s device… (code ' + HOME + ')' : 'Band not connected');
    $('nightBanner').hidden = V.mode !== 'night';
    // alerts
    const alerts = s.alerts.slice().sort((a, b) => (a.ack - b.ack) || (b.at - a.at)).slice(0, 8);
    $('cgAlerts').innerHTML = alerts.length ? alerts.map((a) => `<li class="al al-${a.level}${a.ack ? ' acked' : ''}"><div class="al-top"><b>${esc(a.title)}</b><time>${fmtTime(a.at)}</time></div><p>${esc(a.body)}</p>${a.ack ? '<span class="al-ack">Seen ✓</span>' : `<button data-ack="${a.id}">Mark as seen</button>`}</li>`).join('') : '<li class="empty">No alerts. Mom’s day is going quietly.</li>';
    const open = s.alerts.filter((a) => !a.ack && a.level !== 'good').length; $('cHomeBadge').textContent = open; $('cHomeBadge').classList.toggle('on', !!open);
    const meds = Object.entries(s.meds); const taken = meds.filter(([, v]) => v === 'taken').length;
    $('glance').innerHTML = [['Right now', act], ['Steps', s.steps.toLocaleString()], ['Pills', `${taken}/${meds.filter(([, v]) => v !== 'n/a').length || 0}`], ['Band', s.battery == null ? '—' : s.battery + '%'], ['Mode', V.mode === 'night' ? '🌙 Night' : '☀️ Day'], ['Conversations', V.transcripts]].map(([k, v]) => `<div class="gl"><small>${k}</small><b>${esc(v)}</b></div>`).join('');
    // physical
    $('physGrid').innerHTML = [
      tile('fall', L.fall.count ? `${L.fall.count} today` : 'None', L.fall.at ? `${fmtTime(L.fall.at)} · impact ${L.fall.stages.impactG} g` : 'watching', L.fall.count ? 'alert' : 'ok'),
      tile('tremor', `${L.tremor.score}/4`, L.tremor.hz ? `${L.tremor.hz} Hz · ${L.tremor.rms} °/s` : `${Math.round(L.tremor.minutesToday)} min today`, L.tremor.score >= 3 ? 'alert' : L.tremor.score ? 'watch' : 'ok', L.tremor.score * 25),
      tile('steps', s.steps.toLocaleString(), `${L.steps.cadence || 0}/min · goal ${L.steps.goal.toLocaleString()}${L.steps.discarded ? ` · ${L.steps.discarded} discarded` : ''}`, 'ok', s.steps / L.steps.goal * 100),
      tile('balance', L.balance.score == null ? '—' : `${L.balance.score}/100`, L.balance.score == null ? 'measured on walks' : `regularity ${Math.round((L.balance.regularity || 0) * 100)}%`, L.balance.score == null ? '' : L.balance.score < 55 ? 'alert' : L.balance.score < 70 ? 'watch' : 'ok', L.balance.score),
      tile('seizure', L.seizure.active ? 'Now' : L.seizure.count ? `${L.seizure.count} today` : 'None', L.seizure.seconds ? `${L.seizure.seconds}s at ${L.seizure.hz || '?'} Hz` : 'rhythmic 2–7 Hz ≥10 s', L.seizure.active || L.seizure.count ? 'alert' : 'ok'),
    ].join('');
    // memory
    const ins = V.insights[0]; const dm = ins && ins.dementia;
    const rc = V.recall; const rate = rc.length ? Math.round(100 * rc.filter((r) => r.result === 'remembered').length / rc.length) : null;
    const avg = (k) => V.insights.length ? Math.round(V.insights.slice(0, 5).reduce((t, x) => t + ((x.dementia && x.dementia[k].concern) || 0), 0) / Math.min(5, V.insights.length)) : null;
    const lvl = (n) => (n == null ? '' : n >= 50 ? 'alert' : n >= 25 ? 'watch' : 'ok');
    $('memGrid').innerHTML = [
      tile('recall', rate == null ? '—' : `${rate}%`, rc.length ? `${rc.length} memory moments` : 'ask from Margaret’s Talk tab', rate == null ? '' : rate < 50 ? 'watch' : 'ok', rate),
      tile('memory', avg('memory') == null ? '—' : `${avg('memory')}`, dm ? (dm.memory.signals[0] || 'no signs in last note') : 'from conversations', lvl(avg('memory')), avg('memory')),
      tile('language', avg('language') == null ? '—' : `${avg('language')}`, ins ? `variety ${ins.metrics.type_token_ratio} · fillers ${ins.metrics.fillers}` : 'from conversations', lvl(avg('language')), avg('language')),
      tile('cognitive', avg('cognitive') == null ? '—' : `${avg('cognitive')}`, dm ? (dm.cognitive.signals[0] || 'oriented') : 'from conversations', lvl(avg('cognitive')), avg('cognitive')),
      tile('wander', L.wander.active ? 'Now' : `${L.wander.episodes}`, L.wander.active ? `${Math.round(L.wander.minutes)} min${L.wander.far ? ' · away' : ''}` : V.mode === 'night' ? 'watching tonight' : 'night mode only', L.wander.active ? 'alert' : L.wander.episodes ? 'watch' : 'ok'),
      tile('sleep', L.sleep.epochs ? `${L.sleep.restless}% restless` : '—', V.mode === 'night' ? (L.sleep.epochs ? `${L.sleep.asleep ? 'asleep' : 'awake'} · ${L.sleep.epochs} epochs` : 'scoring…') : 'switch to Night mode', L.sleep.restless >= 30 ? 'watch' : 'ok', L.sleep.restless),
    ].join('');
    $('recallList').innerHTML = rc.map((r) => `<li><span class="res ${r.result}">${r.result}</span> · ${fmtTime(r.at)}<br><b>Q:</b> ${esc(r.q)}<br><b>Mom:</b> ${esc(r.a)}${r.hint ? ` <span class="muted">(expected: ${esc(r.hint)})</span>` : ''}</li>`).join('') || '<li class="empty">No memory moments yet. On Margaret’s Talk tab: “Pip, ask me something”.</li>';
    $('memNote').innerHTML = ins ? `<div class="ins-g"><h5>💬 What she said <span class="muted">· ${esc(ins.how)} · ${ins.source && ins.source.startsWith('openai') ? 'read by OpenAI' : 'offline rules'}</span></h5><ul><li>“${esc(ins.text)}”</li><li class="muted">${esc(ins.summary || '')}</li></ul></div>
      <div class="ins-g"><h5>🧠 This conversation</h5>${['cognitive', 'memory', 'language'].map((k) => `<div class="bar3">${k}<i><b style="width:${dm[k].concern}%"></b></i>${dm[k].concern}</div>`).join('')}<ul>${[...dm.cognitive.signals, ...dm.memory.signals, ...dm.language.signals].slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="ins-g"><h5>🌼 Lifestyle & track</h5><ul>${(ins.lifestyle || []).map((x) => `<li>${esc(x)}</li>`).join('')}${(ins.track || []).map((x) => `<li><b>${esc(x.metric)}</b> ${esc(x.value)}</li>`).join('')}</ul></div>` : '<p class="empty">When Mom talks to Pip, the conversation and what it suggests show here.</p>';
    // safety
    const sc = V.insights.find((x) => x.risk && x.risk.scam.level !== 'none'); const ab = V.insights.find((x) => x.risk && x.risk.abuse.level !== 'none' && x.risk.abuse.level !== 'low');
    const lv = (x) => (!x ? 'ok' : x === 'high' ? 'alert' : 'watch');
    $('safeGrid').innerHTML = [
      tile('scam', sc ? sc.risk.scam.level : 'None', sc ? fmtTime(sc.at) : 'Pip listens in every conversation', lv(sc && sc.risk.scam.level)),
      tile('abuse', ab ? ab.risk.abuse.level : 'None', ab ? fmtTime(ab.at) : 'checked in every conversation', lv(ab && ab.risk.abuse.level)),
    ].join('');
    $('evidence').innerHTML = V.insights.filter((x) => x.risk && (x.risk.scam.level !== 'none' || x.risk.abuse.level !== 'none')).map((x) => `<li>${fmtTime(x.at)} · ${x.risk.scam.level !== 'none' ? `<span class="lvl ${x.risk.scam.level}">scam ${x.risk.scam.level}</span> ${esc(x.risk.scam.evidence)} ` : ''}${x.risk.abuse.level !== 'none' ? `<span class="lvl ${x.risk.abuse.level}">abuse ${x.risk.abuse.level}</span> ${esc(x.risk.abuse.evidence)}` : ''}</li>`).join('') || '<li class="empty">Nothing worrying in Mom’s conversations.</li>';
    $('bandGlance').innerHTML = [['Connection', V.conn.text], ['Battery', s.battery == null ? '—' : `${s.battery}% ${s.batteryState || ''}`], ['Signal', s.rssi == null ? '—' : `${s.rssi} dBm${s.far ? ' · away from home' : ''}`], ['Last moved', fmtTime(s.lastMoveAt)], ['Worn', s.offWrist ? 'maybe not' : 'yes']].map(([k, v]) => `<div class="gl"><small>${k}</small><b>${esc(v)}</b></div>`).join('');
    // care
    $('meds').innerHTML = meds.map(([t, v]) => `<span class="med med-${v}">${fmtTime(atToday(Date.now(), t))} · ${{ pending: 'later', due: 'due now', taken: 'taken ✓', missed: 'not confirmed', 'n/a': 'n/a' }[v]}</span>`).join('');
    $('remList').innerHTML = V.reminders.map((r) => `<li>⏰ ${esc(r.what)}${r.when ? ' · ' + esc(r.when) : ''} <span class="muted">(set by Pip at ${fmtTime(r.at)})</span></li>`).join('') || '<li class="empty">Reminders Mom asks Pip for show here.</li>';
    const ses = V.insights.flatMap((x) => (x.medical ? x.medical.side_effects.map((se) => ({ se, at: x.at })) : []));
    $('sideList').innerHTML = ses.map(({ se, at }) => `<li>⚠️ ${esc(se.symptom)} <span class="muted">(${esc(se.condition)}, ${fmtTime(at)})</span></li>`).join('') || '<li class="empty">No side effects mentioned.</li>';
    const conds = V.conditions.map(([k]) => k); const recs = forConditions(conds);
    $('shop').innerHTML = recs.length ? recs.map((p) => `<div class="prod"><span class="pi">${p.icon}</span><div><b>${esc(p.name)}</b><small>${esc(p.why)} · for ${p.for.filter((c) => conds.includes(c)).map((c) => CONDITIONS[c].label.toLowerCase()).join(', ')}</small><span class="tag ${p.elig}">${ELIG[p.elig]}</span></div><label>$${p.price}<input type="checkbox" data-pick="${p.id}" ${picked.has(p.id) ? 'checked' : ''}/></label></div>`).join('') : '<p class="empty">Nothing needed right now. Suggestions appear when the band or Mom’s conversations point to something equipment could help with.</p>';
    const total = recs.filter((p) => picked.has(p.id)).reduce((t, p) => t + p.price, 0);
    $('shopFoot').hidden = !recs.length; $('shopTotal').textContent = `$${total}`;
    $('cThread').innerHTML = s.messages.filter((m) => !String(m.text).startsWith('🎙')).slice(-8).map((m) => `<li class="msg ${m.from === 'Lisa' ? 'me' : 'her'}"><span>${esc(m.text)}</span><small>${fmtTime(m.at)}${m.from === 'Lisa' ? (m.read ? ' · read ✓' : ' · delivered') : m.viaBand ? ' · from her band' : ''}</small></li>`).join('') || '<li class="empty">Messages appear on Mom’s screen; her band glows violet until she reads them.</li>';
    $('cgTimeline').innerHTML = s.timeline.slice(0, 20).map((t) => `<li class="tl tl-${t.kind}"><time>${fmtTime(t.at)}</time><span>${t.icon}</span>${esc(t.text)}</li>`).join('');
    renderSevere(V);
  }

  // ---- severe events → full-screen alert on the caregiver portal ---------------------------------------
  const hiddenSev = new Set(); let lastNotified = 0;
  function renderSevere(V) {
    const sev = V.s.alerts.filter((a) => a.level === 'urgent' && !a.ack).sort((a, b) => b.at - a.at)[0];
    const pv = promptView(V);
    const show = sev && !hiddenSev.has(sev.id) && app.dataset.portal === 'caregiver';
    $('sev').hidden = !show;
    if (!sev) return;
    $('sevTime').textContent = fmtTime(sev.at); $('sevTitle').textContent = sev.title; $('sevBody').textContent = sev.body;
    $('sevCtx').innerHTML = `<b>Mom’s screen shows:</b> ${esc(pv ? pv.title : 'her calm screen')}<br><b>Right now:</b> ${esc({ walk: 'walking', still: 'still', run: 'moving' }[V.s.activity] || '—')} · last moved ${fmtTime(V.s.lastMoveAt)} · band ${V.s.battery == null ? '—' : V.s.battery + '%'}${V.s.far ? ' · away from home' : ''}<br><span class="muted">If nobody taps “I’m on it” within 2 minutes, Ruth is next (SMS not wired yet).</span>`;
    if (sev.id !== lastNotified) {
      lastNotified = sev.id;
      if ($('notifyOn').checked && window.Notification && Notification.permission === 'granted') new Notification('URGENT · ' + sev.title, { body: sev.body, tag: 'b39-' + sev.id, requireInteraction: true });
      if ($('chimeOn').checked) chime();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]);
    }
  }
  function chime() { try { const c = new AudioContext(); [0, 0.35, 0.7].forEach((t) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.2, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.3); o.connect(g).connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.3); }); } catch (_) { /* no audio */ } }

  function render() {
    const V = view();
    app.dataset.mode = V.mode; app.dataset.conn = kind;
    renderMic(V);
    if (app.dataset.portal === 'grandma') renderGrandma(V);
    if (app.dataset.portal === 'caregiver') renderCarer(V);
  }

  // ---- caregiver AI: digest, ask, doctor draft ---------------------------------------------------------
  function facts() {
    const V = view(), L = V.labels;
    return { now: new Date().toString().slice(0, 21), mode: V.mode,
      labels: { falls: L.fall.count, tremor: L.tremor.score, tremor_minutes: Math.round(L.tremor.minutesToday), steps: V.s.steps, balance: L.balance.score, sleep_restless_pct: L.sleep.restless, wander_episodes: L.wander.episodes, seizure_like: L.seizure.count, battery: V.s.battery },
      alerts: V.s.alerts.slice(0, 15).map((a) => ({ title: a.title, level: a.level, at: fmtTime(a.at), ack: a.ack })), timeline: V.s.timeline.slice(0, 25).map((t) => `${fmtTime(t.at)} ${t.text}`),
      notes: V.insights.slice(0, 5).map((x) => `${fmtTime(x.at)}: "${x.text}" → ${x.summary}`), recall: V.recall.slice(0, 10).map((r) => `${r.result}: ${r.q}`), meds: V.s.meds, reminders: V.reminders.map((r) => `${r.what} ${r.when}`), conditions: V.conditions.map(([k]) => k) };
  }
  async function doDigest() {
    const box = $('digest'); box.querySelector('.empty, h4, dl, .sugg') && null;
    box.innerHTML = '<div class="dg-head"><b>Today with Mom</b><button class="pill small" data-act="digest">✨ Refresh</button></div><p class="empty">Pip is writing…</p>';
    const d = await post('api/digest', { facts: facts() }).catch(() => null); if (!d) return;
    box.innerHTML = `<div class="dg-head"><b>Today with Mom</b><button class="pill small" data-act="digest">✨ Refresh</button></div><h4>${esc(d.headline)}</h4><dl><dt>🏃‍♀️ Physical</dt><dd>${esc(d.physical)}</dd><dt>🧠 Memory</dt><dd>${esc(d.memory)}</dd><dt>🛡️ Safety</dt><dd>${esc(d.safety)}</dd><dt>💊 Care</dt><dd>${esc(d.care)}</dd></dl><div class="sugg">💡 ${esc(d.suggestion)}</div><p class="fine">${d.source === 'openai' ? 'Written by OpenAI from the logged facts' : 'Offline summary'} · ${fmtTime(Date.now())}</p>`;
  }
  async function doAsk(q) {
    const out = $('askOut'); out.hidden = false; out.textContent = 'Looking through Mom’s day…';
    const a = await post('api/ask', { question: q, facts: facts() }).catch(() => null);
    out.innerHTML = a ? `${esc(a.answer)}<small>Based on: ${esc((a.based_on || []).join(', '))}</small>` : 'Couldn’t answer right now.';
  }
  async function doDraft() {
    $('docEdit').value = 'Drafting…';
    const d = await post('api/doctor-draft', { facts: facts() }).catch(() => null);
    $('docEdit').value = d ? `Patient: Margaret (78) · via Vexo band 39 + conversations · ${new Date().toLocaleDateString()}\n\nS: ${d.subjective}\n\nO: ${d.objective}\n\nA: ${d.assessment}\n\nP: ${d.plan}\n\nSignals from research algorithms on a wrist band, for clinical review; not diagnostic.` : 'Couldn’t draft right now.';
  }
  async function sendDoctor() {
    const summary = $('docEdit').value.trim(); if (!summary || summary === 'Drafting…') return;
    const j = await post('api/doctor', { to: 'Dr. Patel', summary }).catch(() => ({}));
    $('docNote').textContent = j.ok ? `Sent ✓ ${fmtTime(Date.now())} to the clinic inbox` : 'Not sent';
  }
  const picked = new Set();
  async function pay() {
    const conds = view().conditions.map(([k]) => k);
    const items = forConditions(conds).filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, name: p.name, price: p.price, qty: 1 }));
    if (!items.length) { $('payNote').textContent = 'Tick an item first.'; return; }
    const j = await post('api/checkout', { items, origin: location.origin }).catch((e) => ({ error: e.message }));
    if (j.url) location.href = j.url; else $('payNote').textContent = j.message || j.error || 'Checkout unavailable.';
  }

  // ---- demo signals on the pretend band (runs on the hub) --------------------------------------------------
  async function demoSignal(name) {
    if (!sim) await connect('sim'); if (!sim) return;
    $$('[data-sig]').forEach((b) => b.classList.toggle('on', b.dataset.sig === name && name !== 'stop'));
    sim.stopMotion(); const play = (fn, sec) => sim.playMotion(fn, sec ? { seconds: sec } : undefined);
    if (name === 'tremor') { sim.setActivity('still'); play(SIGNALS.tremor(45, 5)); }
    else if (name === 'walk') { sim.setActivity('walk', { cadence: 108 }); play(SIGNALS.walk(0)); }
    else if (name === 'shaky') { sim.setActivity('walk', { cadence: 96 }); play(SIGNALS.walk(1)); }
    else if (name === 'fall') { sim.setActivity('still'); play(SIGNALS.rest(), 1); play(SIGNALS.fall(), 5); play(SIGNALS.rest()); setTimeout(() => sim && sim.tap('free-fall'), 1650); }
    else if (name === 'seizure') { sim.setActivity('still'); play(SIGNALS.seizure(4), 16); play(SIGNALS.rest()); }
    else if (name === 'restless') { if (H.mode !== 'night') setMode('night'); sim.setActivity('still'); play(SIGNALS.restless()); }
    else if (name === 'nightwalk') { if (H.mode !== 'night') setMode('night'); sim.setActivity('walk', { cadence: 90 }); play(SIGNALS.walk(0.3)); }
    else { sim.setActivity('still'); play(SIGNALS.rest()); }
  }

  // ---- "?" info sheet ---------------------------------------------------------------------------------
  function showInfo(key) {
    const i = INFO[key]; if (!i) return;
    $('sheetBody').innerHTML = `<h3>${i.icon} ${esc(i.name)}</h3><p>${esc(i.what)}</p><h5>How it works</h5><p>${esc(i.how)}</p><h5>How to trigger it</h5><p>${esc(i.trigger)}</p>
      ${i.demo ? `<h5>Try it now</h5><p><button class="pill violet" data-demo="${i.demo}">▶ Play the demo</button></p>` : ''}`;
    $('sheet').hidden = false;
  }
  function runDemoKey(d) {
    if (d.startsWith('note-')) act({ type: 'note', name: d.slice(5) });
    else if (d === 'recall') { go('grandma', 'g-talk'); askRecall(); }
    else act({ type: 'signal', name: d });
    $('sheet').hidden = true;
  }

  // ---- routing ------------------------------------------------------------------------------------------
  function go(portal, tab) {
    tab = { 'c-memory': 'c-mental', 'c-safety': 'c-financial', 'c-money': 'c-financial' }[tab] || tab;
    app.dataset.portal = portal;
    const t = tab || (portal === 'grandma' ? 'g-today' : portal === 'caregiver' ? 'c-home' : '');
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t));
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    const h = portal === 'home' ? '#/' : `#/${portal}/${t}`; if (location.hash !== h) history.replaceState(null, '', h + (url.searchParams.get('home') ? '' : ''));
    if (portal === 'caregiver' && t === 'c-home' && !$('digest').querySelector('h4') && (view().s.timeline.length > 2)) doDigest();
    window.scrollTo(0, 0); render(); syncListen();
  }
  function fromHash() { const [, p, t] = (location.hash || '#/').split('/'); go(p === 'grandma' || p === 'caregiver' || p === 'sim' ? p : 'home', t); }
  addEventListener('hashchange', fromHash);

  // ---- controls -------------------------------------------------------------------------------------------
  $('mTalk').onclick = () => { voiceUnlocked = true; talk(); };
  $('sayForm').onsubmit = (e) => { e.preventDefault(); voiceUnlocked = true; const t = $('sayText').value.trim(); if (t) { $('sayText').value = ''; if (isHub()) said(t, 'typed'); else act({ type: 'note', name: t }); } };
  $('cSend').onsubmit = (e) => { e.preventDefault(); const t = $('cMsg').value.trim(); if (t) { act({ type: 'message', text: t, from: 'Lisa' }); $('cMsg').value = ''; } };
  $('askForm').onsubmit = (e) => { e.preventDefault(); const q = $('askText').value.trim(); if (q) doAsk(q); };
  $('joinForm').onsubmit = (e) => { e.preventDefault(); const c = $('joinCode').value.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(c)) { HOME = c; localStorage.setItem('b39home', c); $('homeCode').textContent = c; remote = null; go('caregiver'); } };
  $('listenOn').onchange = (e) => setListen(e.target.checked);
  if (window.VexoIcons) $$('[data-ico]').forEach((el) => el.insertAdjacentHTML('afterbegin', VexoIcons.svg(el.dataset.ico, 18)));
  app.addEventListener('pointerdown', () => { if (L.dev && L.dev.ctx.state === 'suspended') L.dev.ctx.resume().catch(() => {}); if (L.want && !L.src && !L.busy) { L.denied = false; syncListen(); } }, true);
  $('notifyOn').onchange = (e) => { if (e.target.checked && window.Notification) Notification.requestPermission(); };
  app.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, input[data-pick], a'); if (!t) return;
    const d = t.dataset;
    if (d.pick) { t.checked ? picked.add(d.pick) : picked.delete(d.pick); render(); return; }
    if (d.go) return go(d.go, d.tab);
    if (d.tab) return go(app.dataset.portal, d.tab);
    if (d.mode) return act({ type: 'mode', mode: d.mode });
    if (d.info) return showInfo(d.info);
    if (d.demo) return runDemoKey(d.demo);
    if (d.gm) { voiceUnlocked = true; if (d.gm === 'speak') { const pv = promptView(view()); speak(pv ? `${pv.title}. ${pv.quote || pv.body || ''}` : ''); } else if (d.gm === 'clear') { H.banner = null; changed(); } else act({ type: 'gm', action: d.gm }); return; }
    if (d.reply) return act({ type: 'message', text: d.reply, from: 'Margaret' });
    if (d.ack) return act({ type: 'ack', id: Number(d.ack) });
    if (d.quick) return act({ type: 'message', text: d.quick, from: 'Lisa' });
    if (d.sig) return act({ type: 'signal', name: d.sig });
    if (d.note) return act({ type: 'note', name: d.note });
    switch (d.act) {
      case 'connect-ble': return connect('ble');
      case 'connect-sim': return kind === 'none' && remote ? act({ type: 'connect-sim' }) : connect('sim');
      case 'disconnect': return disconnect(false);
      case 'hear-pip': return hearHeld();
      case 'mic-toggle': return setListen(!L.want);
      case 'recall': voiceUnlocked = true; return askRecall();
      case 'read-latest': { const m = [...view().s.messages].reverse().find((x) => x.from === 'Lisa'); voiceUnlocked = true; return speak(m ? `Lisa says: ${m.text}` : 'No messages from Lisa yet.'); }
      case 'digest': return doDigest();
      case 'draft': return doDraft();
      case 'send-doctor': return sendDoctor();
      case 'pay': return pay();
      case 'sev-ack': $('sev').hidden = true; return act({ type: 'ack-urgent' });
      case 'sev-hide': { const s = view().s.alerts.find((a) => a.level === 'urgent' && !a.ack); if (s) hiddenSev.add(s.id); $('sev').hidden = true; return go('caregiver', 'c-home'); }
      case 'sheet-x': $('sheet').hidden = true; return;
      default: return;
    }
  });
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') $('sheet').hidden = true; });
  if (url.searchParams.get('paid') === '1') setTimeout(() => alert('Thank you! The order is paid.'), 300);
  fromHash();
  window.VexoCare = { sceneNow: () => clock.scene(), setScene: (ms) => { sceneOffset = ms == null ? 0 : ms - Date.now(); changed(); }, engine, lab, H, L, heard, feed, syncListen, promptView, said, connect, demoSignal, said, act, setMode, get kind() { return kind; }, view, go, HOME };
})();
