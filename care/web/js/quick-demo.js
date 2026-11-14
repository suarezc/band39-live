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
  const STEP = 1150;                                   // 26 × 1.15 s ≈ 30 s
  const AMBER = ['#F2A93B', 'blink'], RED = ['#E5484D', 'pulse'], GREEN = ['#3FAE7A', 'solid'], BLUE = ['#3E8EF7', 'solid'], NIGHT = ['#8E6CF0', 'breathe'];
  const DOES = {"walk": "Walks", "pills": "Takes pills", "confused": "Confused", "phone": "On the phone", "tremor": "Hand shakes", "talk": "Talks", "shaky": "Unsteady", "fall": "Falls", "sad": "Sad", "bandoff": "Band off", "idle": "At home", "sit": "Sits still", "sleep": "Restless sleep", "nightwalk": "Walks at night", "seizure": "Shaking", "sos": "Presses SOS"};
  const CAT = { mental: 'Mental', financial: 'Financial', physical: 'Physical' };
  // [time, category, event, stage act, act opts, what she says, band light, what Lisa gets: [level, title, body, key] or a note]
  const DAY = [
    ['7:30 am', 'physical', 'Pill reminder', 'walk', { to: 'table' }, '', AMBER, ['info', 'Morning pills due', 'The band is glowing and her screen asks “Pills taken?”.']],
    ['7:35 am', 'physical', 'Pills taken (tap)', 'pills', {}, '', GREEN, 'Mom tapped the band: morning pills taken.'],
    ['8:10 am', 'physical', 'Steady walk', 'walk', { to: 'window' }, '', null, '1,240 steps, steady cadence. Balance 82/100.'],
    ['9:00 am', 'mental', 'Repeats herself', 'confused', {}, 'Did Lisa call today?', null, ['info', 'Repeated question', 'Mom asked “Did Lisa call today?” twice in five minutes.']],
    ['9:40 am', 'financial', 'Grandchild-in-jail scam call', 'phone', {}, 'Gift cards for his bail? Okay…', RED, ['urgent', 'Possible scam call', 'A caller says her grandson is in jail and wants gift cards. Her card is frozen. Call Mom now.', 'scam']],
    ['9:55 am', 'financial', 'Gift cards for $450', 'walk', { to: 'door' }, '', null, 'card'],
    ['10:15 am', 'physical', 'Hand tremor', 'tremor', {}, '', null, ['info', 'Shaking score 2/4', 'Left hand, 5.1 Hz, about 4 minutes this morning.']],
    ['10:50 am', 'mental', 'Word-finding trouble', 'talk', {}, 'The, um, the thingy… the place with the books.', null, ['info', 'Word-finding', 'More fillers and “thingy” than usual today.']],
    ['11:30 am', 'financial', 'Fake bank asks for her PIN', 'phone', {}, 'My PIN is my birthday…', RED, ['urgent', 'Possible scam: bank PIN', 'Someone claiming to be her bank asked for a code and her PIN.', 'scam']],
    ['12:15 pm', 'physical', 'Unsteady walk', 'shaky', {}, '', null, ['warn', 'Balance dropped to 58', 'Irregular steps and more sway on her walk after lunch.']],
    ['1:00 pm', 'physical', 'Fall', 'fall', {}, '', RED, ['urgent', 'Possible fall', 'Impact 3.1 g, then still. “Did you fall?” is on her screen. Call Mom, Ruth or 911.']],
    ['1:20 pm', 'financial', 'Prize win, pay a fee first', 'phone', {}, 'Wire $500 for the taxes first?', null, ['warn', 'Prize scam', 'A “prize” that needs a $500 wire first.', 'scam']],
    ['2:00 pm', 'financial', 'Doorstep repair pressure', 'walk', { to: 'door' }, 'Eight thousand, cash today?', null, ['warn', 'Doorstep pressure', 'A roofer wants $8,000 cash today.', 'scam']],
    ['2:45 pm', 'mental', 'Confused about the day', 'confused', {}, 'Is it Monday? The children are waiting.', null, ['info', 'Orientation', 'She thought it was Monday and she had to teach. Pip told her the day.']],
    ['3:30 pm', 'financial', 'Nephew takes her card', 'sad', {}, 'He took my bank card again.', null, ['warn', 'Possible exploitation', 'Mom says her nephew took her bank card and yells at her.']],
    ['4:15 pm', 'financial', 'Missed bills', 'confused', {}, 'A red letter from the electric company…', null, ['info', 'Missed bills', 'The electric and phone bills may be unpaid. Pip set a reminder.']],
    ['5:00 pm', 'mental', 'Lonely, low mood', 'sad', {}, 'Nobody needs me anymore.', null, ['warn', 'Low mood', 'Mom said nobody needs her. A call tonight would help.']],
    ['5:40 pm', 'mental', 'Memory moment: forgot', 'confused', {}, 'Who is visiting Sunday? I don’t know.', null, ['info', 'Memory moment: forgot', 'She didn’t recall your Sunday visit. 3 of 5 remembered this week.']],
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
  const DEVICE = ["Pill time", "Tap: pills taken", "Steps counted", "Same question twice", "Hears “gift cards”", "Card frozen", "Shaking 5 Hz", "“Thingy”, fillers", "Hears “PIN”", "Sway, uneven steps", "Impact 3.1 g", "Hears “wire $500”", "Hears “cash today”", "Wrong day", "Hears “took my card”", "Unpaid bills", "Low mood", "No answer", "Hears “chest tight”", "Still 2 h: off wrist", "Battery 12%", "No movement 3 h", "38% restless", "Up at 2 am", "Shaking 12 s", "HELP pressed"];
  let stage = null, playing = false, counts = { mental: 0, financial: 0, physical: 0 };
  const call = (fn, ...a) => { try { return stage && stage[fn] && stage[fn](...a); } catch (e) { console.warn(e); } };
  function loadStage() {
    const host = $('qStage'); if (!host || stage) return;
    import(new URL('js/sim-stage.js', document.baseURI).href)
      .then((m) => { stage = m.createStage(host, {}); host.classList.add('ready'); stage.act('idle'); })
      .catch((e) => { host.querySelector('.stage-fallback').textContent = 'The 3D room could not load. The feed still plays.'; console.warn(e); });
  }
  function paintCounts(n) {
    $('qCounts').innerHTML = Object.keys(CAT).map((k) => `<span class="qc qc-${k}"><b>${counts[k]}</b> ${CAT[k]}</span>`).join('') + `<span class="qc"><b>${n}</b>/${DAY.length}</span>`;
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
    if (ev[8] === 'night' || i === 22) { call('setNight', true); }
    call('setLed', led ? led[0] : null, led ? led[1] : null);
    call('act', actName, opts); if (say) call('say', say, STEP * 1.6);
    call('caption', `${t} · ${name}`);
    counts[cat]++;
    const got = lisaGets(ev);
    $('qNow').innerHTML = `<div class="q-ev"><span class="q-tag tag-${cat}">${CAT[cat]}</span><b>${esc(name)}</b><small>${esc(t)}</small></div>
      <div class="q-lanes"><div class="ql"><h2>Margaret</h2><p>${esc(DOES[actName] || name)}</p></div>
      <div class="ql"><h2>Band 39</h2><p>${led ? `<i class="q-led" style="--led:${led[0]}"></i>` : ''}${esc(DEVICE[i] || '')}</p></div>
      <div class="ql lisa lv-${got.level}"><h2>Lisa</h2><p><b>${esc(got.title)}</b></p></div></div>`;
    $('qProg').style.width = ((i + 1) / DAY.length * 100) + '%';
    const feed = $('qFeed'); const empty = feed.querySelector('.q-empty'); if (empty) empty.remove();
    feed.insertAdjacentHTML('afterbegin', `<li class="qf lv-${got.level} tag-${cat}"><time>${esc(t)}</time><b>${esc(got.title)}</b></li>`);
    paintCounts(i + 1);
  }
  async function play() {
    if (playing) { playing = false; return; }
    playing = true; counts = { mental: 0, financial: 0, physical: 0 };
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
  $('qPlay').addEventListener('click', play);
  paintCounts(0);
  const onRoute = () => { if (document.getElementById('app').dataset.portal === 'home') loadStage(); };
  addEventListener('hashchange', () => setTimeout(onRoute, 0)); setTimeout(onRoute, 0);
  window.VexoQuick = { play, show, DAY, get stage() { return stage; } };
})();
