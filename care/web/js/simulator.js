/* Band 39 · Event simulator: Margaret's whole day, every event the product can capture, grouped as mental,
 * financial and physical health. A voxel stage shows Margaret (and the band on her wrist) acting each event out;
 * a phone shows what reaches Lisa. Everything runs on the hub through the same paths as the real thing:
 *   voice  → heard(text): the always-on mic's path after Deepgram ("Pip, …" gets a reply; the rest is overheard)
 *   motion → demoSignal(name): synthetic 50 Hz accel + gyro played on the pretend band, read by the motion lab
 *   band   → care-engine events (taps, battery, pills, stillness) exactly as the band would send them
 * The stage (js/sim-stage.js, three.js) is optional: without WebGL the page still works.
 */
(function () {
  'use strict';
  const V = window.VexoCare; if (!V) return;
  const { engine, H, L } = V;
  const I = (n, s) => window.VexoIcons.svg(n, s);
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const plain = (t) => String(t == null ? '' : t).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s{2,}/g, ' ').trim();
  const esc = (t) => plain(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- stage (voxel Margaret) ---------------------------------------------------------------------------
  let stage = null;
  const stageCall = (fn, ...a) => { try { if (stage && stage[fn]) return stage[fn](...a); } catch (e) { console.warn('stage', fn, e); } return null; };
  function act(name, opts, say) { stageCall('act', name, opts || {}); if (say) stageCall('say', say, 5200); }
  function loadStage() {
    const host = $('simStage'); if (!host || stage) return;
    import(new URL('js/sim-stage.js', document.baseURI).href)
      .then((m) => { stage = m.createStage(host, {}); host.classList.add('ready'); lastLed = ''; lastNight = null; render(); stageCall('act', 'idle'); })
      .catch((e) => { host.classList.add('nogl'); host.querySelector('.stage-fallback').textContent = 'The 3D view needs WebGL. Every event still runs below.'; console.warn(e); });
  }

  // ---- helpers that drive the real pipelines -----------------------------------------------------------
  async function band() { if (V.kind === 'none') { await V.connect('sim'); await wait(600); } }
  function day() { if (V.H.mode === 'night') V.setMode('day'); }
  function night() { const f = $('fastDemo'); if (f) f.checked = true; if (V.H.mode !== 'night') V.setMode('night'); }
  function voice(text) { L.directUntil = 0; L.followUntil = 0; H.pendingRecall = null; V.heard(text); }
  function pill(minsAgo) {
    const t = hhmm(V.sceneNow() - minsAgo * 60000);
    if (!engine.cfg.medTimes.includes(t)) engine.cfg.medTimes.push(t);
    engine.state.meds[t] = 'pending'; engine.tick(); return t;
  }
  function recall(answer) {
    const q = { question: 'Who is coming to visit on Sunday?', hint: 'Lisa and the twins', at: Date.now() };
    H.chat.push({ from: 'pip', text: q.question, at: Date.now() });
    L.directUntil = 0; L.followUntil = 0; H.pendingRecall = q; V.heard(answer);
  }
  // Mom's safe card (js/money.js, from suarezc/band39-live): purchases go through the same card rules as Lisa's demo row
  const M = () => window.VexoMoney;
  function card(cents, shop, category) { const m = M(); if (m) m.buy(cents, shop, category); }
  // voice event: the line is spoken on stage, then goes down the mic path
  const say = (text, a = 'talk', o) => () => { act(a, o, text.replace(/^Pip,\s*/, '')); voice(text); };

  // sample medication list (illustrative only, not medical advice)
  const MEDS = [['8:00 am', 'Donepezil 5 mg', 'memory'], ['8:00 am', 'Lisinopril 10 mg', 'blood pressure'], ['8:00 pm', 'Metformin 500 mg', 'blood sugar'], ['8:00 pm', 'Sertraline 25 mg (new)', 'mood']];
  // ---- the catalog --------------------------------------------------------------------------------------
  const CATS = [
    { key: 'mental', ic: 'brain', name: 'Mental health', blurb: 'Memory, thinking, mood and sleep', items: [
      { ic: 'repeat', name: 'Repeats herself', sensor: 'voice', expect: 'Memory signal rises: the same question twice.',
        run: say('Did Lisa call today? I can’t remember if Lisa called. Did Lisa call today?', 'confused') },
      { pin: 2, ic: 'chat', name: 'Speech deterioration', sensor: 'voice', expect: 'Language score rises: fillers, “thingy”, empty words.',
        run: say('Um, I went to the, um, the thingy, what’s it called, the place with the books. And I got the, the thing.') },
      { ic: 'compass', name: 'Confused about time and place', sensor: 'voice', expect: 'Orientation concern rises; Pip gently says what day it is.',
        run: say('Pip, is it Monday? I need to get ready for work at the school, the children are waiting for me.', 'confused') },
      { ic: 'puzzle', name: 'Memory moment: remembered', sensor: 'voice', expect: 'Pip asks about her own week; scored “remembered”.',
        run: () => { act('talk', {}, 'Lisa is coming with the twins!'); recall('Lisa is coming with the twins!'); } },
      { ic: 'puzzle', name: 'Memory moment: forgot', sensor: 'voice', expect: 'Scored “forgot”; Pip kindly reminds her; trend for Lisa.',
        run: () => { act('confused', {}, 'Hmm. I don’t know. Nobody, I think.'); recall('Hmm. I don’t know. Nobody, I think.'); } },
      { pin: 3, ic: 'cloud', name: 'Social isolation', sensor: 'voice', expect: 'Pip comforts her and can tell Lisa; mood is logged.',
        run: say('Pip, I haven’t talked to anyone all week. Nobody needs me anymore. What’s the point of getting up.', 'sad') },
      { ic: 'moon', name: 'Night wandering', sensor: 'motion', expect: 'Walking at night opens “Up at night?” on her screen; Lisa is told.',
        run: async () => { await band(); night(); act('nightwalk'); V.demoSignal('nightwalk'); } },
      { ic: 'bed', name: 'Restless sleep', sensor: 'motion', expect: 'Sleep movement scored per 30 s epoch; restless count rises.',
        run: async () => { await band(); night(); act('sleep', { restless: true }); V.demoSignal('restless'); } },
      { ic: 'chair', name: 'Withdrawn: no movement for 3 h', sensor: 'band', expect: 'Check-in on her screen; no answer in 25 s and Lisa hears.',
        run: async () => { await band(); day(); act('sit'); V.demoSignal('stop'); engine.state.lastMoveAt = V.sceneNow() - (engine.cfg.inactivityMin * 60000 + 1000); engine.tick(); } },
      { pin: 1, ic: 'puzzle', name: 'Memory decline', sensor: 'voice', expect: 'Memory moments slip to 2 of 5 this week; trend alert for Lisa.',
        run: () => { act('confused', {}, 'Sunday? I don’t remember anyone coming.'); recall('Sunday? I don’t remember anyone coming.');
          engine.raise('warn', 'Memory decline', 'Mom remembered 2 of 5 memory moments this week, down from 4 of 5 last week. Worth mentioning to Dr. Patel.', 'memory-decline'); } },
      { pin: 4, ic: 'shield', name: 'Abuse detection', sensor: 'voice', expect: 'Abuse flagged from her words; Pip tells Lisa quietly.',
        run: say('Pip, he shouts at me and grabbed my arm so hard it bruised. I’m scared to tell anyone.', 'sad') },
    ] },
    { key: 'financial', ic: 'coin', name: 'Financial health', blurb: 'Scams, exploitation, bills and care spending', items: [
      { pin: 1, ic: 'call', name: 'Scam attempt: grandchild in jail', sensor: 'voice', expect: 'Overheard on the phone: urgent scam alert to Lisa. Pip stays quiet.',
        run: say('Yes, this is his grandma. He’s in jail? How much is the bail? Gift cards from the pharmacy, okay, I’ll go buy them now.', 'phone') },
      { ic: 'bank', name: 'Fake bank asks for her PIN', sensor: 'voice', expect: 'Scam flagged: someone asking for bank codes.',
        run: say('You’re from my bank? My account is locked? Okay. The code you just texted me is 4 8 1 9, and my PIN is my birthday.', 'phone') },
      { ic: 'ticket', name: 'Prize win, pay a fee first', sensor: 'voice', expect: 'Scam flagged: a prize that needs a payment first.',
        run: say('I won fifty thousand dollars? I just need to wire five hundred dollars for the taxes first? Where do I send it?', 'phone') },
      { ic: 'door', name: 'Doorstep repair pressure', sensor: 'voice', expect: 'Scam flagged: cash today, high pressure.',
        run: () => { act('walk', { to: 'door' }); setTimeout(() => stageCall('say', 'My roof is falling in? Eight thousand dollars cash today? Let me find my checkbook.', 5200), 1800);
          voice('You say my roof is falling in? Eight thousand dollars cash today and you start right now? Let me find my checkbook.'); } },
      { ic: 'shield', name: 'Family member takes her money', sensor: 'voice', expect: 'Exploitation flagged; Pip tells Lisa.',
        run: say('Pip, my nephew took my bank card again and he yells when I ask for it back. I’m scared of him.', 'sad') },
      { pin: 3, ic: 'receipt', name: 'Missed bill payment', sensor: 'voice', expect: 'Logged for Lisa; memory signal; Pip offers a reminder.',
        run: say('Pip, the electric company sent a red letter. I think I forgot to pay it again, and the phone bill too.', 'confused') },
      { ic: 'cart', name: 'HSA care items for what was found', sensor: 'app', expect: 'Lisa’s Care tab: HSA/FSA-eligible items matched to today, paid with Stripe.',
        run: () => V.go('caregiver', 'c-care') },
      { ic: 'card', name: 'Pharmacy on her safe card', sensor: 'card', expect: '$18.40 approved: under $50 a purchase and $200 a week.',
        run: () => { act('walk', { to: 'door' }); card(1840, 'Corner Pharmacy', 'pharmacy'); } },
      { ic: 'card', name: 'Gift cards for $450', sensor: 'card', expect: 'Declined: over the $50 limit (or frozen after a scam call).',
        run: () => { act('phone', {}, 'They said gift cards… four hundred and fifty dollars.'); card(45000, 'Best Electronics (gift cards)', 'electronics'); } },
      { ic: 'card', name: 'Wire transfer attempt', sensor: 'card', expect: 'Declined: the card never allows wires or money orders.',
        run: () => { act('confused'); card(4000, 'QuickWire Money Transfer', 'wire'); } },
      { ic: 'unlock', name: 'Lisa unfreezes the card', sensor: 'app', expect: 'After a scam freeze, only Lisa can turn the card back on.',
        run: () => { const m = M(); if (m && m.card.status === 'frozen') m.unfreeze(); else if (m) { m.freezeByLisa(); setTimeout(() => m.unfreeze(), 1500); } } },
      { pin: 2, ic: 'card', name: 'Fraudulent transaction', sensor: 'card', expect: '$389 online charge from a shop she never uses: declined and flagged.',
        run: () => { act('sit'); card(38900, 'QuickShop Intl (online)', 'online');
          engine.raise('warn', 'Fraudulent transaction blocked', '$389.00 online charge from QuickShop Intl, a shop Mom has never used. Declined by the card limit. Check her card statement.', 'fraud'); } },
      { ic: 'card', name: 'Care items on a one-time card', sensor: 'card', expect: 'A card for this one order at a medical shop; it closes itself after paying.',
        run: () => { const m = M(), C = window.VexoCatalog; if (!m || !C) return; const conds = (V.view().conditions || []).map(([k]) => k);
          const items = (conds.length ? C.forConditions(conds) : C.PRODUCTS).slice(0, 2); m.payOnceWith(items); } },
    ] },
    { key: 'physical', ic: 'body', name: 'Physical health', blurb: 'Movement, falls, pills, symptoms and the band', items: [
      { pin: 1, ic: 'fall', name: 'Fall', sensor: 'motion', expect: 'Free-fall, impact, stillness. “Did you fall?” for 20 s, then urgent.',
        run: async () => { await band(); day(); act('fall'); V.demoSignal('fall'); } },
      { pin: 2, ic: 'hand', name: 'Tremor', sensor: 'motion', expect: 'Shaking score 0-4 from 3.5-7.5 Hz gyro power.',
        run: async () => { await band(); act('tremor'); V.demoSignal('tremor'); } },
      { ic: 'steps', name: 'Steady walk', sensor: 'motion', expect: 'Steps and cadence count up; balance measured on the walk.',
        run: async () => { await band(); day(); act('walk', { to: 'window' }); V.demoSignal('walk'); } },
      { ic: 'balance', name: 'Unsteady walk', sensor: 'motion', expect: 'Balance score drops: irregular steps, more sway.',
        run: async () => { await band(); day(); act('shaky'); V.demoSignal('shaky'); } },
      { ic: 'zap', name: 'Seizure-like movement', sensor: 'motion', expect: 'Rhythmic 2-7 Hz shaking for 10+ s: urgent, Lisa is called.',
        run: async () => { await band(); act('seizure'); V.demoSignal('seizure'); } },
      { ic: 'clock', name: 'Pill reminder', sensor: 'band', expect: 'The band glows; her screen asks “Pills taken?”.',
        run: async () => { await band(); act('walk', { to: 'table' }); pill(1); } },
      { ic: 'pill', name: 'Pills taken (tap the band)', sensor: 'band', expect: 'Reminder clears; Lisa sees “pills taken”.',
        run: async () => { await band(); act('pills'); if (!Object.values(engine.state.meds).includes('due')) { pill(1); await wait(700); } engine.userAction('done', 'band tap'); } },
      { ic: 'pillx', name: 'Pills missed', sensor: 'band', expect: 'No answer for 45 min: Lisa sees “pills not confirmed”.',
        run: async () => { await band(); act('sit'); pill(engine.cfg.medWindowMin + 1); } },
      { ic: 'sick', name: 'Side effects', sensor: 'voice', expect: 'Nausea and dizziness logged; care items suggested; doctor note.',
        run: say('Pip, I feel sick to my stomach since the new pill, and dizzy when I stand up. Remind me to call the pharmacy tomorrow at 10.', 'sad') },
      { ic: 'heart', name: 'Chest pain', sensor: 'voice', expect: 'Pip treats it as urgent and calls for help.',
        run: say('Pip, my chest feels tight and my left arm aches. I feel funny.', 'sad') },
      { ic: 'sos', name: 'SOS: asks for help', sensor: 'band', expect: 'Urgent: “Mom pressed HELP”, with Call Mom, Call Ruth and 911.',
        run: async () => { await band(); act('sos'); engine.userAction('help', 'band'); } },
      { ic: 'tap', name: '“Call me” double-tap', sensor: 'band', expect: 'Lisa sees “Mom would like a call”.',
        run: async () => { await band(); act('tap'); engine.ingest({ type: 'double-tap' }); } },
      { ic: 'watch', name: 'Band off her wrist', sensor: 'band', expect: 'Perfectly still for 2 h: “Band may be off Mom’s wrist”.',
        run: async () => { await band(); act('bandoff'); engine.state.offWrist = false; engine.state.stillSince = V.sceneNow() - (engine.cfg.notWornMin * 60000 + 1000); engine.tick(); } },
      { pin: 3, ic: 'clock', name: 'Medication list', sensor: 'app', expect: 'Today’s medicines on her screen and in Lisa’s app.',
        run: () => { act('walk', { to: 'table' }); const list = MEDS.map((m) => `${m[0]} ${m[1]}`).join(' · ');
          H.banner = { kind: 'calm', title: 'Today’s medicines', body: list }; engine.note('💊', 'Medication list: ' + list, 'care'); V.engine.tick(); } },
      { pin: 4, ic: 'pill', name: 'Medicine taken (told the band)', sensor: 'band', expect: 'She tells the band she took them; reminder clears; Lisa sees it.',
        run: async () => { await band(); act('tap', {}, 'I took my morning pills.'); if (!Object.values(engine.state.meds).includes('due')) { pill(1); await wait(700); }
          engine.userAction('done', 'told the band'); engine.note('💊', 'Mom told the band she took her morning medicines.', 'care'); } },
      { ic: 'battery', name: 'Low band battery', sensor: 'band', expect: 'Margaret and Lisa are reminded to charge it.',
        run: async () => { await band(); act('idle'); engine.state.lowBatteryFlagged = false; engine.ingest({ type: 'battery', percent: 12, state: 'discharging' }); } },
    ] },
  ];
  const ALL = CATS.flatMap((c) => c.items.map((it, i) => Object.assign(it, { cat: c.key, id: c.key + '-' + i })));
  const byId = (id) => ALL.find((x) => x.id === id);
  const SENSOR = { voice: ['mic', 'Voice'], motion: ['wave', 'Motion'], band: ['watch', 'Band'], app: ['phone', 'App'], card: ['card', 'Card'] };

  // ---- a full day: every event in time order, Night mode at 10:30 pm, the small hours, next morning ---------
  // gap = real seconds before the next step (motion needs a few seconds of signal; voice needs Deepgram/OpenAI time).
  const DAYPLAN = [
    { t: '07:30', id: 'physical-5' }, { t: '07:35', id: 'physical-6' }, { t: '08:10', id: 'physical-2', gap: 8 },
    { t: '09:00', id: 'mental-0' }, { t: '09:20', id: 'financial-7' }, { t: '09:40', id: 'financial-0' }, { t: '09:55', id: 'financial-8' }, { t: '10:15', id: 'physical-1', gap: 9 },
    { t: '10:30', id: 'financial-10' }, { t: '10:50', id: 'financial-1' }, { t: '11:30', id: 'mental-1' }, { t: '12:15', id: 'physical-8' },
    { t: '13:00', id: 'mental-8' }, { t: '14:00', id: 'mental-3' }, { t: '14:30', id: 'financial-2' },
    { t: '15:00', id: 'physical-3', gap: 8 }, { t: '15:30', id: 'physical-0', gap: 9, after: () => { engine.userAction('ok', 'double-tap'); act('getup'); } },
    { t: '16:00', id: 'financial-3' }, { t: '16:15', id: 'financial-9' }, { t: '16:30', id: 'financial-5' }, { t: '17:00', id: 'mental-4' },
    { t: '17:30', id: 'financial-4' }, { t: '18:00', id: 'mental-2' }, { t: '18:30', id: 'mental-5' },
    { t: '19:00', id: 'physical-9' }, { t: '19:30', id: 'physical-4', gap: 18 }, { t: '20:00', id: 'physical-11' },
    { t: '20:45', id: 'physical-7' }, { t: '21:15', id: 'physical-12' }, { t: '21:45', id: 'physical-13' },
    { t: '22:30', mode: 'night', label: 'Bedtime', ic: 'moon' },
    { t: '23:30', id: 'mental-7', gap: 12 }, { t: '02:10', id: 'mental-6', gap: 12 }, { t: '03:00', id: 'physical-10' },
    { t: '07:00', mode: 'day', label: 'Next morning', ic: 'sun', id: 'financial-11' },
  ];
  const clock12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const isNightT = (t) => { const h = +t.split(':')[0]; return h >= 22 || h < 6; };
  function sceneAt(t) { const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }   // small hours keep today's date so counts don't roll over

  // ---- markup ---------------------------------------------------------------------------------------------
  const ran = new Map();
  let playing = null, dayAt = -1, dayDone = false;
  function catalogHtml() {
    return CATS.map((c) => `<section class="sim-cat cat-${c.key}" aria-labelledby="cat-${c.key}">
      <header><span class="cat-ic">${I(c.ic, 22)}</span><div><h3 id="cat-${c.key}">${CATS.indexOf(c) + 1}. ${esc(c.name)}</h3><p>${c.items.length} events</p></div>
        <button class="btn quiet" data-sim-cat="${c.key}">${I('play', 16)}<span>Run all</span></button></header>
      <ul class="sim-list">${[...c.items].sort((a, b) => (a.pin || 99) - (b.pin || 99)).map((it) => `<li><button class="sim-ev" data-sim="${it.id}">
        <span class="ev-ic">${I(it.ic, 20)}</span>
        <span class="ev-tx" title="${esc(it.expect)}"><b>${esc(it.name)}</b></span>
        <span class="ev-meta"><span class="chip">${I(SENSOR[it.sensor][0], 14)}${SENSOR[it.sensor][1]}</span><i class="ev-done" data-done="${it.id}"></i></span>
      </button></li>`).join('')}</ul>
    </section>`).join('');
  }
  function dayHtml() {
    return `<div class="day-head"><div><h2>A full day</h2><p class="day-clock" id="dayClock">7:30 am → next morning</p></div>
      <button class="btn primary" data-sim-day id="dayPlay">${I('play', 16)}<span>Play the day</span></button></div>
      <ol class="day-strip" id="dayStrip">${DAYPLAN.map((st, i) => { const it = st.id && byId(st.id);
        return `<li><button class="day-step ${isNightT(st.t) || st.mode === 'night' ? 'night' : 'day'} ${st.mode ? 'mark' : ''} ${it && !st.mode ? 'cat-' + it.cat : ''}" data-day-step="${i}" title="${esc(it && !st.mode ? it.name : st.label)}">
          <small>${clock12(st.t)}</small><span>${I(st.ic || it.ic, 18)}</span><em>${esc(st.label || it.name)}</em></button></li>`; }).join('')}</ol>`;
  }

  // ---- live panels ------------------------------------------------------------------------------------------
  const lvl = { none: 0, low: 1, medium: 2, high: 3 };
  const meter = (v, max) => `<span class="meter" role="img" aria-label="${v} of ${max}"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></i></span>`;
  function healthHtml(S) {
    const lab = S.labels, ins = S.insights[0] || {}, d = ins.dementia || {}, r = ins.risk || {};
    const meds = Object.values(S.s.meds);
    const scamN = S.s.alerts.filter((a) => /scam/i.test(a.title)).length;
    const remembered = S.recall.filter((x) => x.result === 'remembered').length;
    const row = (k, v, m) => `<div class="hr"><span>${k}</span>${m || ''}<b>${v}</b></div>`;
    return `<div class="hcol cat-mental"><h4>${I('brain', 16)}Mental</h4>
        ${row('Memory', (d.memory && d.memory.concern) || 0, meter((d.memory && d.memory.concern) || 0, 100))}
        ${row('Language', (d.language && d.language.concern) || 0, meter((d.language && d.language.concern) || 0, 100))}
        ${row('Orientation', (d.cognitive && d.cognitive.concern) || 0, meter((d.cognitive && d.cognitive.concern) || 0, 100))}
        ${row('Memory moments', `${remembered}/${S.recall.length}`)}${row('Night wandering', lab.wander.episodes)}${row('Restless sleep', lab.sleep.restless)}</div>
      <div class="hcol cat-financial"><h4>${I('coin', 16)}Financial</h4>
        ${row('Scam risk', esc((r.scam && r.scam.level) || 'none'), meter(lvl[(r.scam && r.scam.level) || 'none'], 3))}
        ${row('Exploitation', esc((r.abuse && r.abuse.level) || 'none'), meter(lvl[(r.abuse && r.abuse.level) || 'none'], 3))}
        ${row('Scam alerts', scamN)}${moneyRows(row)}${row('Things to track', S.tracks.length)}</div>
      <div class="hcol cat-physical"><h4>${I('body', 16)}Physical</h4>
        ${row('Falls', lab.fall.count)}${row('Shaking', `${lab.tremor.score}/4`, meter(lab.tremor.score, 4))}
        ${row('Steps', (S.s.steps || 0).toLocaleString())}${row('Balance', lab.balance.score == null ? '–' : lab.balance.score)}
        ${row('Pills', `${meds.filter((m) => m === 'taken').length} taken, ${meds.filter((m) => m === 'missed').length} missed`)}</div>`;
  }
  function moneyRows(row) {
    const m = window.VexoMoney, R = window.CardRules; if (!m || !R) return '';
    const c = m.card, declined = c.log.filter((p) => !p.approved).length;
    return row('Safe card', c.status === 'frozen' ? 'frozen' : 'active') + row('Spent this week', R.money(R.weekSpent(c))) + row('Declined', declined);
  }
  function capturedHtml(S) {
    return S.s.timeline.slice(0, 8).map((t) => `<li><time>${V.engine.fmtTime(t.at)}</time><span>${esc(t.text)}</span></li>`).join('') || '<li class="empty">Nothing captured yet. Run an event.</li>';
  }
  function herScreenHtml(S) {
    const pv = V.promptView ? V.promptView(S) : null;
    const pipLast = [...S.chat].reverse().find((m) => m.from === 'pip');
    return [S.banner && `<p class="hs-hot"><b>${esc(S.banner.title)}</b> ${esc(S.banner.body || '')}</p>`,
      pv && `<p class="hs-hot"><b>${esc(pv.title)}</b> ${esc(pv.quote || pv.body || '')}</p>`,
      window.VexoMoney && window.VexoMoney.card.status === 'frozen' && `<p class="hs-hot"><b>Your card is taking a short rest.</b> You did nothing wrong. Lisa will call you in a moment.</p>`,
      pipLast && `<p><b>Pip:</b> ${esc(pipLast.text)}</p>`,
      `<p class="hs-led"><span class="led" style="--led:${(S.led && S.led.color) || 'transparent'}"></span>Band light: ${esc((S.led && S.led.say) || 'off')}</p>`].filter(Boolean).join('');
  }
  let seenAlerts = new Set();
  function phoneHtml(S) {
    const st = S.status || { level: 'good', label: 'All good' };
    const items = S.s.alerts.slice(0, 6).map((a) => {
      const fresh = !seenAlerts.has(a.id); seenAlerts.add(a.id);
      return `<li class="nt lv-${a.level}${a.ack ? ' acked' : ''}${fresh ? ' fresh' : ''}"><div class="nt-top"><span class="nt-app">${I('sprout', 13)}</span><span>Band 39 Care</span><time>${V.engine.fmtTime(a.at)}</time></div><b>${esc(a.title)}</b><p>${esc(a.body || '')}</p></li>`;
    }).join('');
    return `<div class="ph-status"><span>${V.engine.fmtTime(V.sceneNow())}</span><span class="ph-isl"></span><span>${I('battery', 14)}</span></div>
      <div class="ph-head"><div><small>Lisa’s phone</small><b>Mom</b></div><span class="ph-st st-${st.level}">${esc(st.label)}</span></div>
      <ul class="ph-list">${items || '<li class="ph-empty">No alerts</li>'}</ul>`;
  }

  // ---- render ---------------------------------------------------------------------------------------------
  let lastLed = '', lastNight = null;
  function render() {
    if (document.getElementById('app').dataset.portal !== 'sim') return;
    const S = V.view();
    const night = S.mode === 'night';
    if (night !== lastNight) { lastNight = night; stageCall('setNight', night); }
    const led = S.led ? `${S.led.color}|${S.led.pattern || 'solid'}` : 'off';
    if (led !== lastLed) { lastLed = led; stageCall('setLed', S.led ? S.led.color : null, S.led ? (S.led.pattern || 'solid') : null); }
    $('simHealth').innerHTML = healthHtml(S);
    $('simCaptured').innerHTML = capturedHtml(S);
    $('simHer').innerHTML = herScreenHtml(S);
    $('simPhone').innerHTML = phoneHtml(S);
    renderBand(S);
    $$('[data-sim-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.simMode === S.mode)));
    const l = S.listen || {}; const micTxt = !l.want ? 'mic off' : l.paused ? 'mic paused for the band light' : l.src ? `mic on (${l.src === 'band' ? 'band' : 'this device'})` : 'mic ready';
    $('simState').textContent = `${S.conn.text || 'Band not connected'} · ${micTxt}${playing ? ' · ' + playing : ''}`;
    for (const [id, at] of ran) { const el = document.querySelector(`[data-done="${id}"]`); if (el && !el.dataset.t) { el.dataset.t = '1'; el.innerHTML = `${I('check', 13)}${V.engine.fmtTime(at)}`; el.classList.add('on'); } }
    const top = S.s.alerts[0], t = $('simToast'); t.hidden = !ran.size;
    if (ran.size) t.innerHTML = `<b>Lisa</b> ${esc(top ? top.title : 'nothing yet')}`;
  }
  function renderBand(S) {
    const b = $('simBracelet'); if (!b) return;
    const led = S.led, s = S.s;
    b.style.setProperty('--led', led ? led.color : 'transparent'); b.dataset.pattern = led ? (led.pattern || 'solid') : 'off';
    $('simBandSay').textContent = led ? `Light: ${plain(led.say)}` : S.conn.kind === 'none' ? 'Not connected' : 'Light off, watching quietly';
    const mic = S.listen && S.listen.want ? (S.listen.src ? 'on' : S.listen.paused ? 'paused' : 'ready') : 'off';
    const stat = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    $('simBandStats').innerHTML = stat('Steps', (s.steps || 0).toLocaleString()) + stat('Battery', s.battery == null ? '–' : s.battery + '%')
      + stat('Mic', mic) + stat('On wrist', s.offWrist ? 'no' : 'yes');
  }
  function paintDay() {
    $$('.day-step').forEach((b) => { const i = +b.dataset.dayStep; b.classList.toggle('now', i === dayAt); b.classList.toggle('past', dayAt >= 0 && i < dayAt); b.setAttribute('aria-current', i === dayAt ? 'step' : 'false'); });
    const st = DAYPLAN[dayAt], c = $('dayClock');
    if (c && st) { const it = st.id && byId(st.id); c.innerHTML = `<b>${clock12(st.t)}</b> ${esc(st.label || (it && it.name) || '')}${dayDone ? ' · Day complete. <button class="link" data-go="caregiver">Open Lisa’s portal</button>' : ''}`; }
    const now = document.querySelector('.day-step.now'); if (now) now.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const pb = $('dayPlay'); if (pb) pb.innerHTML = playing && playing.startsWith('Day') ? `${I('stop', 16)}<span>Stop</span>` : `${I('play', 16)}<span>Play the day</span>`;
  }

  // ---- running ----------------------------------------------------------------------------------------------
  async function run(id, label) {
    const it = byId(id); if (!it) return;
    $$('.sim-ev').forEach((b) => b.classList.toggle('running', b.dataset.sim === id));
    stageCall('caption', label || it.name);
    const sn = $('simSensed'); if (sn) sn.innerHTML = `<span class="chip">${I(SENSOR[it.sensor][0], 14)}${SENSOR[it.sensor][1]}</span> ${esc(it.name)}`;
    try { await it.run(); } catch (e) { console.error(e); }
    ran.set(id, Date.now()); render();
  }
  async function runList(ids, label, gapMs) {
    if (playing) { playing = null; render(); return; }
    for (let i = 0; i < ids.length; i++) {
      playing = `${label} ${i + 1}/${ids.length}`; render();
      await run(ids[i]); await wait(gapMs);
      if (!playing) break;
    }
    playing = null; render();
  }
  async function playDay(from = 0) {
    if (playing) { playing = null; V.setScene(null); render(); paintDay(); return; }
    dayDone = false;
    if (from === 0) { day(); V.setScene(sceneAt('07:25')); act('reset'); }
    await band(); engine.state.lastMoveAt = V.sceneNow();
    for (const t of ['08:00', '20:00']) if (engine.state.meds[t] !== 'missed') engine.state.meds[t] = 'n/a';   // the day's pill steps are scripted
    for (let i = from; i < DAYPLAN.length; i++) {
      const st = DAYPLAN[i]; dayAt = i; playing = `Day ${clock12(st.t)} (${i + 1}/${DAYPLAN.length})`;
      V.setScene(sceneAt(st.t));
      if (st.id !== 'mental-8') engine.state.lastMoveAt = V.sceneNow();          // only the "withdrawn" step should look quiet
      if (st.id !== 'physical-12') engine.state.stillSince = null;
      render(); paintDay();
      const it = st.id && byId(st.id);
      if (st.mode === 'night') { night(); act('sleep'); stageCall('caption', `${clock12(st.t)} · Bedtime: Night mode on`); }
      else if (st.mode === 'day') { V.demoSignal('stop'); day(); act('reset'); stageCall('caption', `${clock12(st.t)} · Next morning`); }
      if (it && !st.noRun) await run(st.id, `${clock12(st.t)} · ${it.name}`);
      if (st.noRun) ran.set(st.id, Date.now());
      if (st.after) setTimeout(st.after, 4000);
      await wait((st.gap || 6) * 1000);
      if (!playing) break;
    }
    if (playing) dayDone = true;
    playing = null; V.setScene(null); render(); paintDay();
  }

  // ---- wire up ------------------------------------------------------------------------------------------------
  $('simCatalog').innerHTML = catalogHtml();
  $('simDay').innerHTML = dayHtml();
  $('simCount').textContent = ALL.length;
  document.getElementById('app').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sim], [data-sim-cat], [data-sim-day], [data-sim-reset], [data-day-step], [data-sim-mode]'); if (!b) return;
    if (b.dataset.simMode) return V.setMode(b.dataset.simMode);
    if (b.dataset.dayStep !== undefined) {
      const st = DAYPLAN[+b.dataset.dayStep]; dayAt = +b.dataset.dayStep;
      if (st.mode === 'night') { night(); act('sleep'); } else if (st.mode === 'day') { day(); act('reset'); }
      if (st.id) { if (st.noRun) V.go('caregiver', 'c-care'); else run(st.id, `${clock12(st.t)} · ${byId(st.id).name}`); }
      paintDay(); return;
    }
    if (b.dataset.sim) return run(b.dataset.sim);
    if (b.dataset.simCat) { const c = CATS.find((x) => x.key === b.dataset.simCat); return runList(c.items.filter((x) => x.sensor !== 'app').map((x) => x.id), c.name, 7000); }
    if (b.dataset.simDay !== undefined) return playDay(0);
    if (b.dataset.simReset !== undefined) { if (confirm('Clear the simulated day (timeline, alerts, chat)?')) { location.hash = '#/sim'; location.reload(); } }
  });
  engine.subscribe(() => requestAnimationFrame(render));
  setInterval(render, 1000);
  const onRoute = () => { if (document.getElementById('app').dataset.portal === 'sim') { loadStage(); render(); } };
  addEventListener('hashchange', () => setTimeout(onRoute, 0)); setTimeout(onRoute, 0);
  window.VexoSim = { CATS, ALL, run, runList, playDay, DAYPLAN, get stage() { return stage; } };
})();
