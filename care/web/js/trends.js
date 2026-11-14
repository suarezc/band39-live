/* Band 39 care · Trends tab (Lisa's portal): Mom's history, charts, an AI summary and a chat about it.
 *
 * History: 185 days of plausible daily data for Margaret, generated from a seeded PRNG (same story every
 * load, anchored to today's date) until band 39 stores real days. Today's point is live from
 * VexoCare.view() and refreshes on engine changes, so simulator events show up in the trend.
 * Charts: hand-written SVG (no libraries), one accent per chart, hairline grid, event annotations,
 * crosshair tooltip (pointer + arrow keys), table view. Colours come from CSS vars in css/trends.css.
 * AI: POST /api/trend-summary {stats} and /api/chat {question, turns, stats, today} (server/history.py).
 * Only computed stats go to the server; offline rules answer when there is no OpenAI key.
 */
(function () {
  'use strict';
  const VC = window.VexoCare, root = document.getElementById('trendsRoot');
  if (!VC || !root) return;

  const DAY = 864e5, HIST = 185;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (n, s) => (window.VexoIcons ? window.VexoIcons.svg(n, s || 18) : '');
  const pathOf = (n) => (ico(n).match(/ d="([^"]+)"/) || [])[1] || '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sum = (xs) => xs.reduce((t, x) => t + x, 0);
  const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const fmtD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtDW = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateAgo = (a) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - a); };
  const todayStart = () => dateAgo(0).getTime();
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

  // ---- metrics ------------------------------------------------------------------------------------
  const int = (v) => Math.round(v).toLocaleString();
  const MET = {
    steps:    { label: 'Steps', kpi: 'Steps a day', unit: 'steps', per: 'a day', agg: 'mean', good: 'up', form: 'bar', fmt: int, care: 1 },
    balance:  { label: 'Balance score', kpi: 'Balance', unit: '/100', agg: 'mean', good: 'up', form: 'line', fmt: int, pts: 1, care: 1 },
    tremor:   { label: 'Shaking score', kpi: 'Shaking', unit: '/4', agg: 'mean', good: 'down', form: 'line', fmt: (v) => v.toFixed(1), dom: [0, 4], flat: 0.3 },
    falls:    { label: 'Falls', unit: '', agg: 'sum', good: 'down', fmt: int, care: 1 },
    sleep:    { label: 'Sleep', unit: 'h', per: 'a night', agg: 'mean', good: 'up', form: 'line', fmt: (v) => v.toFixed(1) + ' h', dom: [0, 10] },
    restless: { label: 'Restless moments in bed', unit: 'epochs', per: 'a night', agg: 'mean', good: 'down', form: 'bar', fmt: int },
    restless_nights: { label: 'Restless nights', kpi: 'Restless nights', unit: 'nights', agg: 'sum', good: 'down', fmt: int, care: 1 },
    wander:   { label: 'Night wandering', unit: 'episodes', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    missed:   { label: 'Pills missed', kpi: 'Pills missed', unit: 'doses', agg: 'sum', good: 'down', form: 'bar', fmt: int },
    recall:   { label: 'Memory moments remembered', kpi: 'Remembered', unit: '%', agg: 'ratio', good: 'up', form: 'line', fmt: (v) => Math.round(v) + '%', pts: 1, dom: [0, 100], care: 1 },
    concern:  { label: 'Memory & language concern', unit: '/100', agg: 'mean', good: 'down', form: 'line', fmt: int, pts: 1 },
    mood:     { label: 'Low-mood mentions', unit: 'mentions', agg: 'sum', good: 'down', form: 'bar', fmt: int },
    scam:     { label: 'Scam alerts', kpi: 'Scam alerts', unit: 'alerts', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    spend:    { label: 'Card spend', unit: '$', agg: 'sum', good: null, form: 'bar', fmt: (v) => '$' + Math.round(v).toLocaleString() },
    declines: { label: 'Card declines', unit: 'declines', agg: 'sum', good: 'down', fmt: int },
    urgent:   { label: 'Urgent alerts', unit: 'alerts', agg: 'sum', good: 'down', fmt: int },
    warn:     { label: 'Check-in alerts', unit: 'alerts', agg: 'sum', good: 'down', fmt: int },
    info:     { label: 'Info alerts', unit: 'alerts', agg: 'sum', good: null, fmt: int },
  };
  const LVL = [['urgent', 'Urgent'], ['warn', 'Check-in'], ['info', 'Info']];
  const GROUPS = [
    { id: 'phys', title: 'Physical', icon: 'body', charts: ['steps', 'balance', 'tremor'] },
    { id: 'mem', title: 'Memory & mood', icon: 'brain', charts: ['recall', 'concern', 'mood'] },
    { id: 'sleep', title: 'Sleep & nights', icon: 'moon', charts: ['restless', 'sleep', 'wander'] },
    { id: 'safe', title: 'Safety & money', icon: 'shield', charts: ['alerts', 'scam', 'spend', 'missed'] },
  ];
  const KPIS = ['steps', 'balance', 'restless_nights', 'recall', 'missed', 'scam'];
  const RANGES = {
    7: { days: 7, bin: 1, word: 'this week', period: 'over the last 7 days', prior: 'the 7 days before', vs: 'vs the week before', title: 'What changed this week' },
    30: { days: 30, bin: 1, word: 'this month', period: 'over the last 30 days', prior: 'the 30 days before', vs: 'vs the 30 days before', title: 'What changed this month' },
    90: { days: 91, bin: 7, word: 'these 3 months', period: 'over the last 3 months', prior: 'the 3 months before', vs: 'vs the 3 months before', title: 'What changed these 3 months' },
  };
  const EV_ICON = { pill: 'pill', fall: 'fall', scam: 'shield' };

  // ---- sample history (seeded, deterministic) ---------------------------------------------------------
  function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const PILL_AGO = 12, FALL_AGO = 9, SCAM_AGO = 6;
  const STORY = [
    { ago: 47, kind: 'fall', label: 'Fall in the garden' },
    { ago: 40, kind: 'scam', label: 'Scam call' },
    { ago: PILL_AGO, kind: 'pill', label: 'New pill started' },
    { ago: FALL_AGO, kind: 'fall', label: 'Fall at night' },
    { ago: SCAM_AGO, kind: 'scam', label: 'Gift-card scam calls' },
  ];
  function genHistory(doses) {
    const r = rng(39), g = () => (r() + r() + r() + r() - 2) * 1.73;
    const out = [];
    for (let a = HIST; a >= 0; a--) {
      const date = dateAgo(a), dow = date.getDay(), afterPill = a <= PILL_AGO;
      const drift = a <= 14 ? (14 - a) / 14 : 0, slip = Math.max(0, (30 - a) / 30);
      const fell = STORY.some((e) => e.kind === 'fall' && e.ago === a);
      let steps = 4300 + Math.sin((a / HIST) * Math.PI) * 260 + (dow === 0 ? 450 : 0) - drift * 1150 + g() * 330;
      if (fell || a === FALL_AGO - 1) steps *= 0.58;
      let balance = 72 - (afterPill ? 4 : 0) - drift * 2 + g() * 2.4; if (fell) balance -= 7;
      const tremor = r1(clamp(1.05 + g() * 0.2, 0, 4));   // daily average of the band's 0-4 readings
      const sleep = afterPill ? 6.2 + g() * 0.45 : 7.1 + g() * 0.4;
      const restless = Math.max(4, Math.round(afterPill ? 33 + g() * 7 : 17 + g() * 5));
      const wander = r() < (afterPill ? 0.33 : 0.05) ? 1 : 0;
      let missed = 0; for (let i = 0; i < doses; i++) if (r() < (a <= 14 ? 0.09 : 0.035)) missed++;
      const asked = 3 + Math.floor(r() * 2), remembered = clamp(Math.round(asked * (0.83 - slip * 0.18) + g() * 0.45), 0, asked);
      const concern = Math.round(clamp(19 + slip * 11 + g() * 3.5, 0, 100));
      const mood = r() < (afterPill ? 0.55 : 0.16) ? 1 : 0;
      const scam = a === SCAM_AGO ? 2 : a === SCAM_AGO - 1 ? 1 : a === 40 ? 1 : 0;
      const spend = Math.round(((dow === 2 || dow === 5 ? 38 + r() * 16 : 0) + (dow === 0 ? 7 + r() * 3 : 0) + (a % 10 === 3 ? 12 + r() * 8 : 0)) * 100) / 100;   // groceries Tue/Fri, Sunday cafe, pharmacy every 10 days
      const declines = a === SCAM_AGO ? 2 : a === SCAM_AGO - 1 ? 1 : 0;
      const info = (r() < 0.3 ? 1 : 0) + (r() < 0.08 ? 1 : 0);
      out.push({ ago: a, date, today: a === 0, steps: Math.round(steps / 10) * 10, balance: Math.round(clamp(balance, 30, 95)), tremor, sleep: r1(sleep), restless,
        restless_nights: restless >= 30 ? 1 : 0, wander, falls: fell ? 1 : 0, doses, missed, taken: doses - missed, asked, remembered, concern, mood, scam, spend, declines,
        urgent: (fell ? 1 : 0) + (scam ? 1 : 0), warn: wander + missed + (balance < 62 ? 1 : 0), info, live: [] });
    }
    return out;
  }

  // today's point from the live app (sleep hours stay the sample value: last night ended before the app knew)
  function liveToday(sample) {
    const V = VC.view(), s = V.s, L = V.labels, t = Object.assign({}, sample, { live: [] });
    const set = (k, v) => { t[k] = v; t.live.push(k); };
    const meds = Object.values(s.meds || {});
    set('steps', s.steps || 0);
    set('balance', L.balance && L.balance.score != null ? L.balance.score : null);
    set('tremor', L.tremor ? L.tremor.score : 0);
    set('falls', L.fall ? L.fall.count : 0);
    set('wander', L.wander ? L.wander.episodes : 0);
    if (L.sleep && L.sleep.epochs) { set('restless', L.sleep.wakeEpochs || 0); set('restless_nights', (L.sleep.wakeEpochs || 0) >= 30 ? 1 : 0); }
    t.doses = meds.filter((v) => v !== 'n/a').length || sample.doses;
    set('taken', meds.filter((v) => v === 'taken').length); set('missed', meds.filter((v) => v === 'missed').length);
    t.pending = meds.filter((v) => v === 'pending' || v === 'due').length;
    const rc = V.recall || []; set('asked', rc.length); set('remembered', rc.filter((x) => x.result === 'remembered').length);
    const ins = V.insights || [];
    const dm = ins.filter((x) => x.dementia).slice(0, 5).map((x) => ((x.dementia.memory.concern || 0) + (x.dementia.language.concern || 0)) / 2);
    set('concern', dm.length ? Math.round(avg(dm)) : null);
    set('mood', ins.filter((x) => (x.track || []).some((k) => k.metric === 'mood' && /sad|lonely|low|down|tired|worr|bored|upset|anx|miss/i.test(k.value)) || /\b(lonely|sad|depressed|miserable|so tired)\b/i.test(x.text || '')).length);
    const scIns = ins.filter((x) => x.risk && x.risk.scam && !['none', 'low'].includes(x.risk.scam.level)).length;
    const scAl = (s.alerts || []).filter((a) => /scam/i.test(a.key || '') || /scam/i.test(a.title || '')).length;
    set('scam', Math.max(scIns, scAl));
    const card = window.VexoMoney && window.VexoMoney.card, t0 = todayStart();
    const log = card && Array.isArray(card.log) ? card.log.filter((p) => p.at >= t0) : [];
    set('spend', Math.round(sum(log.filter((p) => p.approved).map((p) => p.amount))) / 100); set('declines', log.filter((p) => !p.approved).length);
    t.cardStatus = card ? card.status : null;
    for (const [k] of LVL) set(k, (s.alerts || []).filter((a) => a.level === k).length);
    t.openAlerts = (s.alerts || []).filter((a) => !a.ack && a.level !== 'good').slice(0, 5).map((a) => `${a.title} (${a.level}, ${fmtT(a.at)})`);
    t.mode = V.mode;
    return t;
  }

  // ---- state + derived ------------------------------------------------------------------------------
  const st = { range: +(localStorage.getItem('b39trendsRange') || 30), table: false, hist: null, sig: '', summary: {}, summarySig: {}, turns: [], busy: false, w: 0 };
  if (!RANGES[st.range]) st.range = 30;
  function rebuild() {
    let doses = 3; try { doses = Object.keys(VC.view().s.meds || {}).length || 3; } catch (_) { /* default */ }
    if (!st.base) st.base = genHistory(doses);
    const hist = st.base.slice(); hist[hist.length - 1] = liveToday(st.base[st.base.length - 1]);
    st.hist = hist; st.byAgo = (a) => hist[hist.length - 1 - a];
    const t = hist[hist.length - 1];
    st.events = STORY.slice();
    if (t.falls) st.events.push({ ago: 0, kind: 'fall', label: t.falls > 1 ? `${t.falls} falls today` : 'Fall today', live: 1 });
    if (t.scam) st.events.push({ ago: 0, kind: 'scam', label: 'Scam alert today', live: 1 });
    if (t.declines && !t.scam) st.events.push({ ago: 0, kind: 'scam', label: 'Card declined today', live: 1 });
  }
  function windowDays(range, offset) { const R = RANGES[range], out = []; for (let a = offset + R.days - 1; a >= offset; a--) { const d = st.byAgo(a); if (d) out.push(d); } return out; }
  const liveKey = (k) => (k === 'recall' ? 'asked' : k);
  function aggregate(key, days) {
    const m = MET[key];
    days = days.filter((d) => !d.today || d.live.includes(liveKey(key)));   // today counts only where the live app measures it
    if (m.agg === 'ratio') { const a = sum(days.map((d) => d.asked)); return a ? (100 * sum(days.map((d) => d.remembered))) / a : null; }
    if (m.agg === 'sum') return sum(days.map((d) => d[key] || 0));
    const pool = days.length > 1 ? days.filter((d) => !d.today) : days;   // today's steps are a partial day: kept out of averages
    return avg(pool.map((d) => d[key]).filter((v) => v != null));
  }
  function bins(range, offset) {
    const R = RANGES[range], days = windowDays(range, offset || 0), out = [];
    for (let i = 0; i < days.length; i += R.bin) {
      const ds = days.slice(i, i + R.bin), d0 = ds[0], today = ds.some((d) => d.today);
      out.push({ days: ds, today, date: d0.date, agoHi: d0.ago, agoLo: ds[ds.length - 1].ago,
        label: R.bin === 1 ? (today ? 'Today so far' : fmtDW(d0.date)) : `Week of ${fmtD(d0.date)}${today ? ' (so far)' : ''}`,
        tick: R.bin === 1 ? (today ? 'Today' : range === 7 ? d0.date.toLocaleDateString('en-US', { weekday: 'short' }) : fmtD(d0.date)) : (today ? 'This week' : fmtD(d0.date)) });
    }
    return out;
  }
  function delta(key, cur, pri) {
    const m = MET[key];
    if (cur == null || pri == null) return { text: 'no earlier data', cls: 'flat', dir: 0, rel: 0 };
    const diff = cur - pri; let rel, text;
    if (m.pts) { rel = diff / 100; const pts = Math.round(Math.abs(diff)); text = pts < 1 ? 'about the same' : `${diff > 0 ? 'up' : 'down'} ${pts} pt${pts === 1 ? '' : 's'}`; }
    else if (m.agg === 'sum') {
      if (pri === 0) { rel = cur > 0 ? 1 : 0; text = cur > 0 ? 'none the period before' : 'none, same as before'; }
      else { rel = diff / pri; text = Math.abs(rel) < 0.03 ? 'same as before' : `${diff > 0 ? 'up' : 'down'} from ${m.fmt(pri)}`; }
    } else if (m.flat && Math.abs(diff) < m.flat) { rel = 0; text = 'about the same'; }
    else { rel = pri ? diff / Math.abs(pri) : 0; text = Math.abs(rel) < 0.03 ? 'about the same' : `${rel > 0 ? 'up' : 'down'} ${Math.round(Math.abs(rel) * 100)}%`; }
    const dir = Math.abs(rel) < 0.03 ? 0 : Math.sign(diff);
    return { text, rel, dir, cls: !dir || !m.good ? 'flat' : (dir > 0) === (m.good === 'up') ? 'good' : 'bad' };
  }
  function eventsIn(range, offset) { const R = RANGES[range], lo = offset || 0, hi = lo + R.days - 1; return st.events.filter((e) => e.ago >= lo && e.ago <= hi); }

  // compact stats for the server (no raw sensor data, no keys)
  function buildStats(range, withSeries) {
    const R = RANGES[range], cur = windowDays(range, 0), pri = windowDays(range, R.days), out = {};
    const done = cur.filter((d) => !d.today), first = done.slice(0, 7), last = done.slice(-7);
    for (const k of Object.keys(MET)) {
      const m = MET[k], v = aggregate(k, cur), p = aggregate(k, pri), t = st.byAgo(0);
      out[k] = { label: m.label, unit: m.unit, agg: m.agg, good: m.good, value: r1(v), prior: r1(p), change: delta(k, v, p).text };
      if (range >= 30) { out[k].first_week = r1(aggregate(k, first)); out[k].last_week = r1(aggregate(k, last)); }
      if (k !== 'sleep' && k !== 'restless' && k !== 'restless_nights' || t.live.includes(k)) out[k].today = k === 'recall' ? (t.asked ? `${t.remembered} of ${t.asked}` : null) : t[k];
      if (m.care) out[k].care_priority = true;
    }
    const s = { period_label: R.period, prior_label: R.prior, range_days: R.days, from: fmtD(cur[0].date), to: fmtD(cur[cur.length - 1].date) + ' (today)',
      data_note: 'Past days are sample history until band 39 stores real days; today is live and partial.',
      doses_per_day: st.byAgo(1).doses, metrics: out,
      events: eventsIn(range, 0).map((e) => ({ date: e.ago === 0 ? 'today' : fmtD(dateAgo(e.ago)), kind: e.kind, label: e.label })) };
    if (withSeries) {
      const B = bins(range, 0), ser = { bin: R.bin === 1 ? 'day' : 'week', dates: B.map((b) => (b.today && R.bin === 1 ? 'today' : fmtD(b.date))) };
      for (const k of ['steps', 'balance', 'tremor', 'sleep', 'restless', 'wander', 'falls', 'missed', 'recall', 'concern', 'mood', 'scam', 'spend', 'declines', 'urgent'])
        ser[k] = B.map((b) => { if (b.today && R.bin === 1 && !b.days[0].live.includes(k === 'recall' ? 'asked' : k)) return null; const v = aggregate(k, b.days); return v == null ? null : k === 'spend' || k === 'sleep' || k === 'tremor' ? r1(v) : Math.round(v); });
      s.series = ser;
    }
    return s;
  }
  function todayFacts() {
    const t = st.byAgo(0);
    return { date: fmtD(t.date), mode: t.mode, steps_so_far: t.steps, balance: t.balance, shaking_score: t.tremor, falls: t.falls, night_wandering: t.wander,
      pills: { taken: t.taken, missed: t.missed, later: t.pending || 0 }, memory_moments: { asked: t.asked, remembered: t.remembered }, memory_language_concern: t.concern,
      low_mood_mentions: t.mood, scam_alerts: t.scam, card: { spend: t.spend, declines: t.declines, status: t.cardStatus }, open_alerts: t.openAlerts || [] };
  }

  // ---- svg helpers ---------------------------------------------------------------------------------------
  function niceStep(span, n) { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function domainFor(key, vals, form) {
    const m = MET[key] || {}, xs = vals.filter((v) => v != null);
    if (m.dom && form === 'line') return m.dom;
    const max = xs.length ? Math.max(...xs) : 1, min = xs.length ? Math.min(...xs) : 0;
    if (form !== 'line') { const top = Math.max(key === 'spend' ? 20 : 2, max); const s = niceStep(top, 2); return [0, Math.ceil(top / s) * s]; }
    const pad = Math.max((max - min) * 0.25, max * 0.06, 1), s = niceStep(max - min + 2 * pad, 2);
    const lo = Math.max(0, Math.floor((min - pad) / s) * s); let hi = Math.ceil((max + pad) / s) * s;
    if (Math.round((hi - lo) / s) % 2) hi += s;   // even number of steps keeps the middle tick on a round number
    return [lo, hi];
  }
  const tickFmt = (v) => (Math.abs(v) >= 10000 ? Math.round(v / 1000) + 'K' : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));
  function barPath(x, y, w, h, base) { if (h <= 0.5) return ''; const r = Math.min(4, w / 2, h); return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`; }

  // one chart = one svg; returns {html, model} where model drives the tooltip
  // the days behind one plotted value: memory moments are few a day, so the daily line is a 7-day rolling rate
  const rolling = (key) => key === 'recall' && RANGES[st.range].bin === 1;
  function valueDays(key, b) { if (!rolling(key)) return b.days; const out = []; for (let a = b.agoHi + 6; a >= b.agoLo; a--) { const d = st.byAgo(a); if (d) out.push(d); } return out; }
  function chartSvg(key, B, W, H) {
    const isStack = key === 'alerts', m = MET[key] || { label: 'Alerts by level', fmt: int };
    const form = isStack ? 'bar' : m.form;
    const vals = B.map((b) => (isStack ? sum(LVL.map(([k]) => aggregate(k, b.days))) : aggregate(key, valueDays(key, b))));
    const [lo, hi] = domainFor(isStack ? 'urgent' : key, vals, form);
    const ml = 38, mr = 10, mt = 26, mb = 24, pw = W - ml - mr, ph = H - mt - mb, base = mt + ph, n = B.length, slot = pw / n;
    const X = (i) => ml + slot * (i + 0.5), Y = (v) => base - ((v - lo) / (hi - lo || 1)) * ph;
    let g = '';
    // grid + y ticks (3 hairlines)
    for (const v of [lo, (lo + hi) / 2, hi]) { const y = Y(v); g += `<line class="tr-gl${v === lo ? ' base' : ''}" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="tr-tick" x="${ml - 6}" y="${y + 4}" text-anchor="end">${tickFmt(v)}</text>`; }
    // x ticks: first, middle, last
    const xt = n <= 7 ? B.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of xt) g += `<text class="tr-tick" x="${n <= 7 ? X(i) : i === 0 ? ml : i === n - 1 ? W - mr : X(i)}" y="${H - 6}" text-anchor="${n <= 7 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(B[i].tick)}</text>`;
    // event annotations: hairline + icon badge, placed left to right without overlap
    const ev = [], R = RANGES[st.range];
    for (const e of eventsIn(st.range, 0)) { const i = B.findIndex((b) => e.ago <= b.agoHi && e.ago >= b.agoLo); if (i >= 0 && !ev.some((x) => x.i === i && x.kind === e.kind)) ev.push({ i, kind: e.kind, label: e.label }); }
    ev.sort((a, b) => a.i - b.i); let lastX = -99;
    for (const e of ev) {
      const x0 = X(e.i), bx = Math.min(W - mr - 9, Math.max(x0, lastX + 19)); lastX = bx;
      g += `<line class="tr-ev-line" x1="${x0}" x2="${x0}" y1="${mt - 4}" y2="${base}"/><g class="tr-badge tr-ev-${e.kind}"><circle cx="${bx}" cy="11" r="9"/><g transform="translate(${bx - 6.5},${4.5}) scale(0.54)"><path d="${pathOf(EV_ICON[e.kind])}"/></g><title>${esc(e.label)}</title></g>`;
    }
    // marks
    if (isStack) {
      const bw = Math.max(1, Math.min(24, slot - 2));
      B.forEach((b, i) => {
        let y = base; const parts = LVL.map(([k]) => [k, aggregate(k, b.days)]).filter(([, v]) => v > 0);
        parts.forEach(([k, v], j) => {
          const h = (v / (hi - lo)) * ph, top = y - h, last = j === parts.length - 1, gap = j > 0 ? 2 : 0;
          g += last ? `<path class="tr-seg-${k}${b.today ? ' today' : ''}" d="${barPath(X(i) - bw / 2, top, bw, h - gap, y - gap)}"/>` : `<rect class="tr-seg-${k}${b.today ? ' today' : ''}" x="${X(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(0, h - gap)}"/>`;
          y = top;
        });
      });
    } else if (form === 'bar') {
      const bw = Math.max(1, Math.min(24, slot - 2));
      vals.forEach((v, i) => { if (v) g += `<path class="tr-bar${B[i].today ? ' today' : ''}" d="${barPath(X(i) - bw / 2, Y(v), bw, base - Y(v), base)}"/>`; });
      if (key === 'spend') B.forEach((b, i) => { const d = aggregate('declines', b.days); if (d) g += `<circle class="tr-decline" cx="${X(i)}" cy="${mt + 4}" r="4.5"/>`; });
    } else {
      const lastDone = B[n - 1].today && R.bin === 1 ? n - 2 : n - 1;
      let dpath = '', pen = false;
      for (let i = 0; i <= lastDone; i++) { const v = vals[i]; if (v == null) { pen = false; continue; } dpath += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
      g += `<path class="tr-line" d="${dpath}"/>`;
      if (vals[lastDone] != null) g += `<circle class="tr-dot" cx="${X(lastDone)}" cy="${Y(vals[lastDone])}" r="4"/>`;
      if (lastDone === n - 2 && vals[n - 1] != null) g += `<circle class="tr-today" cx="${X(n - 1)}" cy="${Y(clamp(vals[n - 1], lo, hi))}" r="4.5"/>`;
    }
    g += `<line class="tr-cross" x1="0" x2="0" y1="${mt - 4}" y2="${base}" visibility="hidden"/><rect class="tr-hit" x="${ml}" y="0" width="${pw}" height="${H}"/>`;
    return { html: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${g}</svg>`, model: { X, slot, ml, n, vals, B, ev, key, isStack, mt, base } };
  }

  function takeaway(key) {
    const R = RANGES[st.range];
    if (key === 'alerts') { const c = LVL.map(([k]) => aggregate(k, windowDays(st.range, 0))); return `${c[0]} urgent · ${c[1]} check-in · ${c[2]} info ${R.word}`; }
    const m = MET[key], v = aggregate(key, windowDays(st.range, 0)), p = aggregate(key, windowDays(st.range, R.days)), d = delta(key, v, p);
    const head = v == null ? 'No data yet' : m.agg === 'sum' ? `${m.fmt(v)} ${key === 'spend' ? 'spent' : 'in all'}` : m.agg === 'ratio' ? `${m.fmt(v)} remembered` : `Avg ${m.fmt(v)}${m.unit.startsWith('/') ? m.unit : ''}${m.per ? ' ' + m.per : ''}`;
    return `${head} · ${d.text}${d.text.startsWith('no earlier') ? '' : ' ' + R.vs}`;
  }
  const chartTitle = (key) => (key === 'alerts' ? 'Alerts by level' : key === 'recall' && rolling(key) ? 'Memory moments remembered (7-day rate)' : key === 'steps' ? 'Steps a day' : key === 'restless' ? 'Restless moments in bed' : key === 'sleep' ? 'Hours of sleep' : MET[key].label);

  // ---- skeleton (built once; sections re-render independently so the chat never resets) -------------------
  root.innerHTML = `
    <div class="tr-filters" role="toolbar" aria-label="Trend range">
      <div class="tr-seg" role="radiogroup" aria-label="Range">${[7, 30, 90].map((r) => `<button type="button" role="radio" data-range="${r}">${r} days</button>`).join('')}</div>
      <button type="button" class="tr-tablebtn" data-table aria-pressed="false">${ico('receipt', 16)}<span>Table</span></button>
    </div>
    <p class="tr-note">${ico('clock', 16)}<span><b>Past days are sample history</b> until band 39 has stored real days. <b>Today is live</b> from the band and Mom’s conversations, and updates as things happen.</span></p>
    <section class="tr-card tr-summary" aria-live="polite" id="trSummary"></section>
    <div class="tr-kpis" id="trKpis"></div>
    <section class="tr-card tr-chat" aria-labelledby="trChatH">
      <div class="tr-head"><span class="tr-ic">${ico('chat', 20)}</span><div><h3 id="trChatH">Ask about Mom’s trends</h3><p class="fine">Answers only from these numbers and today’s band data, never a diagnosis.</p></div></div>
      <ol class="tr-msgs" id="trMsgs" aria-live="polite"></ol>
      <div class="tr-chips" id="trChips">${['How has her sleep been?', 'Is her walking getting worse?', 'Anything about money I should know?', 'How is her memory?', 'What should I tell Dr. Patel?'].map((q) => `<button type="button" class="tr-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="tr-ask" id="trAsk"><input id="trQ" maxlength="300" placeholder="Ask about Mom’s trends…" autocomplete="off" aria-label="Ask about Mom’s trends" /><button class="pill violet" type="submit">Ask</button></form>
    </section>
    <div id="trCharts"></div>
    <div id="trTable" hidden></div>`;
  const $ = (id) => document.getElementById(id);

  // ---- KPI tiles -----------------------------------------------------------------------------------------
  function spark(key) {
    const R = RANGES[st.range], prior = bins(st.range, R.days), cur = bins(st.range, 0), all = prior.concat(cur);
    const vals = all.map((b) => aggregate(key, b.days)), xs = vals.filter((v) => v != null);
    if (!xs.length) return '';
    let lo = Math.min(...xs), hi = Math.max(...xs); if (MET[key].agg === 'sum') lo = 0; if (hi === lo) hi = lo + 1;
    const W = 120, H = 30, n = all.length, X = (i) => (i / (n - 1)) * W, Y = (v) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
    const seg = (a, b) => { let d = '', pen = false; for (let i = a; i <= b; i++) { if (vals[i] == null || (cur[i - prior.length] || {}).today && R.bin === 1 && MET[key].agg !== 'sum') { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(vals[i]).toFixed(1)}`; pen = true; } return d; };
    return `<svg class="tr-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="prior" d="${seg(0, prior.length)}"/><path class="cur" d="${seg(prior.length, n - 1)}"/></svg>`;
  }
  function renderKpis() {
    const R = RANGES[st.range], cur = windowDays(st.range, 0), pri = windowDays(st.range, R.days);
    $('trKpis').innerHTML = KPIS.map((k) => {
      const m = MET[k], v = aggregate(k, cur), p = aggregate(k, pri), d = delta(k, v, p);
      const sub = k === 'missed' ? `of ${sum(cur.map((x) => x.doses))} doses` : k === 'restless_nights' ? `of ${cur.length} nights` : k === 'balance' ? 'out of 100' : k === 'recall' ? 'memory moments' : k === 'steps' ? 'average' : k === 'scam' ? R.word : '';
      const arrow = d.dir ? `<span class="tr-arrow ${d.dir > 0 ? 'up' : 'down'}">${ico('arrow', 13)}</span>` : '';
      return `<div class="tr-kpi" role="group" aria-label="${esc(m.kpi)}: ${esc(v == null ? 'no data' : m.fmt(v))} ${esc(sub)}, ${esc(d.text)} ${esc(R.vs)}">
        <span class="tr-kpi-l">${esc(m.kpi)}</span><b class="tr-kpi-v">${v == null ? '—' : esc(m.fmt(v))}</b><span class="tr-kpi-s">${esc(sub)}</span>
        <span class="tr-delta ${d.cls}">${arrow}${esc(d.text)}</span>${spark(k)}</div>`;
    }).join('') + `<p class="tr-kpi-key fine"><span><i class="k-prior"></i>previous period</span><span><i class="k-cur"></i>${esc(R.word)}</span><span>changes are ${esc(R.vs)}</span></p>`;
  }

  // ---- charts ---------------------------------------------------------------------------------------------
  const models = new Map();
  function renderCharts() {
    const box = $('trCharts'); const B = bins(st.range, 0), R = RANGES[st.range];
    const evs = eventsIn(st.range, 0);
    const evRow = evs.length ? `<div class="tr-evrow"><span class="fine">Marked on the charts:</span>${evs.map((e) => `<span class="tr-evchip tr-ev-${e.kind}"><i>${ico(EV_ICON[e.kind], 13)}</i>${esc(e.label)} · ${e.ago === 0 ? 'today' : esc(fmtD(dateAgo(e.ago)))}</span>`).join('')}</div>` : '';
    box.innerHTML = evRow + GROUPS.map((G) => `<section class="tr-group" aria-labelledby="trg-${G.id}"><h3 class="tr-gh" id="trg-${G.id}"><span class="tr-ic">${ico(G.icon, 18)}</span>${esc(G.title)}</h3>
      <div class="tr-grid ${G.charts.length % 2 ? 'odd' : ''}">${G.charts.map((k) => `<figure class="tr-chart" data-chart="${k}"><figcaption><b>${esc(chartTitle(k))}</b><span>${esc(takeaway(k))}</span></figcaption>
        <div class="tr-plot" tabindex="0" role="img" data-key="${k}"></div>${k === 'alerts' ? `<div class="tr-legend">${LVL.map(([lk, ll]) => `<span><i class="sw tr-sw-${lk}"></i>${ll}</span>`).join('')}</div>` : k === 'spend' ? '<div class="tr-legend"><span><i class="sw tr-sw-bar"></i>Approved spend</span><span><i class="dot tr-sw-decline"></i>Declined payment</span></div>' : ''}<div class="tr-tip" role="status" hidden></div></figure>`).join('')}</div></section>`).join('');
    models.clear();
    box.querySelectorAll('.tr-plot').forEach((el) => {
      const k = el.dataset.key, W = Math.max(240, Math.floor(el.clientWidth || 300)), lead = el.closest('.tr-grid.odd') && el.closest('.tr-chart') === el.closest('.tr-grid').firstElementChild;
      const c = chartSvg(k, B, W, lead ? 170 : 150);
      el.innerHTML = c.html; models.set(el, c.model);
      el.setAttribute('aria-label', `${chartTitle(k)}, ${R.period}. ${takeaway(k)}.${c.model.ev.length ? ' Marked: ' + c.model.ev.map((e) => e.label).join(', ') + '.' : ''} Use the left and right arrow keys to read each ${R.bin === 1 ? 'day' : 'week'}.`);
    });
  }
  function showTip(el, i) {
    const md = models.get(el); if (!md) return;
    i = clamp(i, 0, md.n - 1); el.dataset.i = i;
    const b = md.B[i], x = md.X(i), fig = el.closest('.tr-chart'), tip = fig.querySelector('.tr-tip'), cross = el.querySelector('.tr-cross');
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    let rows = '';
    if (md.isStack) rows = LVL.map(([k, l]) => `<div class="tr-tip-row"><i class="key tr-sw-${k}"></i><b>${aggregate(k, b.days)}</b> ${l}</div>`).join('');
    else {
      const m = MET[md.key], v = md.vals[i];
      const vd = valueDays(md.key, b).filter((d) => !d.today || d.live.includes('asked')), extra = md.key === 'recall' ? ` (${sum(vd.map((d) => d.remembered))} of ${sum(vd.map((d) => d.asked))}${rolling(md.key) ? ' over 7 days' : ''})` : md.key === 'missed' ? ` of ${sum(b.days.map((d) => d.doses))}` : md.key === 'spend' && aggregate('declines', b.days) ? ` · ${aggregate('declines', b.days)} declined` : '';
      rows = `<div class="tr-tip-row"><i class="key tr-sw-bar"></i><b>${v == null ? 'not measured' : esc(m.fmt(v))}</b>${v == null ? '' : ' ' + esc(m.unit.startsWith('/') ? m.unit : m.unit === '$' || m.unit === '%' || m.unit === 'h' ? '' : m.unit)}${esc(extra)}</div>`;
    }
    const evs = md.ev.filter((e) => e.i === i).map((e) => `<div class="tr-tip-ev">${ico(EV_ICON[e.kind], 13)}${esc(e.label)}</div>`).join('');
    const live = b.today && st.byAgo(0).live.includes(md.isStack ? 'urgent' : md.key) ? '<div class="tr-tip-src">live from the band</div>' : b.today ? '<div class="tr-tip-src">sample (not measured live)</div>' : '';
    tip.innerHTML = `<div class="tr-tip-d">${esc(b.label)}</div>${rows}${evs}${live}`;
    tip.hidden = false;
    const fw = fig.clientWidth, tw = tip.offsetWidth, px = el.offsetLeft + x;
    tip.style.left = (px + 12 + tw > fw - 4 ? Math.max(4, px - 12 - tw) : px + 12) + 'px';
    tip.style.top = (el.offsetTop + 6) + 'px';
  }
  function hideTip(el) { const fig = el.closest('.tr-chart'); fig.querySelector('.tr-tip').hidden = true; const c = el.querySelector('.tr-cross'); if (c) c.setAttribute('visibility', 'hidden'); }
  $('trCharts').addEventListener('pointermove', (e) => {
    const el = e.target.closest('.tr-plot'); if (!el) return; const md = models.get(el); if (!md) return;
    const x = e.clientX - el.getBoundingClientRect().left; showTip(el, Math.floor((x - md.ml) / md.slot));
  });
  $('trCharts').addEventListener('pointerleave', (e) => { if (e.target.classList && e.target.classList.contains('tr-plot')) hideTip(e.target); }, true);
  $('trCharts').addEventListener('pointerdown', (e) => { const el = e.target.closest('.tr-plot'); if (el && e.pointerType !== 'mouse') { const md = models.get(el); showTip(el, Math.floor((e.clientX - el.getBoundingClientRect().left - md.ml) / md.slot)); } });
  $('trCharts').addEventListener('focusin', (e) => { const el = e.target.closest('.tr-plot'); if (el) { const md = models.get(el); showTip(el, el.dataset.i != null ? +el.dataset.i : md.n - 1); } });
  $('trCharts').addEventListener('focusout', (e) => { const el = e.target.closest('.tr-plot'); if (el) hideTip(el); });
  $('trCharts').addEventListener('keydown', (e) => {
    const el = e.target.closest('.tr-plot'); if (!el) return; const md = models.get(el), i = +(el.dataset.i || md.n - 1);
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: md.n - 1 }[e.key]; if (to == null) return; e.preventDefault(); showTip(el, to);
  });

  // ---- table view (the WCAG twin of every chart) --------------------------------------------------------------
  function renderTable() {
    const B = bins(st.range, 0), R = RANGES[st.range];
    const cols = [['Date', null], ['Steps', 'steps'], ['Balance', 'balance'], ['Shaking', 'tremor'], ['Sleep', 'sleep'], ['Restless', 'restless'], ['Wandering', 'wander'], ['Falls', 'falls'],
      ['Pills missed', 'missed'], ['Remembered', 'recall'], ['Concern', 'concern'], ['Low mood', 'mood'], ['Scam', 'scam'], ['Spend', 'spend'], ['Declines', 'declines'], ['Urgent', 'urgent'], ['Check-in', 'warn'], ['Info', 'info']];
    const ev = (b) => st.events.filter((e) => e.ago <= b.agoHi && e.ago >= b.agoLo).map((e) => e.label).join(', ');
    $('trTable').innerHTML = `<div class="tr-card tr-tablecard"><div class="tr-head"><div><h3>${R.bin === 1 ? 'Daily' : 'Weekly'} values · ${esc(R.period.replace('over ', ''))}</h3><p class="fine">${R.bin === 1 ? 'One row per day' : 'One row per week: averages for scores, totals for counts'}. Newest first. Today is live and partial; other days are sample history.</p></div></div>
      <div class="tr-tablewrap" tabindex="0" role="region" aria-label="Trend table"><table class="tr-table"><thead><tr>${cols.map(([l]) => `<th scope="col">${l}</th>`).join('')}<th scope="col">Events</th></tr></thead><tbody>${B.slice().reverse().map((b) => `<tr${b.today ? ' class="today"' : ''}><th scope="row">${esc(b.label)}</th>${cols.slice(1).map(([, k]) => { const v = aggregate(k, b.days); return `<td>${v == null ? '—' : esc(MET[k].fmt(v))}</td>`; }).join('')}<td class="ev">${esc(ev(b))}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---- AI summary -----------------------------------------------------------------------------------------
  const statsSig = (s) => JSON.stringify(s.metrics) + JSON.stringify(s.events);
  function renderSummary() {
    const R = RANGES[st.range], d = st.summary[st.range], box = $('trSummary');
    const head = `<div class="tr-head"><span class="tr-ic">${ico('sparkle', 20)}</span><div><h3>${esc(R.title)}</h3><p class="fine">A short read of the trend numbers ${esc(R.period.replace('over ', 'for '))}.</p></div><button type="button" class="pill small" data-summary aria-label="Refresh the summary">${ico('reset', 14)}<span class="tr-hide-sm">Refresh</span></button></div>`;
    if (!d) { box.innerHTML = head + '<p class="tr-wait"><span class="tr-dots" aria-hidden="true"><i></i><i></i><i></i></span>Reading Mom’s trends…</p>'; return; }
    if (d.error) { box.innerHTML = head + `<p class="empty">Couldn’t write the summary right now (${esc(d.error)}). Tap Refresh to try again.</p>`; return; }
    const stale = st.summarySig[st.range] !== statsSig(buildStats(st.range, false));
    box.innerHTML = head + `<p class="tr-sum-h">${esc(d.headline)}</p>
      <ul class="tr-sum-list">${(d.changes || []).map((c) => `<li class="tone-${esc(c.tone)}"><i aria-hidden="true"></i><span>${esc(c.text)}</span></li>`).join('')}</ul>
      ${(d.stable || []).length ? `<div class="tr-sum-sub"><b>Steady</b><ul>${d.stable.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${(d.next_steps || []).length ? `<div class="tr-sum-next"><b>Next steps</b><ul>${d.next_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      <p class="fine tr-src">${d.source === 'openai' ? 'Written by OpenAI from the trend numbers' : 'Offline summary from simple rules' + (d.source && d.source !== 'rules' ? ' (AI unavailable)' : ' (no AI key)')} · ${fmtT(d.at)} · signals, not a diagnosis${stale ? ' · <b>new data since then</b>' : ''}</p>`;
  }
  async function loadSummary(force) {
    const range = st.range;
    if (st.summary[range] && !force) return renderSummary();
    st.summary[range] = null; renderSummary();
    const stats = buildStats(range, true);
    try { const d = await post('api/trend-summary', { stats }); d.at = Date.now(); st.summary[range] = d; st.summarySig[range] = statsSig(buildStats(range, false)); }
    catch (e) { st.summary[range] = { error: e.message }; }
    if (st.range === range) renderSummary();
  }

  // ---- chat -------------------------------------------------------------------------------------------------
  const labelOf = (k) => (MET[k] ? MET[k].label : k === 'events' ? 'Marked events' : k === 'today' ? 'Today' : k);
  function renderChat() {
    const R = RANGES[st.range];
    const hello = `<li class="tr-msg bot"><span>Hi Lisa. I can look through Mom’s ${R.days === 91 ? 'last 3 months' : `last ${R.days} days`}: walking, balance, sleep, memory, mood, pills and money. What would you like to know?</span></li>`;
    $('trMsgs').innerHTML = hello + st.turns.map((t) => t.role === 'user' ? `<li class="tr-msg me"><span>${esc(t.text)}</span></li>`
      : `<li class="tr-msg bot${t.covered === false ? ' uncovered' : ''}"><span>${esc(t.text)}</span>${(t.used || []).length ? `<small>Based on: ${esc(t.used.map(labelOf).join(', '))}</small>` : ''}<small>${t.source === 'openai' ? 'OpenAI' : 'Offline rules'}${t.covered === false ? ' · not in the data' : ''}</small></li>`).join('')
      + (st.busy ? '<li class="tr-msg bot typing" aria-label="Thinking"><span><span class="tr-dots"><i></i><i></i><i></i></span></span></li>' : '');
    const box = $('trMsgs'); box.scrollTop = box.scrollHeight;
    $('trAsk').querySelector('button').disabled = st.busy; $('trQ').disabled = st.busy;
  }
  async function ask(q) {
    q = String(q || '').trim(); if (!q || st.busy) return;
    const turns = st.turns.slice(-16).map((t) => ({ role: t.role, text: t.text }));
    st.turns.push({ role: 'user', text: q }); st.busy = true; renderChat();
    let a;
    try { a = await post('api/chat', { question: q, turns, stats: buildStats(st.range, true), today: todayFacts() }); }
    catch (e) { a = { answer: 'I couldn’t reach the helper just now. Please try again.', used: [], covered: false, source: 'error' }; }
    st.busy = false; st.turns.push({ role: 'assistant', text: a.answer, used: a.used || [], covered: a.covered, source: a.source });
    if (st.turns.length > 40) st.turns = st.turns.slice(-40);
    renderChat(); $('trQ').focus({ preventScroll: true });
  }

  // ---- render loop -----------------------------------------------------------------------------------------
  function renderControls() {
    root.querySelectorAll('[data-range]').forEach((b) => { const on = +b.dataset.range === st.range; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    const tb = root.querySelector('[data-table]'); tb.setAttribute('aria-pressed', st.table); tb.classList.toggle('on', st.table);
    $('trCharts').hidden = st.table; $('trTable').hidden = !st.table;
  }
  function renderData() { renderKpis(); if (st.table) renderTable(); else renderCharts(); }
  function renderAll() { rebuild(); st.sig = JSON.stringify(st.byAgo(0)); renderControls(); renderData(); renderSummary(); renderChat(); }
  const visible = () => root.offsetParent !== null && root.clientWidth > 0;

  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-range]'), t = e.target.closest('[data-table]'), s = e.target.closest('[data-summary]'), c = e.target.closest('[data-q]');
    if (r) { st.range = +r.dataset.range; localStorage.setItem('b39trendsRange', st.range); renderControls(); renderData(); renderChat(); loadSummary(false); }
    if (t) { st.table = !st.table; renderControls(); renderData(); }
    if (s) loadSummary(true);
    if (c) ask(c.dataset.q);
  });
  $('trAsk').addEventListener('submit', (e) => { e.preventDefault(); const q = $('trQ').value; $('trQ').value = ''; ask(q); });

  // live refresh: engine changes (simulator events, alerts, pills) and polled follower state -> today's point
  let pend = 0, shown = false;
  function refresh() {
    pend = 0; if (!visible()) return;
    rebuild(); const sig = JSON.stringify(st.byAgo(0));
    if (!shown) { shown = true; st.sig = sig; st.w = root.clientWidth; renderControls(); renderData(); renderChat(); loadSummary(false); return; }
    if (sig !== st.sig) { st.sig = sig; renderData(); if (st.summary[st.range] && !st.summary[st.range].error) renderSummary(); }
  }
  const schedule = () => { if (!pend) pend = setTimeout(refresh, 400); };
  try { VC.engine.subscribe(schedule); } catch (_) { /* older engine */ }
  setInterval(schedule, 3000);
  new ResizeObserver(() => { const w = root.clientWidth; if (!w) return; schedule(); if (!shown) return refresh(); if (Math.abs(w - st.w) > 8) { st.w = w; if (!st.table) renderCharts(); } }).observe(root);
  rebuild(); renderControls(); renderSummary(); renderChat();
  if (visible()) refresh();
  st.w = root.clientWidth;

  window.VexoTrends = { get history() { return st.hist; }, stats: (r) => buildStats(r || st.range, true), today: todayFacts, ask, refreshSummary: () => loadSummary(true), render: renderAll };
})();
