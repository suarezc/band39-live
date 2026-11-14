/* Band 39 care · two health scores for Lisa: Mental and Physical, one line chart each.
 * Each score (0-100, higher is better) is a weighted blend of a few parts. TODAY's point is worked
 * out from what the app knows right now (motion lab, care engine, voice-note reading); a part with
 * no reading yet today keeps yesterday's value. The EARLIER days are sample history: the app keeps
 * no history yet. Weights are product guesses, not clinical scales. Signals, not diagnoses.
 */
(function (root) {
  'use strict';
  const PILLARS = {
    physical: { name: 'Physical health', color: '#1B8FB8', parts: [['balance', 'Balance', 0.30], ['activity', 'Activity', 0.25], ['sleep', 'Sleep', 0.20], ['safety', 'Falls and safety', 0.25]] },
    mental: { name: 'Mental health', color: '#7A5CF0', parts: [['recall', 'Word recall', 0.30], ['language', 'Language', 0.25], ['orientation', 'Orientation', 0.20], ['routine', 'Routine', 0.15], ['connection', 'Connection', 0.10]] },
  };
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  const blend = (pillar, parts) => clamp(PILLARS[pillar].parts.reduce((s, [k, , w]) => s + w * parts[k], 0));
  const DAY = 24 * 3600 * 1000;

  /** Sample history: `days` days ending yesterday. Same numbers on every load. */
  function sampleHistory(pillar, days, todayMs) {
    let seed = pillar === 'physical' ? 41 : 97;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const out = [];
    for (let i = days; i >= 1; i--) {
      const age = i / days;                                   // 1 = oldest, near 0 = yesterday
      const parts = pillar === 'physical'
        ? { balance: 74 + 14 * age + 5 * rnd(), activity: 66 + 16 * age + 16 * rnd(), sleep: 76 + 6 * age + 14 * rnd(), safety: i === 9 ? 55 : 97 + 4 * rnd() }
        : { recall: 76 + 5 * age + 7 * rnd(), language: 81 + 3 * age + 6 * rnd(), orientation: 83 + 8 * rnd(), routine: i === 5 || i === 12 ? 60 : 96 + 6 * rnd(), connection: 72 + 26 * rnd() };
      for (const k of Object.keys(parts)) parts[k] = clamp(parts[k]);
      out.push({ at: todayMs - i * DAY, parts, score: blend(pillar, parts), live: [] });
    }
    return out;
  }

  /** Today's parts from the app's live state. `now` = what the app knows; `prev` = yesterday's parts. */
  function today(pillar, now, prev) {
    const parts = Object.assign({}, prev); const live = [];
    const set = (k, v) => { if (v != null && !Number.isNaN(v)) { parts[k] = clamp(v); live.push(k); } };
    if (pillar === 'physical') {
      set('balance', now.balance);
      if (now.steps > 0) { const dayPart = Math.max(0.15, Math.min(1, (now.hour - 7) / 13)); set('activity', 100 * now.steps / (now.stepGoal * dayPart)); }
      if (now.sleepEpochs > 0) set('sleep', 100 - now.restless);
      set('safety', 100 - 45 * now.falls - 35 * now.seizures - 6 * now.tremor - 10 * now.wanders);
    } else {
      if (now.dementia) { set('recall', 100 - now.dementia.memory); set('language', 100 - now.dementia.language); set('orientation', 100 - now.dementia.cognitive); }
      if (now.pillsTaken + now.pillsMissed > 0) set('routine', 100 - 40 * now.pillsMissed);
      if (now.messages > 0) set('connection', 60 + 20 * now.messages);
    }
    return { parts, live, score: blend(pillar, parts) };
  }

  const core = { PILLARS, sampleHistory, today, blend };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  root.VexoScores = core;

  // ---- the page -------------------------------------------------------------------------------
  const care = root.VexoCare; const head = document.querySelector('.carer .cg-head');
  if (!care || !head) return;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const svg = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const dayName = (ms, long) => new Date(ms).toLocaleDateString('en-US', long ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'narrow' });
  const midnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const history = { physical: sampleHistory('physical', 29, midnight), mental: sampleHistory('mental', 29, midnight) };
  let range = 7;

  function liveNow() {
    const L = care.lab.labels, s = care.engine.state; const meds = Object.values(s.meds || {});
    const note = care.insightsLog[0];
    return {
      hour: new Date().getHours() + new Date().getMinutes() / 60,
      balance: L.balance.score, steps: L.steps.today, stepGoal: L.steps.goal, sleepEpochs: L.sleep.epochs, restless: L.sleep.restless,
      falls: L.fall.count, seizures: L.seizure.count, tremor: L.tremor.score, wanders: L.wander.episodes,
      dementia: note && note.dementia ? { memory: note.dementia.memory.concern, language: note.dementia.language.concern, cognitive: note.dementia.cognitive.concern } : null,
      pillsTaken: meds.filter((m) => m === 'taken').length, pillsMissed: meds.filter((m) => m === 'missed').length,
      messages: (s.messages || []).length,
    };
  }
  function series(pillar) {
    const past = history[pillar]; const t = today(pillar, liveNow(), past[past.length - 1].parts);
    return past.concat([{ at: midnight, parts: t.parts, score: t.score, live: t.live, today: true }]).slice(-range);
  }

  // the frame: one row of controls, then the two charts; the detailed blocks fold away under each
  const wrap = el('div', 'scores');
  const bar = el('div', 'scores-bar'); const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Time range');
  for (const [label, n] of [['Week', 7], ['Month', 30]]) { const b = el('button', '', label); b.type = 'button'; b.dataset.range = n; b.onclick = () => { range = n; draw(); }; seg.append(b); }
  bar.append(el('p', 'fine', 'Earlier days are sample data. Today is live.'), seg); wrap.append(bar);
  const cards = {};
  for (const key of ['physical', 'mental']) {
    const P = PILLARS[key]; const card = el('div', 'score'); const name = el('div', 'score-name'); const dot = el('i'); dot.style.background = P.color;
    name.append(dot, document.createTextNode(P.name));
    const top = el('div', 'score-top'); const num = el('div', 'score-num'); const trend = el('div', 'score-trend'); top.append(num, trend);
    const plot = el('div', 'score-plot'); const tip = el('div', 'score-tip'); tip.hidden = true; plot.append(tip);
    const behind = el('details'); behind.append(el('summary', '', 'What’s behind this score'));
    const table = el('details'); table.append(el('summary', '', 'Show as a table')); const scroll = el('div', 'score-scroll'); table.append(scroll);
    card.append(name, top, plot, behind, table); wrap.append(card);
    cards[key] = { card, num, trend, plot, tip, behind, scroll, at: null };
  }
  head.after(wrap);
  const fold = (id, key) => { const b = document.getElementById(id); const block = b && b.closest('.block'); if (block) cards[key].behind.append(block); };
  fold('sigGrid', 'physical'); fold('insights', 'mental');

  function tipFor(c, P, d, x, width) {
    c.tip.textContent = '';
    const head2 = el('div'); head2.append(el('span', 'when', d.today ? 'Today' : dayName(d.at, true)), document.createTextNode(' · '), el('b', '', String(d.score)));
    const dl = el('dl'); for (const [k, label] of P.parts) { dl.append(el('dt', '', label), el('dd', '', String(d.parts[k]))); }
    c.tip.append(head2, dl);
    if (d.today) c.tip.append(el('div', 'live', d.live.length ? 'Live today: ' + P.parts.filter(([k]) => d.live.includes(k)).map(([, l]) => l.toLowerCase()).join(', ') + '.' : 'No readings yet today: yesterday’s values.'));
    c.tip.hidden = false;
    const w = c.tip.offsetWidth || 180; const px = x / 600 * width;
    c.tip.style.left = Math.max(0, Math.min(width - w, px + (px > width / 2 ? -w - 12 : 12))) + 'px';
  }

  function drawOne(key) {
    const P = PILLARS[key], c = cards[key], data = series(key); const last = data[data.length - 1];
    const before = data.slice(0, -1); const avg = before.reduce((s, d) => s + d.score, 0) / before.length; const diff = Math.round(last.score - avg);
    c.num.textContent = ''; c.num.append(document.createTextNode(String(last.score)), el('small', '', ' /100'));
    c.trend.textContent = (diff === 0 ? '→ level with' : diff > 0 ? `↑ ${diff} above` : `↓ ${-diff} below`) + ` the ${range === 7 ? 'week' : 'month'}’s average`;
    const W = 600, H = 200, L = 10, R = 38, T = 12, B = 26;
    const lo = Math.max(0, Math.floor((Math.min(...data.map((d) => d.score)) - 4) / 10) * 10), hi = Math.min(100, Math.max(lo + 20, Math.ceil((Math.max(...data.map((d) => d.score)) + 4) / 10) * 10));
    const X = (i) => L + (W - L - R) * (data.length === 1 ? 0.5 : i / (data.length - 1)); const Y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, 'aria-label': `${P.name}: ${last.score} out of 100 today. ${c.trend.textContent}. Use the arrow keys to read each day.` });
    for (const v of [lo, (lo + hi) / 2, hi]) { s.append(svg('line', { class: 'grid', x1: L, x2: W - R, y1: Y(v), y2: Y(v) })); const t = svg('text', { class: 'axis', x: W - R + 8, y: Y(v) + 4 }); t.textContent = Math.round(v); s.append(t); }
    const every = range === 7 ? 1 : 5;
    data.forEach((d, i) => { if ((data.length - 1 - i) % every) return; const t = svg('text', { class: 'axis', x: X(i), y: H - 7, 'text-anchor': 'middle' }); t.textContent = d.today ? 'Today' : range === 7 ? dayName(d.at) : new Date(d.at).getDate(); s.append(t); });
    const path = data.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d.score).toFixed(1)}`).join(' ');
    s.append(svg('path', { d: `${path} L${X(data.length - 1)} ${H - B} L${X(0)} ${H - B} Z`, fill: P.color, opacity: 0.08 }));
    s.append(svg('path', { d: path, fill: 'none', stroke: P.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    data.forEach((d, i) => { if (range === 7 || i === data.length - 1) s.append(svg('circle', { cx: X(i), cy: Y(d.score), r: i === data.length - 1 ? 5 : 4, fill: P.color, stroke: '#FAF8FF', 'stroke-width': 2 })); });
    const cross = svg('line', { class: 'cross', y1: T, y2: H - B, visibility: 'hidden' }); const mark = svg('circle', { r: 6, fill: P.color, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }); s.append(cross, mark);
    const show = (i) => {
      c.at = i; const d = data[i]; if (!d) { cross.setAttribute('visibility', 'hidden'); mark.setAttribute('visibility', 'hidden'); c.tip.hidden = true; return; }
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      mark.setAttribute('cx', X(i)); mark.setAttribute('cy', Y(d.score)); mark.setAttribute('visibility', 'visible');
      tipFor(c, P, d, X(i), s.getBoundingClientRect().width || 600);
    };
    const nearest = (e) => { const r = s.getBoundingClientRect(); const x = (e.clientX - r.left) / (r.width || 1) * W; let best = 0; data.forEach((d, i) => { if (Math.abs(X(i) - x) < Math.abs(X(best) - x)) best = i; }); return best; };
    s.addEventListener('pointermove', (e) => show(nearest(e))); s.addEventListener('pointerdown', (e) => show(nearest(e)));
    s.addEventListener('pointerleave', () => show(null)); s.addEventListener('blur', () => show(null));
    s.addEventListener('keydown', (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); const i = c.at == null ? data.length - 1 : c.at + (e.key === 'ArrowLeft' ? -1 : 1); show(Math.max(0, Math.min(data.length - 1, i))); });
    const old = c.plot.querySelector('svg'); const hadFocus = old && document.activeElement === old; if (old) old.remove(); c.plot.prepend(s); c.tip.hidden = true; c.at = null; if (hadFocus) s.focus();
    const table = el('table'); const hr = el('tr'); hr.append(el('th', '', 'Day'), el('th', '', 'Score')); for (const [, label] of P.parts) hr.append(el('th', '', label)); table.append(hr);
    for (const d of data.slice().reverse()) { const tr = el('tr'); tr.append(el('td', '', d.today ? 'Today' : dayName(d.at, true)), el('td', '', String(d.score))); for (const [k] of P.parts) tr.append(el('td', '', String(d.parts[k]))); table.append(tr); }
    c.scroll.textContent = ''; c.scroll.append(table);
  }
  let last = '';
  function draw(force) {
    for (const b of seg.children) b.setAttribute('aria-pressed', String(Number(b.dataset.range) === range));
    const stamp = range + JSON.stringify(liveNow(), (k, v) => (k === 'hour' ? Math.floor(v) : v));
    if (!force && stamp === last && (cards.physical.at != null || cards.mental.at != null)) return;   // do not redraw under a reader's pointer
    if (stamp === last && !force) return;
    last = stamp; drawOne('physical'); drawOne('mental');
  }
  for (const b of seg.children) b.onclick = () => { range = Number(b.dataset.range); draw(true); };
  care.engine.subscribe(() => setTimeout(draw, 0));
  setInterval(draw, 2000);
  draw(true);
  root.VexoScores.series = series;
})(typeof window !== 'undefined' ? window : globalThis);
