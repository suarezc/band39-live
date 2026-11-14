/* Band 39 · home page quick demo: a whole day, 26 events in 30 seconds. Margaret acts each one out on the voxel
 * stage (js/sim-stage.js), the band light changes, and what Lisa would get lands in the feed and in her real portal
 * (engine.raise / engine.note; scam alerts also freeze Mom's safe card). To fit 30 s the outcome is shown at once;
 * the full simulator (#/sim) sends each event through the real sensors, Deepgram and OpenAI instead.
 */
(function () {
  'use strict';
  const V = window.VexoCare; if (!V) return;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STEP = 1030;                                   // 29 × 1.03 s ≈ 30 s
  const AMBER = ['#F2A93B', 'blink'], RED = ['#E5484D', 'pulse'], GREEN = ['#3FAE7A', 'solid'], BLUE = ['#3E8EF7', 'solid'], NIGHT = ['#8E6CF0', 'breathe'];
  const DOES = {"walk": "Walks", "pills": "Takes pills", "confused": "Confused", "phone": "On the phone", "tremor": "Hand shakes", "talk": "Talks", "shaky": "Unsteady", "fall": "Falls", "sad": "Sad", "bandoff": "Band off", "idle": "At home", "sit": "Sits still", "sleep": "Restless sleep", "nightwalk": "Walks at night", "seizure": "Shaking", "sos": "Presses SOS", "tap": "Tells the band"};
  const CAT = { mental: 'Mental', financial: 'Financial', physical: 'Physical' };
  // [time, category, event, stage act, act opts, what she says, band light, what Lisa gets: [level, title, body, key] or a note]
  const DAY = [
    ['7:20 am', 'physical', 'Medication list', 'walk', { to: 'table' }, '', null, ['info', 'Medication list', '8 am: Donepezil 5 mg, Lisinopril 10 mg · 8 pm: Metformin 500 mg, Sertraline 25 mg (sample).']],
    ['7:30 am', 'physical', 'Pill reminder', 'walk', { to: 'table' }, '', AMBER, ['info', 'Morning pills due', 'The band is glowing and her screen asks “Pills taken?”.']],
    ['7:35 am', 'physical', 'Medicine taken', 'tap', {}, 'I took my morning pills.', GREEN, ['info', 'Medicine taken', 'Mom told the band she took her 8 am medicines.']],
    ['8:10 am', 'physical', 'Steady walk', 'walk', { to: 'window' }, '', null, '1,240 steps, steady cadence. Balance 82/100.'],
    ['9:00 am', 'mental', 'Repeats herself', 'confused', {}, 'Did Lisa call today?', null, ['info', 'Repeated question', 'Mom asked “Did Lisa call today?” twice in five minutes.']],
    ['9:40 am', 'financial', 'Scam attempt', 'phone', {}, 'Gift cards for his bail? Okay…', RED, ['urgent', 'Possible scam call', 'A caller says her grandson is in jail and wants gift cards. Her card is frozen. Call Mom now.', 'scam']],
    ['9:55 am', 'financial', 'Gift cards for $450', 'walk', { to: 'door' }, '', null, 'card'],
    ['10:15 am', 'physical', 'Tremor', 'tremor', {}, '', null, ['info', 'Shaking score 2/4', 'Left hand, 5.1 Hz, about 4 minutes this morning.']],
    ['10:30 am', 'financial', 'Fraudulent transaction', 'sit', {}, '', null, ['warn', 'Fraudulent transaction blocked', '$389 online charge from QuickShop Intl, a shop Mom never uses. Declined.', 'fraud']],
    ['10:50 am', 'mental', 'Speech deterioration', 'talk', {}, 'The, um, the thingy… the place with the books.', null, ['info', 'Speech deterioration', 'More fillers and “thingy” than usual today.']],
    ['11:30 am', 'financial', 'Fake bank asks for her PIN', 'phone', {}, 'My PIN is my birthday…', RED, ['urgent', 'Possible scam: bank PIN', 'Someone claiming to be her bank asked for a code and her PIN.', 'scam']],
    ['12:15 pm', 'physical', 'Unsteady walk', 'shaky', {}, '', null, ['warn', 'Balance dropped to 58', 'Irregular steps and more sway on her walk after lunch.']],
    ['1:00 pm', 'physical', 'Fall', 'fall', {}, '', RED, ['urgent', 'Possible fall', 'Impact 3.1 g, then still. “Did you fall?” is on her screen. Call Mom, Ruth or 911.']],
    ['1:20 pm', 'financial', 'Prize win, pay a fee first', 'phone', {}, 'Wire $500 for the taxes first?', null, ['warn', 'Prize scam', 'A “prize” that needs a $500 wire first.', 'scam']],
    ['2:00 pm', 'financial', 'Doorstep repair pressure', 'walk', { to: 'door' }, 'Eight thousand, cash today?', null, ['warn', 'Doorstep pressure', 'A roofer wants $8,000 cash today.', 'scam']],
    ['2:45 pm', 'mental', 'Confused about the day', 'confused', {}, 'Is it Monday? The children are waiting.', null, ['info', 'Orientation', 'She thought it was Monday and she had to teach. Pip told her the day.']],
    ['3:30 pm', 'financial', 'Nephew takes her card', 'sad', {}, 'He took my bank card again.', null, ['warn', 'Possible exploitation', 'Mom says her nephew took her bank card and yells at her.']],
    ['3:50 pm', 'mental', 'Abuse detection', 'sad', {}, 'He grabbed my arm. I’m scared.', null, ['urgent', 'Possible abuse', 'Mom said someone grabbed her arm hard and she is scared to tell anyone.', 'abuse']],
    ['4:15 pm', 'financial', 'Missed bill payment', 'confused', {}, 'A red letter from the electric company…', null, ['info', 'Missed bill payment', 'The electric and phone bills may be unpaid. Pip set a reminder.']],
    ['5:00 pm', 'mental', 'Social isolation', 'sad', {}, 'Nobody needs me anymore.', null, ['warn', 'Social isolation', 'No visits or calls in 6 days; Mom said nobody needs her.']],
    ['5:40 pm', 'mental', 'Memory decline', 'confused', {}, 'Who is visiting Sunday? I don’t know.', null, ['warn', 'Memory decline', '2 of 5 memory moments remembered this week, down from 4 of 5.', 'memory-decline']],
    ['6:30 pm', 'physical', 'Chest pain', 'sad', {}, 'My chest feels tight.', RED, ['urgent', 'Chest pain', 'Mom said her chest is tight and her left arm aches. Pip offered to call 911.']],
    ['7:15 pm', 'physical', 'Band off her wrist', 'bandoff', {}, '', null, ['warn', 'Band may be off', 'Perfectly still for 2 hours. It may be on the table.']],
    ['8:00 pm', 'physical', 'Low band battery', 'idle', {}, '', AMBER, ['info', 'Band battery 12%', 'Reminded Mom to charge it tonight.']],
    ['9:00 pm', 'mental', 'Withdrawn: no movement 3 h', 'sit', {}, '', null, ['warn', 'Quiet spell, no answer', 'No movement for 3 hours and no answer to the check-in.']],
    ['11:30 pm', 'mental', 'Restless sleep', 'sleep', { restless: true }, '', NIGHT, '38% restless epochs since 10:30 pm.', 'night'],
    ['2:10 am', 'mental', 'Night wandering', 'nightwalk', {}, '', NIGHT, ['warn', 'Mom is up and walking', 'Walking for 20 minutes at 2 am, near the front door.']],
    ['3:00 am', 'physical', 'Seizure-like movement', 'seizure', {}, '', RED, ['urgent', 'Seizure-like movement', 'Rhythmic 4 Hz shaking for 12 s. Call Mom now; if no answer, call 911.']],
    ['3:05 am', 'physical', 'SOS: asks for help', 'sos', {}, 'Help, please.', RED, ['urgent', 'Mom pressed HELP', 'Call Mom, then Ruth next door, then 911.']],
  ];

  // what band 39 senses or does for each event, in order
  const DEVICE = ["Medicine schedule", "Pill time", "Hears “took my pills”", "Steps counted", "Same question twice", "Hears “gift cards”", "Card frozen", "Shaking 5 Hz", "Card: unknown shop, $389", "“Thingy”, fillers", "Hears “PIN”", "Sway, uneven steps", "Impact 3.1 g", "Hears “wire $500”", "Hears “cash today”", "Wrong day", "Hears “took my card”", "Hears “grabbed my arm”", "Unpaid bills", "No calls in 6 days", "Recall 2 of 5", "Hears “chest tight”", "Still 2 h: off wrist", "Battery 12%", "No movement 3 h", "38% restless", "Up at 2 am", "Shaking 12 s", "HELP pressed"];
  // per event: which band sensor caught it, and what the band then does
  const SENSE = [["app", "Shows today’s list"], ["clock", "Blinks amber: “Pills taken?”"], ["mic", "Clears the reminder"], ["motion", "Counts steps"], ["mic", "Sends words to the AI"], ["mic", "Flags scam, freezes card"], ["card", "Declines: card frozen"], ["motion", "Scores shaking"], ["card", "Declines, flags fraud"], ["mic", "Scores language"], ["mic", "Flags scam"], ["motion", "Scores balance"], ["motion", "Glows red: “Did you fall?”"], ["mic", "Flags scam"], ["mic", "Flags pressure"], ["mic", "Pip tells her the day"], ["mic", "Flags exploitation"], ["mic", "Flags abuse, tells Lisa quietly"], ["mic", "Sets a bill reminder"], ["mic", "Pip comforts her"], ["mic", "Logs the recall trend"], ["mic", "Urgent: offers 911"], ["motion", "Notices it is off"], ["battery", "Blinks amber"], ["motion", "Check-in on her screen"], ["motion", "Scores sleep"], ["motion", "Soft purple: guides her back"], ["motion", "Urgent: calls Lisa"], ["tap", "Urgent: Lisa, Ruth, 911"]];
  const SENSOR = { motion: ['wave', 'Motion · 50 Hz'], mic: ['mic', 'Mic → AI'], tap: ['tap', 'Band tap'], card: ['card', 'Safe card'], app: ['clock', 'Schedule'], clock: ['clock', 'Reminder'], battery: ['battery', 'Battery'] };
  // how the information travels for each sensor: band → processing → Lisa
  const FLOW = {
    motion: [['watch', 'Accel + gyro 50 Hz'], ['wave', 'Bluetooth'], ['sparkle', 'Motion lab'], ['bell', 'Care engine'], ['phone', 'Lisa']],
    mic: [['mic', 'Band mic'], ['chat', 'Deepgram: speech → text'], ['sparkle', 'OpenAI: risk read'], ['bell', 'Care engine'], ['phone', 'Lisa']],
    tap: [['tap', 'Band tap'], ['wave', 'Bluetooth'], ['bell', 'Care engine'], ['phone', 'Lisa']],
    card: [['card', 'Card charge'], ['shield', 'Card rules'], ['bell', 'Care engine'], ['phone', 'Lisa']],
    app: [['clock', 'Medicine schedule'], ['watch', 'Band light + her screen'], ['bell', 'Care engine'], ['phone', 'Lisa']],
    clock: [['clock', 'Schedule'], ['watch', 'Band light + her screen'], ['bell', 'Care engine'], ['phone', 'Lisa']],
    battery: [['battery', 'Band battery'], ['wave', 'Bluetooth'], ['bell', 'Care engine'], ['phone', 'Lisa']],
  };
  const TAB = { mental: 'Mental tab', financial: 'Financial tab', physical: 'Physical tab' };
  const ico = (n, z = 16) => (window.VexoIcons ? window.VexoIcons.svg(n, z) : '');
  let stage = null, playing = false, played = 0, counts = { mental: 0, financial: 0, physical: 0 };
  const call = (fn, ...a) => { try { return stage && stage[fn] && stage[fn](...a); } catch (e) { console.warn(e); } };
  function loadStage() {
    const host = $('qStage'); if (!host || stage) return;
    import(new URL('js/sim-stage.js', document.baseURI).href)
      .then((m) => { stage = m.createStage(host, {}); host.classList.add('ready'); stage.act('idle'); })
      .catch((e) => { host.querySelector('.stage-fallback').textContent = 'The 3D room could not load. The feed still plays.'; console.warn(e); });
  }
  function paintCounts(n) {
    $('qCounts').innerHTML = Object.keys(CAT).map((k) => `<span class="qc qc-${k}"><b>${counts[k]}</b> ${CAT[k]}</span>`).join('') + (playing ? `<span class="qc"><b>${n}</b>/${DAY.length}</span>` : `<span class="qc"><b>${n}</b> played</span>`);
  }
  function lisaGets(ev) {
    const out = ev[7];
    if (out === 'card') {                         // the real safe-card rules decide (a scam alert froze it a moment ago)
      const m = window.VexoMoney; let r = null; if (m) { m.buy(45000, 'Best Electronics (gift cards)', 'electronics'); r = m.card.log[m.card.log.length - 1]; }
      return { level: 'warn', title: r && !r.approved ? 'Card declined $450' : 'Card used', body: r ? `Gift cards at Best Electronics: ${r.approved ? 'approved' : r.reason}.` : 'Gift cards, $450.' };
    }
    if (typeof out === 'string') { V.engine.note('·', out, 'info'); return { level: 'note', title: ev[2], body: out }; }
    const [level, title, body, key] = out; V.engine.raise(level, title, body, key || 'demo-' + title); return { level, title, body };
  }
  function show(i) {
    const ev = DAY[i], [t, cat, name, actName, opts, say, led] = ev;
    call('setNight', ev[8] === 'night' || /am$/.test(ev[0]) && parseInt(ev[0], 10) < 6 || ev[3] === 'nightwalk');
    call('setLed', led ? led[0] : null, led ? led[1] : null);
    call('act', actName, opts); if (say) call('say', say, STEP * 1.6);
    call('caption', `${t} · ${name}`);
    counts[cat]++;
    const got = lisaGets(ev);
    const [sk, does] = SENSE[i] || ['mic', '']; const sn = SENSOR[sk] || SENSOR.mic;
    $('qNow').innerHTML = `<div class="q-ev"><span class="q-tag tag-${cat}">${CAT[cat]}</span><b>${esc(name)}</b><small>${esc(t)}</small></div>
      <div class="q-lanes big">
        <div class="ql"><h2>${ico('user')}Margaret</h2><b class="ql-main">${esc(DOES[actName] || name)}</b>${say ? `<q>${esc(say)}</q>` : ''}</div>
        <div class="ql"><h2>${ico('watch')}Bracelet</h2><span class="ql-chip">${ico(sn[0], 14)}${sn[1]}</span><b class="ql-main">${led ? `<i class="q-led" style="--led:${led[0]}"></i>` : ''}${esc(DEVICE[i] || '')}</b><small>${esc(does)}</small></div>
        <div class="ql lisa lv-${got.level}"><h2>${ico('phone')}Lisa’s portal</h2><div class="ql-note"><span class="ql-app">${ico('sprout', 12)}</span><b>${esc(got.title)}</b><p>${esc(got.body)}</p></div><span class="ql-tab">${got.level === 'urgent' ? 'Full-screen alert' : TAB[cat]}</span></div>
      </div>
      <ol class="q-flow" aria-label="Information flow">${(FLOW[sk] || FLOW.mic).map(([ic, label], k) => `<li style="--k:${k}">${ico(ic, 14)}<span>${esc(label)}</span></li>`).join('')}</ol>`;
    played++; $('qProg').style.width = playing ? ((i + 1) / DAY.length * 100) + '%' : '0%';
    const feed = $('qFeed'); const empty = feed.querySelector('.q-empty'); if (empty) empty.remove();
    feed.insertAdjacentHTML('afterbegin', `<li class="qf lv-${got.level} tag-${cat}"><time>${esc(t)}</time><b>${esc(got.title)}</b></li>`);
    paintCounts(playing ? i + 1 : played);
  }
  async function play() {
    if (playing) { playing = false; return; }
    playing = true; played = 0; counts = { mental: 0, financial: 0, physical: 0 };
    if (V.kind === 'none') { try { await V.connect('sim'); } catch (_) { /* demo still plays */ } }   // be the hub, so other screens (product.html) follow
    $('qFeed').innerHTML = ''; $('qPlay').textContent = 'Stop';
    call('setNight', false); call('act', 'reset');
    const t0 = performance.now();
    for (let i = 0; i < DAY.length && playing; i++) {
      show(i);
      const wait = t0 + (i + 1) * STEP - performance.now(); await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    const done = playing; playing = false;
    $('qPlay').textContent = done ? 'Play again' : 'Play a day in 30 s';
    if (done) {
      call('setLed', null); call('setNight', false); call('act', 'reset'); call('caption', `${DAY.length} events in ${Math.round((performance.now() - t0) / 1000)} s`);
      $('qNow').innerHTML = `<span class="q-tag">Done</span><b>${DAY.length} events · ${Math.round((performance.now() - t0) / 1000)} s</b><button class="q-open" data-go="caregiver">Open Lisa’s app</button>`;
    }
  }
  // one button per key event, grouped 1 Physical · 2 Financial · 3 Mental; a click plays just that event
  const PICK = [['physical', ['Fall', 'Tremor', 'Medication list', 'Medicine taken']], ['financial', ['Scam attempt', 'Fraudulent transaction', 'Missed bill payment']],
    ['mental', ['Memory decline', 'Speech deterioration', 'Social isolation', 'Abuse detection']]];
  const box = $('qEvents');
  if (box) {
    box.innerHTML = PICK.map(([cat, names], n) => `<div class="qe qe-${cat}"><h3><span>${n + 1}</span>${CAT[cat]}</h3><div>${names.map((nm) => {
      const i = DAY.findIndex((e) => e[2] === nm); return i < 0 ? '' : `<button data-qev="${i}">${esc(nm)}</button>`; }).join('')}</div></div>`).join('');
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-qev]'); if (!b || playing) return;
      if (V.kind === 'none') { try { await V.connect('sim'); } catch (_) { /* still plays */ } }
      box.querySelectorAll('[data-qev]').forEach((x) => x.classList.toggle('on', x === b));
      show(+b.dataset.qev);
    });
  }
  $('qPlay').addEventListener('click', play);
  paintCounts(0);
  const onRoute = () => { if (document.getElementById('app').dataset.portal === 'home') loadStage(); };
  if (new URL(location.href).searchParams.get('autoplay')) setTimeout(play, 1500);   // product.html?autoplay=1, demos
  addEventListener('hashchange', () => setTimeout(onRoute, 0)); setTimeout(onRoute, 0);
  window.VexoQuick = { play, show, DAY, get stage() { return stage; } };
})();
