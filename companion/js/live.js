/* Vexo Companion · live band section.
 * Connects to the team's Vexo Open band (or the kit's pretend band), feeds every band event
 * into the care engine (live-engine.js), drives the band's light, and renders Margaret's
 * screen, Lisa's app and the life-event simulator.
 */
(function () {
  'use strict';
  const root = document.getElementById('live');
  if (!root || !window.VexoLive) return;

  // ---- the one place the band number lives -------------------------------------------
  const BAND = 39;                                   // our band: Vexo-HACK-39. Never connect to another.
  const BAND_NAME = 'Vexo-HACK-' + String(BAND).padStart(2, '0');
  // The kit sits next to this project (repo: ../vexo-open-kit) or two folders up (sandbox).
  const KIT_URLS = ['../vexo-open-kit/js/src/index.js', '../../vexo-open-kit/js/src/index.js', './vexo-open-kit/js/src/index.js']
    .map((p) => new URL(p, document.baseURI).href);

  const { createEngine, atToday, fmtTime } = window.VexoLive;
  const SCENARIOS = (window.VexoScenarios && window.VexoScenarios.SCENARIOS) || [];
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- scene clock: real time by default; the simulator can jump and speed it up -------
  const clock = {
    base: Date.now(), realBase: Date.now(), speed: 1, rate: 1, live: true,
    real: () => Date.now(),
    scene() { return this.base + (Date.now() - this.realBase) * this.rate; },
    anchor(rate) { this.base = this.scene(); this.realBase = Date.now(); this.rate = rate; },
    jump(ms, speed) { this.base = ms; this.realBase = Date.now(); this.speed = speed; this.rate = speed; this.live = false; },
    setSpeed(v) { this.speed = v; this.live = false; this.anchor(v); },
    goLive() { this.base = Date.now(); this.realBase = Date.now(); this.speed = 1; this.rate = 1; this.live = true; },
  };
  const engine = createEngine(clock);

  // ---- band connection ------------------------------------------------------------------
  let kit = null, band = null, sim = null, kind = 'none', busy = false;
  let stepsSeen = null, stepsShadow = null, lastLedKey = '', ledBusy = false;
  const signalLog = [];

  async function loadKit() {
    if (kit) return kit;
    if (location.protocol === 'file:') throw Object.assign(new Error('file'), { code: 'file' });
    let last;
    for (const url of KIT_URLS) {
      try { kit = await import(url); return kit; } catch (e) { last = e; }
    }
    throw last;
  }

  function setConn(text, level) { const el = $('lvConnState'); el.textContent = text; el.dataset.level = level || ''; }

  async function connect(which) {
    if (busy) return; busy = true;
    stopScenario(false);
    try {
      await disconnect(true);
      if (which === 'ble') {
        setConn(`Looking for ${BAND_NAME}… pick it in the browser’s list`, 'wait');
        const k = await loadKit();
        band = await k.Band.connect(BAND, { autoReconnect: true });
        kind = 'ble';
      } else {
        try {
          const k = await loadKit();
          sim = new k.SimTransport(BAND, { autoTap: false });
          band = await k.Band.connect(BAND, { transport: sim, autoReconnect: true });
          kind = 'sim';
        } catch (e) {
          if (e.code !== 'file' && !/import|module|fetch/i.test(String(e.message))) throw e;
          sim = band = new LocalBand(BAND_NAME);      // opened by double-click: the in-page stand-in
          kind = 'local';
        }
        sim.setActivity('still');
      }
      wire(band);
      await band.configure({ events: true, activity: true, battery: true, temperature: true, motion: 10, link: kind !== 'serial' });
      engine.state.connected = true;
      engine.ingest({ type: 'connect', transport: kind, name: band.name || BAND_NAME });
      lastLedKey = ''; applyLed();
      setConn(kind === 'ble' ? `Connected to ${band.name}` : kind === 'sim' ? `Pretend ${BAND_NAME} (kit simulator)` : `Pretend ${BAND_NAME} (in-page stand-in)`, 'ok');
    } catch (e) {
      band = sim = null; kind = 'none';
      if (e.code === 'file') setConn('This page was opened as a file, so it cannot load the kit or use Bluetooth. Serve the folder that holds vexo-open-kit (python3 -m http.server 8000 --bind 127.0.0.1) and open this page through http://localhost:8000/. The pretend band below still works.', 'err');
      else setConn(e.message || String(e), 'err');
    } finally { busy = false; renderConnButtons(); }
  }

  async function disconnect(quiet) {
    const b = band; band = null; sim = null; kind = 'none'; stepsSeen = stepsShadow = null;
    if (b) { try { await b.disconnect(); } catch (_) { /* already gone */ } }
    if (!quiet) { engine.ingest({ type: 'disconnect', reason: 'closed' }); setConn('Not connected', ''); renderConnButtons(); }
  }

  function wire(b) {
    const gestures = ['tap', 'double-tap', 'free-fall', 'tilt', 'orientation', 'motion-start', 'motion-stop'];
    for (const g of gestures) b.on(g, (e) => { note(g, e.face ? `face ${e.face}` : ''); engine.ingest({ type: g }); });
    b.on('activity', (e) => {
      stepsSeen = e.steps; stepsShadow = Math.max(stepsShadow || 0, e.steps);
      note('activity', `${e.state} · ${e.cadence} spm · steps ${e.steps}`, true);
      engine.ingest({ type: 'activity', state: e.state, steps: e.steps, cadence: e.cadence, motion: e.motion });
    });
    b.on('battery', (e) => { note('battery', `${e.percent}% ${e.state}`); engine.ingest({ type: 'battery', percent: e.percent, state: e.state }); });
    b.on('temperature', (e) => { note('temperature', `${e.celsius.toFixed(1)} °C (chip)`, true); engine.ingest({ type: 'temperature', celsius: e.celsius }); });
    b.on('link', (e) => { note('link', `rssi ${e.rssi == null ? '—' : e.rssi + ' dBm'}`, true); engine.ingest({ type: 'link', rssi: e.rssi }); });
    let win = [];
    b.on('motion', (e) => {
      if (e.ax == null) return;
      win.push(Math.sqrt(e.ax * e.ax + e.ay * e.ay + e.az * e.az));
      if (win.length >= 10) {
        const mean = win.reduce((a, v) => a + v, 0) / win.length;
        const std = Math.sqrt(win.reduce((a, v) => a + (v - mean) * (v - mean), 0) / win.length);
        note('motion', `|a| ${mean.toFixed(3)} g ± ${std.toFixed(4)} (10 samples)`, true);
        engine.ingest({ type: 'motion-summary', mean, std }); win = [];
      }
    });
    b.on('notice', (e) => { note('notice', e.kind); engine.ingest({ type: 'notice', kind: e.kind }); });
    b.on('disconnect', (e) => {
      if (b !== band) return;
      note('disconnect', e.reason + (e.reconnect ? ' · ' + e.reconnect : ''));
      engine.ingest({ type: 'disconnect', reason: e.reason });
      if (e.reason !== 'closed') { band = sim = null; kind = 'none'; setConn(`Lost ${BAND_NAME}. Double-tap the band, then Connect again`, 'err'); renderConnButtons(); }
    });
    b.on('reconnecting', () => { note('reconnecting', ''); setConn(`Link dropped. Reconnecting to ${BAND_NAME}…`, 'wait'); engine.ingest({ type: 'disconnect', reason: 'lost' }); });
    b.on('reconnected', () => { note('reconnected', ''); setConn(`Reconnected to ${BAND_NAME}`, 'ok'); lastLedKey = ''; engine.ingest({ type: 'reconnected' }); });
  }

  // ---- the band's light follows the engine ---------------------------------------------
  async function applyLed() {
    if (!band || ledBusy) return;
    const want = engine.led();
    const key = want ? `${want.color}/${want.pattern}/${want.period}/${want.brightness}` : 'off';
    if (key === lastLedKey) return;
    ledBusy = true;
    try {
      if (want) await band.setLed(want.color, { brightness: want.brightness, pattern: want.pattern, period: want.period });
      else await band.ledOff();
      lastLedKey = key;
    } catch (e) { note('led', 'refused: ' + (e.code || e.message)); lastLedKey = key; }
    finally { ledBusy = false; }
  }

  // ---- in-page stand-in for the pretend band (only when the kit cannot load) --------------
  function LocalBand(name) {
    const h = {}; let timer = null;
    const st = { activity: 'walk', cadence: 110, steps: 1200, battery: 87, bstate: 'battery', rssi: -55, still: false, link: true };
    const fire = (n, e) => (h[n] || []).forEach((fn) => fn(Object.assign({ t: Date.now(), time: Date.now() }, e)));
    this.name = name; this.transportKind = 'local';
    this.on = (n, fn) => { (h[n] = h[n] || []).push(fn); };
    this.configure = async () => {
      fire('battery', { percent: st.battery, state: st.bstate });
      timer = setInterval(() => {
        if (!st.link) return;
        st.steps += Math.round(st.cadence / 60);
        fire('activity', { state: st.activity, steps: st.steps, cadence: st.cadence, motion: st.activity === 'still' ? 0.01 : 0.3 });
        fire('link', { rssi: st.rssi });
        for (let i = 0; i < 10; i++) {
          const w = st.still ? 0 : 0.05 * Math.sin(Date.now() / 300 + i);
          fire('motion', { ax: w, ay: w / 2, az: 1 + (st.still ? 0 : w / 3), gx: 0, gy: 0, gz: 0 });
        }
      }, 1000);
    };
    this.setLed = async () => {}; this.ledOff = async () => {};
    this.disconnect = async () => { clearInterval(timer); fire('disconnect', { reason: 'closed' }); };
    this.setActivity = (a, o) => { st.activity = a; st.cadence = (o && o.cadence) || { still: 0, walk: 110, run: 165 }[a]; if (o && o.steps != null) st.steps = o.steps; };
    this.tap = (k) => fire(k, { kind: k });
    this.playMotion = () => { st.still = true; }; this.stopMotion = () => { st.still = false; };
    this.setBattery = (p, s) => { st.battery = p; st.bstate = s || 'battery'; fire('battery', { percent: p, state: st.bstate }); };
    this.setRssi = (v) => { st.rssi = v == null ? -55 : v; };
    this.dropLink = (sec) => { st.link = false; fire('reconnecting', {}); setTimeout(() => { st.link = true; fire('reconnected', {}); }, (sec || 1) * 1000); };
  }

  // ---- fake life events -------------------------------------------------------------------
  const actions = {
    activity(step) {
      const o = {};
      if (step.addSteps) { const base = Math.max(stepsShadow || 0, stepsSeen || 0, 1200); o.steps = base + step.addSteps; stepsShadow = o.steps; }
      sim.setActivity(step.arg, o);
    },
    gesture(step) { sim.tap(step.arg); },
    offWrist(step) { if (step.arg) sim.playMotion(() => ({})); else sim.stopMotion(); },
    battery(step) { sim.setBattery(step.arg, step.state || 'battery'); },
    rssi(step) { sim.setRssi(step.arg); },
    dropLink(step) { sim.dropLink(step.arg || 3); },
    message(step) { engine.sendMessage(step.arg, 'Lisa'); },
    reply(step) { engine.sendMessage(step.arg, 'Margaret'); },
    note() {},
  };

  let run = null;
  async function needSim() {
    if (sim && band) return true;
    await connect('sim');
    return !!sim;
  }
  async function playScenario(id) {
    const sc = SCENARIOS.find((x) => x.id === id); if (!sc) return;
    if (!(await needSim())) return;
    clock.jump(atToday(Date.now(), sc.start), sc.speed);
    engine.reset(clock.scene());
    Object.assign(engine.state, { connected: true, transport: kind, bandName: band.name || BAND_NAME });
    sim.stopMotion(); sim.setRssi(null); sim.setBattery(87, 'battery');
    lastLedKey = '';
    run = { sc, i: 0, last: Date.now(), done: false, said: `Started at ${fmtTime(clock.scene())}` };
    renderAll();
  }
  function stopScenario(render) { run = null; if (render !== false) renderAll(); }
  function stepRun() {
    if (!run || run.done || !sim) return;
    const step = run.sc.steps[run.i];
    if (!step) { run.done = true; run.said = 'Finished. Look at both screens'; return; }
    const due = step.at ? clock.scene() >= atToday(clock.scene(), step.at) : Date.now() - run.last >= step.wait * 1000;
    if (!due) return;
    try { actions[step.do](step); } catch (e) { note('sim', e.message); }
    if (step.note) run.said = step.note;
    run.i++; run.last = Date.now();
  }
  async function manual(act, arg) {
    if (!(await needSim())) return;
    const step = { do: act, arg };
    if (act === 'activity' && arg === 'walk') step.addSteps = 400;
    if (act === 'battery' && arg === 'charging') { step.arg = Math.max(engine.state.battery || 15, 15); step.state = 'charging'; }
    actions[act](step);
    renderAll();
  }

  // ---- signal log ---------------------------------------------------------------------------
  const lastNoisy = {};
  function note(type, text, noisy) {
    if (noisy) { const t = Date.now(); if (lastNoisy[type] && t - lastNoisy[type] < 2500) return; lastNoisy[type] = t; }
    signalLog.unshift({ at: new Date(), type, text });
    if (signalLog.length > 40) signalLog.length = 40;
    logDirty = true;
  }
  let logDirty = true;

  // ---- render --------------------------------------------------------------------------------
  const PROMPTS = {
    fall: () => ({ title: 'Did you fall, Margaret?', body: 'If you’re all right, double-tap your band or press “I’m OK”.', btns: [['ok', 'I’m OK', 'go'], ['help', 'I need help', 'sos']], countdown: true }),
    help: () => ({ title: 'Help is on the way', body: 'Lisa has been told and is calling you now. Stay where you are.', btns: [['ok', 'I’m OK now', 'go']] }),
    checkin: () => ({ title: 'Just checking in 🤍', body: 'You’ve been resting a while. Tap your band or press below so Lisa knows you’re fine.', btns: [['ok', 'I’m OK', 'go'], ['help', 'I need help', 'sos']], countdown: true }),
    night: (s, now) => ({ title: `It’s ${fmtTime(now)}, night-time`, body: 'Everyone is asleep. Your bed is warm. Lisa visits on Saturday.', btns: [['ok', 'Back to bed ✓', 'go']] }),
    reminder: (s, now, p) => ({ title: `Time for your ${engine.medName(p.med)} pills 💊`, body: 'They’re in the blue box by the kettle. Tap your band when you’ve taken them.', btns: [['done', 'Done ✓', 'go']] }),
    message: (s) => { const m = s.messages.find((x) => x.from === 'Lisa' && !x.read); return { title: 'A message from Lisa 💌', quote: m ? m.text : '', btns: [['read', 'Got it ❤️', 'go'], ['speak', '🔈 Read it to me', 'soft']] }; },
    notworn: () => ({ title: 'Please put your band on ⌚', body: 'It keeps you safe when you’re up and about.', btns: [['ok', 'It’s on ✓', 'go']] }),
  };

  function greet(now) { const h = new Date(now).getHours(); return h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

  function renderGrandma() {
    const s = engine.state, now = clock.scene(), p = engine.prompt(), led = engine.led();
    const d = new Date(now);
    $('gmGreet').textContent = `${greet(now)}, Margaret`;
    $('gmTime').textContent = fmtTime(now);
    $('gmDate').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const ring = $('gmRing');
    ring.style.setProperty('--led', led ? led.color : '#d9d3ea');
    ring.dataset.pattern = led ? led.pattern : 'off';
    $('gmBandSay').textContent = led ? `Your band is ${led.say}` : (band ? 'Your band is resting quietly' : 'Your band is not connected');
    const box = $('gmPrompt');
    if (p) {
      const v = PROMPTS[p.kind](s, now, p);
      let left = '';
      if (v.countdown && p.deadline) { const sec = Math.max(0, Math.ceil((p.deadline - Date.now()) / 1000)); left = `<div class="gm-count">${sec}s</div>`; }
      box.className = 'gm-prompt kind-' + p.kind;
      box.innerHTML = `${left}<h4>${esc(v.title)}</h4>${v.body ? `<p>${esc(v.body)}</p>` : ''}${v.quote ? `<blockquote>${esc(v.quote)}</blockquote>` : ''}
        <div class="gm-btns">${v.btns.map(([a, l, c]) => `<button class="gm-btn ${c}" data-gm="${a}">${esc(l)}</button>`).join('')}</div>`;
    } else {
      const nx = engine.nextUp();
      const lastLisa = [...s.messages].reverse().find((m) => m.from === 'Lisa');
      box.className = 'gm-prompt kind-calm';
      box.innerHTML = `<h4>All is well today 🌷</h4>
        <ul class="gm-today">
          <li><span>👣</span>${s.steps ? `You’ve walked <b>${s.steps.toLocaleString()}</b> steps` : 'A gentle walk would be lovely today'}</li>
          <li><span>💊</span>${nx ? `Next: <b>${esc(nx.text)}</b> at ${fmtTime(nx.at)}` : 'Your pills are all sorted for today'}</li>
          ${lastLisa ? `<li><span>💌</span>Lisa said: “${esc(lastLisa.text)}”</li>` : ''}
        </ul>`;
    }
  }

  function renderCarer() {
    const s = engine.state, now = clock.scene(), st = engine.status();
    const pill = $('cgStatus'); pill.textContent = st.label; pill.dataset.level = st.level;
    const act = { walk: 'walking', run: 'moving briskly', still: 'resting', unknown: 'unknown' }[s.activity] || s.activity;
    const meds = Object.entries(s.meds);
    const taken = meds.filter(([, v]) => v === 'taken').length;
    $('cgSummary').textContent = !band ? 'Band not connected, so nothing is coming in.' :
      `Mom is ${act}${s.far ? ' away from home' : ''} · ${s.steps.toLocaleString()} steps · pills ${taken}/${meds.filter(([, v]) => v !== 'n/a').length}`;
    $('cgActivity').textContent = act[0].toUpperCase() + act.slice(1);
    $('cgMoved').textContent = `last moved ${fmtTime(s.lastMoveAt)}${s.offWrist ? ' · band off wrist?' : ''}`;
    $('cgSteps').textContent = s.steps.toLocaleString();
    $('cgStepBar').style.width = Math.min(100, (s.steps / engine.cfg.stepGoal) * 100) + '%';
    $('cgMeds').innerHTML = meds.map(([t, v]) => `<span class="med med-${v}">${fmtTime(atToday(now, t))} · ${{ pending: 'later', due: 'due now', taken: 'taken ✓', missed: 'not confirmed', 'n/a': 'n/a' }[v]}</span>`).join('');
    $('cgBand').textContent = band ? `${s.battery == null ? '—' : s.battery + '%'}${s.batteryState === 'charging' ? ' ⚡' : ''}` : 'offline';
    $('cgBandSub').textContent = band ? `${s.rssi == null ? 'signal —' : s.rssi + ' dBm'}${s.tempC != null ? ` · chip ${s.tempC.toFixed(0)}°C` : ''}` : 'connect band 39 above';
    const alerts = s.alerts.slice().sort((a, b) => (a.ack - b.ack) || (b.at - a.at)).slice(0, 6);
    $('cgAlerts').innerHTML = alerts.length ? alerts.map((a) => `<li class="al al-${a.level}${a.ack ? ' acked' : ''}">
        <div class="al-top"><b>${esc(a.title)}</b><time>${fmtTime(a.at)}</time></div><p>${esc(a.body)}</p>
        ${a.ack ? '<span class="al-ack">Seen ✓</span>' : `<button data-ack="${a.id}">Mark as seen</button>`}</li>`).join('')
      : '<li class="empty">No alerts. Mom’s day is going quietly.</li>';
    $('cgThread').innerHTML = s.messages.slice(-6).map((m) => `<li class="msg ${m.from === 'Lisa' ? 'me' : 'her'}">
        <span>${esc(m.text)}</span><small>${fmtTime(m.at)}${m.from === 'Lisa' ? (m.read ? ' · read ✓' : ' · delivered') : m.viaBand ? ' · from her band' : ''}</small></li>`).join('')
      || '<li class="empty">Messages appear on Mom’s screen, and her band glows violet until she reads them.</li>';
    $('cgTimeline').innerHTML = s.timeline.slice(0, 14).map((t) => `<li class="tl tl-${t.kind}"><time>${fmtTime(t.at)}</time><span>${t.icon}</span>${esc(t.text)}</li>`).join('');
  }

  function renderSim() {
    const now = clock.scene();
    $('lvClock').textContent = fmtTime(now);
    $('lvClockSub').textContent = clock.live ? 'live time' : `simulated · ${clock.rate === 1 && clock.speed !== 1 ? 'slowed to real time while waiting for Margaret' : clock.speed + '× speed'}`;
    document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', !clock.live && Number(b.dataset.speed) === clock.speed));
    const r = $('lvRun');
    if (run) {
      r.hidden = false;
      $('lvRunTitle').textContent = `${run.sc.icon} ${run.sc.title}`;
      $('lvRunSay').textContent = run.said;
      $('lvRunBar').style.width = (run.done ? 100 : (run.i / run.sc.steps.length) * 100) + '%';
    } else r.hidden = true;
    document.querySelectorAll('[data-scn]').forEach((b) => b.classList.toggle('on', !!run && run.sc.id === b.dataset.scn));
    if (logDirty) {
      $('lvLog').innerHTML = signalLog.length ? signalLog.map((l) => `<li><time>${l.at.toLocaleTimeString('en-US', { hour12: false })}</time><b>${esc(l.type)}</b>${esc(l.text)}</li>`).join('')
        : '<li class="empty">Nothing yet. Connect band 39 or start a scenario.</li>';
      $('lvSigCount').textContent = `${engine.state.signals.toLocaleString()} events from ${kind === 'ble' ? BAND_NAME : kind === 'none' ? 'no band' : 'the pretend band'}`;
      logDirty = false;
    }
  }

  function renderConnButtons() {
    $('lvConnect').disabled = busy || kind === 'ble';
    $('lvUseSim').disabled = busy || kind === 'sim' || kind === 'local';
    $('lvDisc').disabled = busy || kind === 'none';
    root.dataset.conn = kind;
  }

  let raf = 0;
  function renderAll() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderGrandma(); renderCarer(); renderSim(); }); }
  engine.subscribe(() => { renderAll(); applyLed(); });

  // ---- the heartbeat: time passes, schedules fire, the light follows ------------------------
  setInterval(() => {
    const want = engine.wantsRealtime() ? 1 : clock.speed;
    if (!clock.live && clock.rate !== want) clock.anchor(want);
    stepRun();
    engine.tick();
  }, 250);

  // ---- controls -------------------------------------------------------------------------------
  $('lvConnect').addEventListener('click', () => connect('ble'));
  $('lvUseSim').addEventListener('click', () => connect('sim'));
  $('lvDisc').addEventListener('click', () => { stopScenario(); disconnect(false); });
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.gm) {
      const a = t.dataset.gm;
      if (a === 'speak') {
        const m = engine.state.messages.find((x) => x.from === 'Lisa' && !x.read);
        if (m && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(`Lisa says: ${m.text}`));
      } else engine.userAction(a, 'screen');
    } else if (t.dataset.reply) engine.sendMessage(t.dataset.reply, 'Margaret');
    else if (t.dataset.ack) engine.ack(Number(t.dataset.ack));
    else if (t.dataset.quick) engine.sendMessage(t.dataset.quick, 'Lisa');
    else if (t.dataset.scn) playScenario(t.dataset.scn);
    else if (t.dataset.act) manual(t.dataset.act, t.dataset.arg === 'true' ? true : t.dataset.arg === 'false' ? false : isNaN(Number(t.dataset.arg)) ? t.dataset.arg : Number(t.dataset.arg));
    else if (t.dataset.speed) { clock.setSpeed(Number(t.dataset.speed)); renderAll(); }
    else if (t.dataset.jump) { clock.jump(atToday(Date.now(), t.dataset.jump), clock.live ? 60 : clock.speed); engine.reset(clock.scene()); Object.assign(engine.state, { connected: !!band, transport: kind }); renderAll(); }
    else if (t.id === 'lvLive') { stopScenario(false); clock.goLive(); engine.reset(clock.scene()); Object.assign(engine.state, { connected: !!band, transport: kind }); renderAll(); }
    else if (t.id === 'lvStop') stopScenario();
  });
  $('cgSend').addEventListener('submit', (ev) => { ev.preventDefault(); const i = $('cgMsg'); engine.sendMessage(i.value, 'Lisa'); i.value = ''; });

  // scenario cards
  $('lvScenarios').innerHTML = SCENARIOS.map((sc) => `<button class="scn" data-scn="${sc.id}">
      <span class="scn-ic">${sc.icon}</span><b>${esc(sc.title)}</b><small>${esc(sc.blurb)}</small>
      <span class="scn-meta">${fmtTime(atToday(Date.now(), sc.start))} · ${sc.speed}×</span></button>`).join('');
  $('lvBandLabel').textContent = BAND_NAME;
  if (location.protocol === 'file:') setConn('Opened as a file: Bluetooth needs the page served from localhost (see the note below). The pretend band works here.', 'err');
  renderConnButtons(); renderAll();
  setInterval(renderAll, 1000);

  window.VexoLiveApp = { engine, clock, connect, disconnect, playScenario, manual, get band() { return band; }, get kind() { return kind; }, get run() { return run; }, BAND };
})();
