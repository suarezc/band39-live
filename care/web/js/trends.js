/* Band 39 care · trends for Lisa: Mom's history by category, charts, an AI summary and a chat about it.
 *
 * Where it renders
 *   #trendsRoot (Trends tab): range + table toggles, AI summary, chat, then Mental / Financial / Physical health.
 *   [data-trend-cat="mental|financial|physical"] (category tabs): that category's one-line summary, KPI tiles
 *   and history charts. The 7/30/90-day range is shared by every view.
 * History: 185 days of plausible daily data for Margaret from a seeded PRNG (same story every load, anchored
 *   to today's date) until band 39 stores real days. Today's point is live from VexoCare.view() and
 *   window.VexoMoney.card, refreshed on engine changes, so simulator events show up in the trend.
 * Charts: hand-written SVG (no libraries), one accent per chart, hairline grid, event annotations,
 *   crosshair tooltip (pointer + arrow keys), table view. Colours are CSS vars in css/trends.css.
 * AI: POST /api/trend-summary {stats} and /api/chat {question, turns, stats, today} (server/history.py).
 *   Only computed stats go to the server; offline rules answer when there is no OpenAI key.
 */
(function () {
  'use strict';
  const VC = window.VexoCare, root = document.getElementById('trendsRoot');
  if (!VC) return;

  const HIST = 185;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (n, s) => (window.VexoIcons ? window.VexoIcons.svg(n, s || 18) : '');
  const pathOf = (n) => (ico(n).match(/ d="([^"]+)"/) || [])[1] || '';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sum = (xs) => xs.reduce((t, x) => t + x, 0);
  const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtD = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtDW = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateAgo = (a) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - a); };
  const todayStart = () => dateAgo(0).getTime();
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

  // ---- metrics + categories ---------------------------------------------------------------------------
  const int = (v) => Math.round(v).toLocaleString();
  const usd = (v) => '$' + Math.round(v).toLocaleString();
  const MET = {
    // mental health
    concern:  { label: 'Memory & language concern', kpi: 'Memory concern', unit: '/100', agg: 'mean', good: 'down', form: 'line', fmt: int, pts: 1 },
    recall:   { label: 'Memory moments remembered', kpi: 'Remembered', unit: '%', agg: 'ratio', good: 'up', form: 'line', fmt: (v) => Math.round(v) + '%', pts: 1, dom: [0, 100], care: 1 },
    mood:     { label: 'Low-mood mentions', kpi: 'Low-mood mentions', unit: 'mentions', agg: 'sum', good: 'down', form: 'bar', fmt: int },
    wander:   { label: 'Night wandering', unit: 'episodes', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    restless: { label: 'Restless moments in bed', unit: 'epochs', per: 'a night', agg: 'mean', good: 'down', form: 'bar', fmt: int },
    restless_nights: { label: 'Restless nights', kpi: 'Restless nights', unit: 'nights', agg: 'sum', good: 'down', fmt: int, care: 1 },
    sleep:    { label: 'Sleep', unit: 'h', per: 'a night', agg: 'mean', good: 'up', form: 'line', fmt: (v) => v.toFixed(1) + ' h', dom: [0, 10] },
    // financial health
    scam:     { label: 'Scam alerts', kpi: 'Scam alerts', unit: 'alerts', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    exploit:  { label: 'Exploitation flags', kpi: 'Exploitation flags', unit: 'flags', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    spend:    { label: 'Card spend', unit: '$', agg: 'sum', good: null, form: 'line', fmt: usd },
    declines: { label: 'Card declines', kpi: 'Card declines', unit: 'declines', agg: 'sum', good: 'down', form: 'bar', fmt: int },
    bills:    { label: 'Missed-bill mentions', kpi: 'Missed bills', unit: 'mentions', agg: 'sum', good: 'down', form: 'bar', fmt: int },
    // physical health
    steps:    { label: 'Steps', kpi: 'Steps a day', unit: 'steps', per: 'a day', agg: 'mean', good: 'up', form: 'bar', fmt: int, care: 1 },
    balance:  { label: 'Balance score', kpi: 'Balance', unit: '/100', agg: 'mean', good: 'up', form: 'line', fmt: int, pts: 1, care: 1 },
    tremor:   { label: 'Shaking score', kpi: 'Shaking', unit: '/4', agg: 'mean', good: 'down', form: 'line', fmt: (v) => v.toFixed(1), dom: [0, 4], flat: 0.3 },
    falls:    { label: 'Falls', kpi: 'Falls', unit: 'falls', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    missed:   { label: 'Pills missed', kpi: 'Pills missed', unit: 'doses', agg: 'sum', good: 'down', form: 'bar', fmt: int },
    seizure:  { label: 'Seizure-like events', unit: 'events', agg: 'sum', good: 'down', form: 'bar', fmt: int, care: 1 },
    // alerts (table + AI only)
    urgent:   { label: 'Urgent alerts', unit: 'alerts', agg: 'sum', good: 'down', fmt: int },
    warn:     { label: 'Check-in alerts', unit: 'alerts', agg: 'sum', good: 'down', fmt: int },
    info:     { label: 'Info alerts', unit: 'alerts', agg: 'sum', good: null, fmt: int },
  };
  const CATS = [
    { id: 'mental', title: 'Mental health', icon: 'brain', ev: ['pill'], kpis: ['recall', 'concern', 'mood', 'restless_nights'], charts: ['recall', 'concern', 'mood', 'restless', 'sleep', 'wander'] },
    { id: 'financial', title: 'Financial health', icon: 'coin', ev: ['scam'], kpis: ['scam', 'exploit', 'declines', 'bills'], charts: ['spend', 'scam', 'declines', 'exploit', 'bills'] },
    { id: 'physical', title: 'Physical health', icon: 'body', ev: ['pill', 'fall'], kpis: ['steps', 'balance', 'falls', 'missed'], charts: ['steps', 'balance', 'tremor', 'missed', 'falls', 'seizure'] },
  ];
  const CAT_OF = {}; CATS.forEach((c) => [...c.kpis, ...c.charts].forEach((k) => { CAT_OF[k] = CAT_OF[k] || c.id; }));
  const RANGES = {
    7: { days: 7, bin: 1, word: 'this week', period: 'over the last 7 days', span: 'the last 7 days', prior: 'the 7 days before', vs: 'vs the week before', title: 'What changed this week' },
    30: { days: 30, bin: 1, word: 'this month', period: 'over the last 30 days', span: 'the last 30 days', prior: 'the 30 days before', vs: 'vs the 30 days before', title: 'What changed this month' },
    90: { days: 91, bin: 7, word: 'these 3 months', period: 'over the last 3 months', span: 'the last 3 months', prior: 'the 3 months before', vs: 'vs the 3 months before', title: 'What changed these 3 months' },
  };
  const EV_ICON = { pill: 'pill', fall: 'fall', scam: 'shield' };
  const TITLE = { spend: 'Card spend vs weekly limit', steps: 'Steps a day', restless: 'Restless moments in bed', sleep: 'Hours of sleep' };

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
      const wander = (r() < 0.025 || (afterPill && a % 3 === 1)) ? 1 : 0;   // a few night walks since the new pill
      let missed = 0; for (let i = 0; i < 4; i++) { const u = r(); if (i < doses && u < (a <= 14 ? 0.09 : 0.035)) missed++; }   // fixed draws: the story doesn't change with the dose count
      const asked = 3 + Math.floor(r() * 2), remembered = clamp(Math.round(asked * (0.83 - slip * 0.18) + g() * 0.45), 0, asked);
      const concern = Math.round(clamp(19 + slip * 11 + g() * 3.5, 0, 100));
      const mood = r() < (afterPill ? 0.55 : 0.16) ? 1 : 0;
      const scam = a === SCAM_AGO ? 2 : a === SCAM_AGO - 1 ? 1 : a === 40 ? 1 : 0;
      const spend = Math.round(((dow === 2 || dow === 5 ? 38 + r() * 16 : 0) + (dow === 0 ? 7 + r() * 3 : 0) + (a % 10 === 3 ? 12 + r() * 8 : 0)) * 100) / 100;   // groceries Tue/Fri, Sunday cafe, pharmacy every 10 days
      const declines = a === SCAM_AGO ? 2 : a === SCAM_AGO - 1 ? 1 : 0;
      const info = (r() < 0.3 ? 1 : 0) + (r() < 0.08 ? 1 : 0);
      const exploit = a === 23 ? 1 : 0;                       // "my nephew wants to borrow my card again"
      const bills = a === 16 || a === 3 || a === 58 ? 1 : 0;  // "I think I forgot the electric bill"
      out.push({ ago: a, date, today: a === 0, steps: Math.round(steps / 10) * 10, balance: Math.round(clamp(balance, 30, 95)), tremor, sleep: r1(sleep), restless,
        restless_nights: restless >= 30 ? 1 : 0, wander, falls: fell ? 1 : 0, seizure: 0, doses, missed, taken: doses - missed, asked, remembered, concern, mood,
        scam, exploit, bills, spend, declines, urgent: (fell ? 1 : 0) + (scam ? 1 : 0), warn: wander + missed + (balance < 62 ? 1 : 0), info, live: [] });
    }
    return out;
  }

  // today's point from the live app; metrics the app doesn't measure today are left out of today's stats
  const BILL_RE = /\b(bills?|overdue|late (fee|notice)|forgot to pay|electric(ity)? company|gas company|rent is due|disconnect(ed|ion) notice)\b/i;
  function liveToday(sample) {
    const V = VC.view(), s = V.s, L = V.labels, t = Object.assign({}, sample, { live: [] });
    const set = (k, v) => { t[k] = v; t.live.push(k); };
    const meds = Object.values(s.meds || {}), alerts = s.alerts || [], ins = V.insights || [];
    const band = !!(V.conn && V.conn.kind && V.conn.kind !== 'none');   // motion metrics count only while a band (real or pretend) is connected
    t.band = band;
    if (band || s.steps) set('steps', s.steps || 0);
    if (band) {
      set('balance', L.balance && L.balance.score != null ? L.balance.score : null);
      set('tremor', L.tremor ? L.tremor.score : 0);
      set('seizure', L.seizure ? L.seizure.count : 0);
      set('wander', L.wander ? L.wander.episodes : 0);
    }
    if (band || (L.fall && L.fall.count)) set('falls', L.fall ? L.fall.count : 0);
    if (L.sleep && L.sleep.epochs) { set('restless', L.sleep.wakeEpochs || 0); set('restless_nights', (L.sleep.wakeEpochs || 0) >= 30 ? 1 : 0); }
    t.doses = meds.filter((v) => v !== 'n/a').length || sample.doses;
    set('taken', meds.filter((v) => v === 'taken').length); set('missed', meds.filter((v) => v === 'missed').length);
    t.pending = meds.filter((v) => v === 'pending' || v === 'due').length;
    const rc = V.recall || []; set('asked', rc.length); set('remembered', rc.filter((x) => x.result === 'remembered').length);
    const dm = ins.filter((x) => x.dementia).slice(0, 5).map((x) => ((x.dementia.memory.concern || 0) + (x.dementia.language.concern || 0)) / 2);
    set('concern', dm.length ? Math.round(avg(dm)) : null);
    set('mood', ins.filter((x) => (x.track || []).some((k) => k.metric === 'mood' && /sad|lonely|low|down|tired|worr|bored|upset|anx|miss/i.test(k.value)) || /\b(lonely|sad|depressed|miserable|so tired)\b/i.test(x.text || '')).length);
    const lvl = (r) => r && !['none', 'low'].includes(r.level);
    set('scam', Math.max(ins.filter((x) => x.risk && lvl(x.risk.scam)).length, alerts.filter((a) => /scam/i.test(a.key || '') || /scam/i.test(a.title || '')).length));
    set('exploit', Math.max(ins.filter((x) => x.risk && lvl(x.risk.abuse)).length, alerts.filter((a) => /abuse|exploit/i.test(a.key || '') || /abuse|exploit/i.test(a.title || '')).length));
    set('bills', ins.filter((x) => BILL_RE.test(x.text || '')).length);
    const card = window.VexoMoney && window.VexoMoney.card, t0 = todayStart();
    const log = card && Array.isArray(card.log) ? card.log.filter((p) => p.at >= t0) : [];
    set('spend', Math.round(sum(log.filter((p) => p.approved).map((p) => p.amount))) / 100); set('declines', log.filter((p) => !p.approved).length);
    t.card = card ? { status: card.status, frozenBecause: card.frozenBecause || null, weeklyLimit: card.weekly != null ? card.weekly / 100 : null, perPurchase: card.perPurchase != null ? card.perPurchase / 100 : null,
      spentThisWeek: window.CardRules && window.CardRules.weekSpent ? window.CardRules.weekSpent(card) / 100 : null } : null;
    for (const k of ['urgent', 'warn', 'info']) set(k, alerts.filter((a) => a.level === k).length);
    t.openAlerts = alerts.filter((a) => !a.ack && a.level !== 'good').slice(0, 5).map((a) => `${a.title} (${a.level}, ${fmtT(a.at)})`);
    t.mode = V.mode;
    return t;
  }

  // ---- state + derived ------------------------------------------------------------------------------
  const st = { range: +(localStorage.getItem('b39trendsRange') || 30), table: false, sig: '', summary: {}, summarySig: {}, turns: [], busy: false };
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
    else if (t.declines) st.events.push({ ago: 0, kind: 'scam', label: 'Card declined today', live: 1 });
  }
  const spendLimit = () => { const c = window.VexoMoney && window.VexoMoney.card; return c && c.weekly ? c.weekly / 100 : 200; };
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
      if (pri === 0) { rel = cur > 0 ? 1 : 0; text = cur > 0 ? 'none before' : 'none, same as before'; }
      else { rel = diff / pri; text = Math.abs(rel) < 0.03 ? 'same as before' : `${diff > 0 ? 'up' : 'down'} from ${m.fmt(pri)}`; }
    } else if (m.flat && Math.abs(diff) < m.flat) { rel = 0; text = 'about the same'; }
    else { rel = pri ? diff / Math.abs(pri) : 0; text = Math.abs(rel) < 0.03 ? 'about the same' : `${rel > 0 ? 'up' : 'down'} ${Math.round(Math.abs(rel) * 100)}%`; }
    const dir = Math.abs(rel) < 0.03 ? 0 : Math.sign(diff);
    return { text, rel, dir, cls: !dir || !m.good ? 'flat' : (dir > 0) === (m.good === 'up') ? 'good' : 'bad' };
  }
  const period = (key) => { const R = RANGES[st.range], v = aggregate(key, windowDays(st.range, 0)), p = aggregate(key, windowDays(st.range, R.days)); return { v, p, d: delta(key, v, p) }; };
  function eventsIn(range, kinds) { const hi = RANGES[range].days - 1; return st.events.filter((e) => e.ago <= hi && (!kinds || kinds.includes(e.kind))); }

  // compact stats for the server (no raw sensor data, no keys)
  function buildStats(range, withSeries) {
    const R = RANGES[range], cur = windowDays(range, 0), pri = windowDays(range, R.days), out = {}, t = st.byAgo(0);
    const done = cur.filter((d) => !d.today), first = done.slice(0, 7), last = done.slice(-7);
    for (const k of Object.keys(MET)) {
      const m = MET[k], v = aggregate(k, cur), p = aggregate(k, pri);
      out[k] = { label: m.label, category: CAT_OF[k] || 'alerts', unit: m.unit, agg: m.agg, good: m.good, value: r1(v), prior: r1(p), change: delta(k, v, p).text };
      if (range >= 30) { out[k].first_week = r1(aggregate(k, first)); out[k].last_week = r1(aggregate(k, last)); }
      if (t.live.includes(liveKey(k))) out[k].today = k === 'recall' ? (t.asked ? `${t.remembered} of ${t.asked}` : null) : t[k];
      if (m.care) out[k].care_priority = true;
    }
    out.spend.weekly_limit = spendLimit();
    const s = { period_label: R.period, prior_label: R.prior, range_days: R.days, from: fmtD(cur[0].date), to: fmtD(cur[cur.length - 1].date) + ' (today)',
      categories: { mental: 'Mental health', financial: 'Financial health', physical: 'Physical health' },
      data_note: 'Past days are sample history until band 39 stores real days; today is live and partial.',
      doses_per_day: st.byAgo(1).doses, metrics: out,
      events: eventsIn(range).map((e) => ({ date: e.ago === 0 ? 'today' : fmtD(dateAgo(e.ago)), kind: e.kind, label: e.label })) };
    if (withSeries) {
      const B = bins(range, 0), ser = { bin: R.bin === 1 ? 'day' : 'week', dates: B.map((b) => (b.today && R.bin === 1 ? 'today' : fmtD(b.date))) };
      for (const k of ['concern', 'recall', 'mood', 'restless', 'sleep', 'wander', 'scam', 'exploit', 'spend', 'declines', 'bills', 'steps', 'balance', 'tremor', 'falls', 'missed'])
        ser[k] = B.map((b) => { if (b.today && R.bin === 1 && !b.days[0].live.includes(liveKey(k))) return null; const v = aggregate(k, b.days); return v == null ? null : k === 'spend' || k === 'sleep' || k === 'tremor' ? r1(v) : Math.round(v); });
      s.series = ser;
    }
    return s;
  }
  function todayFacts() {
    const t = st.byAgo(0);
    return { date: fmtD(t.date), mode: t.mode, band_connected: t.band, steps_so_far: t.steps, balance: t.balance, shaking_score: t.tremor, falls: t.falls, seizure_like: t.seizure, night_wandering: t.wander,
      pills: { taken: t.taken, missed: t.missed, later: t.pending || 0 }, memory_moments: { asked: t.asked, remembered: t.remembered }, memory_language_concern: t.concern,
      low_mood_mentions: t.mood, scam_alerts: t.scam, exploitation_flags: t.exploit, missed_bill_mentions: t.bills,
      card: Object.assign({ spend_today: t.spend, declines_today: t.declines }, t.card || {}), open_alerts: t.openAlerts || [] };
  }

  // ---- svg ------------------------------------------------------------------------------------------------
  function niceStep(span, n) { const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function domainFor(key, vals, form) {
    const m = MET[key] || {}, xs = vals.filter((v) => v != null);
    if (m.dom && form === 'line') return m.dom;
    const max = xs.length ? Math.max(...xs) : 1, min = xs.length ? Math.min(...xs) : 0;
    if (form !== 'line') {
      if (m.agg === 'sum' && key !== 'spend') { const s = Math.max(1, Math.ceil(max / 2)); return [0, 2 * s]; }   // counts: whole-number ticks
      const top = Math.max(2, max), s = niceStep(top, 2); return [0, Math.ceil(top / s) * s];
    }
    const pad = Math.max((max - min) * 0.25, max * 0.06, 1), s = niceStep(max - min + 2 * pad, 2);
    const lo = Math.max(0, Math.floor((min - pad) / s) * s); let hi = Math.ceil((max + pad) / s) * s;
    if (Math.round((hi - lo) / s) % 2) hi += s;   // even number of steps keeps the middle tick on a round number
    return [lo, hi];
  }
  const tickFmt = (v, key) => (key === 'spend' ? '$' : '') + (Math.abs(v) >= 10000 ? Math.round(v / 1000) + 'K' : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1));
  function barPath(x, y, w, h, base) { if (h <= 0.5) return ''; const r = Math.min(4, w / 2, h); return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`; }
  // the days behind one plotted value: memory moments are few a day, so that line is a 7-day rate; spend is a 7-day total to compare with the weekly limit
  const rolling = (key) => (key === 'recall' || key === 'spend') && RANGES[st.range].bin === 1;
  function valueDays(key, b) { if (!rolling(key)) return b.days; const out = []; for (let a = b.agoHi + 6; a >= b.agoLo; a--) { const d = st.byAgo(a); if (d) out.push(d); } return out; }
  const chartTitle = (key) => (key === 'recall' && rolling(key) ? 'Memory moments remembered (7-day rate)' : TITLE[key] || MET[key].label);

  function chartSvg(key, B, W, H, kinds) {
    const m = MET[key], form = m.form, R = RANGES[st.range], limit = key === 'spend' ? spendLimit() : null;
    const vals = B.map((b) => aggregate(key, valueDays(key, b)));
    let [lo, hi] = domainFor(key, limit ? vals.concat([limit * 1.15]) : vals, limit ? 'bar' : form);
    const ml = 40, mr = 10, mt = 26, mb = 24, pw = W - ml - mr, ph = H - mt - mb, base = mt + ph, n = B.length, slot = pw / n;
    const X = (i) => ml + slot * (i + 0.5), Y = (v) => base - ((v - lo) / (hi - lo || 1)) * ph;
    let g = '';
    for (const v of [lo, (lo + hi) / 2, hi]) { const y = Y(v); g += `<line class="tr-gl${v === lo ? ' base' : ''}" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="tr-tick" x="${ml - 6}" y="${y + 4}" text-anchor="end">${tickFmt(v, key)}</text>`; }
    const xt = n <= 7 ? B.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of xt) g += `<text class="tr-tick" x="${n <= 7 ? X(i) : i === 0 ? ml : i === n - 1 ? W - mr : X(i)}" y="${H - 6}" text-anchor="${n <= 7 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(B[i].tick)}</text>`;
    if (limit) { const y = Y(limit); g += `<line class="tr-limit" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="tr-limit-t" x="${ml + 4}" y="${y - 5}">weekly limit ${usd(limit)}</text>`; }
    // event annotations: hairline + icon badge, placed left to right without overlap
    const ev = [];
    for (const e of eventsIn(st.range, kinds)) { const i = B.findIndex((b) => e.ago <= b.agoHi && e.ago >= b.agoLo); if (i >= 0 && !ev.some((x) => x.i === i && x.kind === e.kind)) ev.push({ i, kind: e.kind, label: e.label }); }
    ev.sort((a, b) => a.i - b.i); let lastX = -99;
    for (const e of ev) {
      const x0 = X(e.i), bx = Math.min(W - mr - 9, Math.max(x0, lastX + 19)); lastX = bx;
      g += `<line class="tr-ev-line" x1="${x0}" x2="${x0}" y1="${mt - 4}" y2="${base}"/><g class="tr-badge tr-ev-${e.kind}"><circle cx="${bx}" cy="11" r="9"/><g transform="translate(${bx - 6.5},4.5) scale(0.54)"><path d="${pathOf(EV_ICON[e.kind])}"/></g><title>${esc(e.label)}</title></g>`;
    }
    if (form === 'bar') {
      const bw = Math.max(1, Math.min(24, slot - 2));
      vals.forEach((v, i) => { if (v) g += `<path class="tr-bar${B[i].today ? ' today' : ''}" d="${barPath(X(i) - bw / 2, Y(v), bw, base - Y(v), base)}"/>`; });
    } else {
      const lastDone = B[n - 1].today && R.bin === 1 ? n - 2 : n - 1;
      let dpath = '', pen = false;
      for (let i = 0; i <= lastDone; i++) { const v = vals[i]; if (v == null) { pen = false; continue; } dpath += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
      if (limit) g += `<path class="tr-area" d="${dpath}L${X(lastDone).toFixed(1)},${base}L${X(0).toFixed(1)},${base}Z"/>`;
      g += `<path class="tr-line" d="${dpath}"/>`;
      if (vals[lastDone] != null) g += `<circle class="tr-dot" cx="${X(lastDone)}" cy="${Y(vals[lastDone])}" r="4"/>`;
      if (lastDone === n - 2 && vals[n - 1] != null) g += `<circle class="tr-today" cx="${X(n - 1)}" cy="${Y(clamp(vals[n - 1], lo, hi))}" r="4.5"/>`;
    }
    if (limit) B.forEach((b, i) => { if (aggregate('declines', b.days)) g += `<circle class="tr-decline" cx="${X(i)}" cy="${mt + 4}" r="4.5"/>`; });
    g += `<line class="tr-cross" x1="0" x2="0" y1="${mt - 4}" y2="${base}" visibility="hidden"/><rect class="tr-hit" x="${ml}" y="0" width="${pw}" height="${H}"/>`;
    return { html: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${g}</svg>`, model: { X, slot, ml, n, vals, B, ev, key, limit } };
  }

  function takeaway(key) {
    const R = RANGES[st.range], m = MET[key], { v, d } = period(key);
    if (v == null) return 'No data yet';
    const head = key === 'spend' ? `${usd(v)} spent ${R.word}` : m.agg === 'sum' ? `${m.fmt(v)} in all` : m.agg === 'ratio' ? `${m.fmt(v)} remembered` : `Avg ${m.fmt(v)}${m.unit.startsWith('/') ? m.unit : ''}${m.per ? ' ' + m.per : ''}`;
    const tail = d.text === 'none before' ? 'none in ' + R.prior : /^(same as before|about the same)$/.test(d.text) ? 'about the same as ' + R.prior : d.text.startsWith('no earlier') ? d.text : d.text + ' ' + R.vs;
    return `${head} · ${tail}`;
  }
  // one rule-based line per category (the AI summary lives on the Trends tab)
  function catLine(cat) {
    const R = RANGES[st.range], keys = [...new Set([...cat.kpis, ...cat.charts])];
    const rows = keys.map((k) => Object.assign({ k }, period(k))).filter((x) => x.d.dir && MET[x.k].good);
    const say = (x) => { const m = MET[x.k]; return x.d.text === 'none before' ? `${m.label.toLowerCase()} ${m.fmt(x.v)} (none before)` : `${m.label.toLowerCase()} ${x.d.text}`; };
    const w = (x) => Math.min(2, Math.abs(x.d.rel)) * (MET[x.k].care ? 1.5 : 1);
    const bad = rows.filter((x) => x.d.cls === 'bad').sort((a, b) => w(b) - w(a)), good = rows.filter((x) => x.d.cls === 'good').sort((a, b) => w(b) - w(a));
    let s = bad.length ? `Worth a look ${R.word}: ${bad.slice(0, 3).map(say).join('; ')}.` : `Steady ${R.word}: nothing notable ${R.vs}.`;
    if (good.length) s += ` Better: ${say(good[0])}.`;
    return { text: s, level: bad.length ? 'watch' : 'ok' };
  }

  // ---- one category section (KPIs + charts), rendered into any container ------------------------------------
  const models = new WeakMap();
  function spark(key) {
    const R = RANGES[st.range], prior = bins(st.range, R.days), cur = bins(st.range, 0), all = prior.concat(cur);
    const vals = all.map((b) => aggregate(key, b.days)), xs = vals.filter((v) => v != null);
    if (!xs.length) return '';
    let lo = Math.min(...xs), hi = Math.max(...xs); if (MET[key].agg === 'sum') lo = 0; if (hi === lo) hi = lo + 1;
    const W = 120, H = 30, n = all.length, X = (i) => (i / (n - 1)) * W, Y = (v) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
    const seg = (a, b) => { let d = '', pen = false; for (let i = a; i <= b; i++) { if (vals[i] == null || ((cur[i - prior.length] || {}).today && R.bin === 1 && MET[key].agg !== 'sum')) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(vals[i]).toFixed(1)}`; pen = true; } return d; };
    return `<svg class="tr-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="prior" d="${seg(0, prior.length)}"/><path class="cur" d="${seg(prior.length, n - 1)}"/></svg>`;
  }
  function kpiTile(k) {
    const R = RANGES[st.range], m = MET[k], cur = windowDays(st.range, 0), { v, d } = period(k);
    const sub = k === 'missed' ? `of ${sum(cur.filter((x) => !x.today || x.live.includes('missed')).map((x) => x.doses))} doses` : k === 'restless_nights' ? `of ${cur.length} nights` : k === 'balance' || k === 'concern' ? 'out of 100'
      : k === 'recall' ? 'of memory moments' : k === 'steps' ? 'average' : R.word;
    const arrow = d.dir ? `<span class="tr-arrow ${d.dir > 0 ? 'up' : 'down'}">${ico('arrow', 13)}</span>` : '';
    return `<div class="tr-kpi" role="group" aria-label="${esc(m.kpi)}: ${esc(v == null ? 'no data' : m.fmt(v))} ${esc(sub)}, ${esc(d.text)} ${esc(R.vs)}">
      <span class="tr-kpi-l">${esc(m.kpi)}</span><b class="tr-kpi-v">${v == null ? '—' : esc(m.fmt(v))}</b><span class="tr-kpi-s">${esc(sub)}</span>
      <span class="tr-delta ${d.cls}">${arrow}${esc(d.text)}</span>${spark(k)}</div>`;
  }
  function sectionHtml(cat, withHeading) {
    const R = RANGES[st.range], line = catLine(cat), evs = eventsIn(st.range, cat.ev);
    const wide = (i) => cat.charts.length % 2 === 1 && i === 0;
    return `${withHeading ? `<h3 class="tr-cat-h" id="trc-${cat.id}"><span class="tr-ic">${ico(cat.icon, 18)}</span>${esc(cat.title)}</h3>` : ''}
      <p class="tr-catline ${line.level}"><i aria-hidden="true"></i><span>${esc(line.text)}</span></p>
      <div class="tr-kpis">${cat.kpis.map(kpiTile).join('')}</div>
      <p class="tr-kpi-key fine"><span><i class="k-prior"></i>previous period</span><span><i class="k-cur"></i>${esc(R.word)}</span><span>changes are ${esc(R.vs)}</span></p>
      ${evs.length ? `<div class="tr-evrow"><span class="fine">Marked on the charts:</span>${evs.map((e) => `<span class="tr-evchip tr-ev-${e.kind}"><i>${ico(EV_ICON[e.kind], 13)}</i>${esc(e.label)} · ${e.ago === 0 ? 'today' : esc(fmtD(dateAgo(e.ago)))}</span>`).join('')}</div>` : ''}
      <div class="tr-grid">${cat.charts.map((k, i) => {
        const empty = MET[k].agg === 'sum' && !period(k).v;
        return `<figure class="tr-chart${wide(i) ? ' wide' : ''}${empty ? ' empty' : ''}" data-chart="${k}"><figcaption><b>${esc(chartTitle(k))}</b><span>${empty ? `None in ${esc(R.span)}` : esc(takeaway(k))}</span></figcaption>
          ${empty ? '' : `<div class="tr-plot" tabindex="0" role="img" data-key="${k}" data-cat="${cat.id}" data-lead="${wide(i) ? 1 : 0}"></div>`}
          ${k === 'spend' && !empty ? '<div class="tr-legend"><span><i class="ln tr-sw-bar"></i>Spent in the 7 days to each day</span><span><i class="ln tr-sw-limit"></i>Weekly limit</span><span><i class="dot tr-sw-decline"></i>Declined payment</span></div>' : ''}
          <div class="tr-tip" role="status" hidden></div></figure>`;
      }).join('')}</div>`;
  }
  function fillPlots(box) {
    const B = bins(st.range, 0), R = RANGES[st.range];
    box.querySelectorAll('.tr-plot').forEach((el) => {
      const k = el.dataset.key, cat = CATS.find((c) => c.id === el.dataset.cat), W = Math.max(240, Math.floor(el.clientWidth || 300));
      const c = chartSvg(k, B, W, el.dataset.lead === '1' ? 170 : 150, cat.ev);
      el.innerHTML = c.html; models.set(el, c.model);
      el.setAttribute('aria-label', `${chartTitle(k)}, ${R.period}. ${takeaway(k)}.${c.model.ev.length ? ' Marked: ' + c.model.ev.map((e) => e.label).join(', ') + '.' : ''} Use the left and right arrow keys to read each ${R.bin === 1 ? 'day' : 'week'}.`);
    });
  }
  const segHtml = () => `<div class="tr-seg" role="radiogroup" aria-label="Range">${[7, 30, 90].map((r) => `<button type="button" role="radio" data-range="${r}" class="${r === st.range ? 'on' : ''}" aria-checked="${r === st.range}">${r} days</button>`).join('')}</div>`;

  // a category tab's embed: header with the shared range, then the section
  function renderEmbed(el) {
    const cat = CATS.find((c) => c.id === el.dataset.trendCat); if (!cat) return;
    el.classList.add('trends-root', 'tr-embed');
    el.innerHTML = `<div class="tr-embed-head"><div><h3>${esc(cat.title)} over time</h3><p class="fine">Past days are sample history; today is live.</p></div>${segHtml()}</div>
      ${sectionHtml(cat, false)}<p class="fine tr-embed-foot">The AI summary and “Ask about Mom’s trends” are on the <a href="#/caregiver/c-trends">Trends</a> tab.</p>`;
    fillPlots(el);
  }
  // the Trends tab: all three categories in order (or the table)
  function renderOverviewCats() {
    if (!root) return;
    const box = document.getElementById('trCats');
    box.innerHTML = CATS.map((c) => `<section class="tr-cat" aria-labelledby="trc-${c.id}">${sectionHtml(c, true)}</section>`).join('');
    fillPlots(box);
    if (st.table) renderTable();
  }

  // ---- tooltip (shared by every chart on every tab) ---------------------------------------------------------
  function showTip(el, i) {
    const md = models.get(el); if (!md) return;
    i = clamp(i, 0, md.n - 1); el.dataset.i = i;
    const b = md.B[i], x = md.X(i), fig = el.closest('.tr-chart'), tip = fig.querySelector('.tr-tip'), cross = el.querySelector('.tr-cross');
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    const m = MET[md.key], v = md.vals[i], vd = valueDays(md.key, b).filter((d) => !d.today || d.live.includes(liveKey(md.key)));
    const unit = m.unit.startsWith('/') ? m.unit : ['$', '%', 'h'].includes(m.unit) ? '' : m.unit;
    const extra = md.key === 'recall' ? ` (${sum(vd.map((d) => d.remembered))} of ${sum(vd.map((d) => d.asked))}${rolling(md.key) ? ' over 7 days' : ''})`
      : md.key === 'missed' ? ` of ${sum(vd.map((d) => d.doses))}` : md.key === 'spend' ? ` in ${rolling('spend') ? 'the 7 days to here' : 'this week'}` : '';
    let rows = `<div class="tr-tip-row"><i class="key tr-sw-bar"></i><b>${v == null ? 'not measured' : esc(m.fmt(v))}</b>${v == null ? '' : ' ' + esc(unit) + esc(extra)}</div>`;
    if (md.limit) { const dc = aggregate('declines', b.days); rows += `<div class="tr-tip-row"><i class="key tr-sw-limit"></i>limit ${usd(md.limit)} a week</div>${dc ? `<div class="tr-tip-row"><i class="key tr-sw-decline"></i><b>${dc}</b> declined</div>` : ''}`; }
    const evs = md.ev.filter((e) => e.i === i).map((e) => `<div class="tr-tip-ev">${ico(EV_ICON[e.kind], 13)}${esc(e.label)}</div>`).join('');
    const live = b.today && R1().bin === 1 ? `<div class="tr-tip-src">${st.byAgo(0).live.includes(liveKey(md.key)) ? 'live from the band and app' : 'not measured live today'}</div>` : '';
    tip.innerHTML = `<div class="tr-tip-d">${esc(b.label)}</div>${rows}${evs}${live}`;
    tip.hidden = false;
    const fw = fig.clientWidth, tw = tip.offsetWidth, px = el.offsetLeft + x;
    tip.style.left = (px + 12 + tw > fw - 4 ? Math.max(4, px - 12 - tw) : px + 12) + 'px';
    tip.style.top = (el.offsetTop + 6) + 'px';
  }
  const R1 = () => RANGES[st.range];
  function hideTip(el) { const fig = el.closest('.tr-chart'); if (fig) fig.querySelector('.tr-tip').hidden = true; const c = el.querySelector('.tr-cross'); if (c) c.setAttribute('visibility', 'hidden'); }
  const plotAt = (e) => { const el = e.target.closest && e.target.closest('.tr-plot'); return el && models.get(el) ? el : null; };
  const idxAt = (el, e) => { const md = models.get(el); return Math.floor((e.clientX - el.getBoundingClientRect().left - md.ml) / md.slot); };
  document.addEventListener('pointermove', (e) => { const el = plotAt(e); if (el) showTip(el, idxAt(el, e)); });
  document.addEventListener('pointerdown', (e) => { const el = plotAt(e); if (el && e.pointerType !== 'mouse') showTip(el, idxAt(el, e)); });
  document.addEventListener('pointerleave', (e) => { if (e.target.classList && e.target.classList.contains('tr-plot')) hideTip(e.target); }, true);
  document.addEventListener('focusin', (e) => { const el = plotAt(e); if (el) showTip(el, el.dataset.i != null ? +el.dataset.i : models.get(el).n - 1); });
  document.addEventListener('focusout', (e) => { const el = plotAt(e); if (el) hideTip(el); });
  document.addEventListener('keydown', (e) => {
    const el = plotAt(e); if (!el) return; const md = models.get(el), i = +(el.dataset.i != null ? el.dataset.i : md.n - 1);
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: md.n - 1 }[e.key]; if (to == null) return; e.preventDefault(); showTip(el, to);
  });

  // ---- shared range control (any tab) ------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const r = e.target.closest('.trends-root [data-range]'); if (!r) return;
    st.range = +r.dataset.range; localStorage.setItem('b39trendsRange', st.range);
    renderEverything(); if (root) loadSummary(false);
  });

  // ---- live refresh + targets ------------------------------------------------------------------------------------
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null;
  const seen = new WeakSet();
  // measured on the parent: an empty embed is display:none (app.css .trend-cat:empty) until it has content
  const visible = (el) => { const h = el.id === 'trCats' ? el : el.parentElement || el; return h.offsetParent !== null && h.clientWidth > 0; };
  function targets() { const out = [...document.querySelectorAll('[data-trend-cat]')].map((el) => { if (ro && el.parentElement && !seen.has(el.parentElement)) { seen.add(el.parentElement); ro.observe(el.parentElement); } return el; }); if (root) out.push(document.getElementById('trCats')); return out.filter(Boolean); }
  function renderTarget(el, force) {
    if (!visible(el)) return;
    const key = `${st.range}|${st.table}|${st.sig}|${Math.round((el.id === 'trCats' ? el : el.parentElement || el).clientWidth / 8)}`;
    if (!force && el._trKey === key) return;
    el._trKey = key;
    if (el.id === 'trCats') renderOverviewCats(); else renderEmbed(el);
  }
  function renderEverything() {
    rebuild(); st.sig = JSON.stringify(st.byAgo(0), (k, v) => (k === 'date' ? undefined : v));
    if (root) renderControls();
    for (const el of targets()) { if (ro && !seen.has(el)) { seen.add(el); ro.observe(el); } el._trKey = ''; renderTarget(el, true); }
    if (root) { if (st.table) renderTable(); renderSummary(); renderChat(); }
  }
  let pend = 0;
  function refresh() {
    pend = 0;
    rebuild(); const sig = JSON.stringify(st.byAgo(0), (k, v) => (k === 'date' ? undefined : v)); const changed = sig !== st.sig; st.sig = sig;
    for (const el of targets()) { if (ro && !seen.has(el)) { seen.add(el); ro.observe(el); } renderTarget(el, false); }
    if (root && st.table && changed) renderTable();
    if (root && visible(root)) {
      if (!st.summary[st.range] && !st.loading) loadSummary(false);
      else if (changed && st.summary[st.range] && !st.summary[st.range].error) renderSummary();
    }
  }
  function schedule() { if (!pend) pend = setTimeout(refresh, 300); }

  // ---- the Trends tab shell (summary, chat, table) ------------------------------------------------------------------
  function renderControls() {
    root.querySelectorAll('.tr-filters [data-range]').forEach((b) => { const on = +b.dataset.range === st.range; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    const tb = root.querySelector('[data-table]'); tb.setAttribute('aria-pressed', st.table); tb.classList.toggle('on', st.table);
    document.getElementById('trCats').hidden = st.table; document.getElementById('trTable').hidden = !st.table;
  }
  function renderTable() {
    const B = bins(st.range, 0), R = RANGES[st.range];
    const cols = [['Concern', 'concern'], ['Remembered', 'recall'], ['Low mood', 'mood'], ['Restless', 'restless'], ['Sleep', 'sleep'], ['Wandering', 'wander'],
      ['Scam', 'scam'], ['Exploitation', 'exploit'], ['Spend', 'spend'], ['Declines', 'declines'], ['Missed bills', 'bills'],
      ['Steps', 'steps'], ['Balance', 'balance'], ['Shaking', 'tremor'], ['Pills missed', 'missed'], ['Falls', 'falls'], ['Seizure-like', 'seizure']];
    const groups = [['Mental health', 6], ['Financial health', 5], ['Physical health', 6]];
    const ev = (b) => st.events.filter((e) => e.ago <= b.agoHi && e.ago >= b.agoLo).map((e) => e.label).join(', ');
    document.getElementById('trTable').innerHTML = `<div class="tr-card tr-tablecard"><div class="tr-head"><div><h3>${R.bin === 1 ? 'Daily' : 'Weekly'} values · ${esc(R.span)}</h3><p class="fine">${R.bin === 1 ? 'One row per day' : 'One row per week: averages for scores, totals for counts'}. Newest first. Spend is per ${R.bin === 1 ? 'day' : 'week'}. Today is live and partial; other days are sample history.</p></div></div>
      <div class="tr-tablewrap" tabindex="0" role="region" aria-label="Trend table"><table class="tr-table"><thead><tr><td></td>${groups.map(([g, n]) => `<th scope="colgroup" colspan="${n}" class="grp">${g}</th>`).join('')}<td></td></tr>
      <tr><th scope="col">Date</th>${cols.map(([l]) => `<th scope="col">${l}</th>`).join('')}<th scope="col">Events</th></tr></thead><tbody>${B.slice().reverse().map((b) => `<tr${b.today ? ' class="today"' : ''}><th scope="row">${esc(b.label)}</th>${cols.map(([, k]) => { const v = aggregate(k, b.days); return `<td>${v == null ? '—' : esc(MET[k].fmt(v))}</td>`; }).join('')}<td class="ev">${esc(ev(b))}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  const statsSig = (s) => JSON.stringify(s.metrics) + JSON.stringify(s.events);
  function renderSummary() {
    const R = RANGES[st.range], d = st.summary[st.range], box = document.getElementById('trSummary');
    const head = `<div class="tr-head"><span class="tr-ic">${ico('sparkle', 20)}</span><div><h3>${esc(R.title)}</h3><p class="fine">A short read of Mom’s trend numbers for ${esc(R.span)}.</p></div><button type="button" class="pill small" data-summary aria-label="Refresh the summary">${ico('reset', 14)}<span class="tr-hide-sm">Refresh</span></button></div>`;
    if (!d) { box.innerHTML = head + '<p class="tr-wait"><span class="tr-dots" aria-hidden="true"><i></i><i></i><i></i></span>Reading Mom’s trends…</p>'; return; }
    if (d.error) { box.innerHTML = head + `<p class="empty">Couldn’t write the summary right now (${esc(d.error)}). Tap Refresh to try again.</p>`; return; }
    const stale = st.summarySig[st.range] !== statsSig(buildStats(st.range, false));
    box.innerHTML = head + `<p class="tr-sum-h">${esc(d.headline)}</p>
      <ul class="tr-sum-list">${(d.changes || []).map((c) => `<li class="tone-${esc(c.tone)}"><i aria-hidden="true"></i><span>${esc(c.text)}</span></li>`).join('')}</ul>
      ${(d.stable || []).length ? `<div class="tr-sum-sub"><b>Steady</b><ul>${d.stable.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${(d.next_steps || []).length ? `<div class="tr-sum-next"><b>Next steps</b><ul>${d.next_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      <p class="fine tr-src">${d.source === 'openai' ? 'Written by OpenAI from the trend numbers' : 'Offline summary from simple rules' + (d.source && d.source !== 'rules' ? ' (AI unavailable)' : ' (no AI key)')} · ${fmtT(d.at)} · signals, not a diagnosis${stale ? ' · <b>new data since then: tap Refresh</b>' : ''}</p>`;
  }
  async function loadSummary(force) {
    const range = st.range;
    if (st.summary[range] && !force) return renderSummary();
    st.summary[range] = null; st.loading = true; renderSummary();
    const stats = buildStats(range, true);
    try { const d = await post('api/trend-summary', { stats }); d.at = Date.now(); st.summary[range] = d; st.summarySig[range] = statsSig(buildStats(range, false)); }
    catch (e) { st.summary[range] = { error: e.message }; }
    st.loading = false;
    if (st.range === range) renderSummary();
  }
  const labelOf = (k) => (MET[k] ? MET[k].label : k === 'events' ? 'Marked events' : k === 'today' ? 'Today' : k);
  function renderChat() {
    const R = RANGES[st.range], box = document.getElementById('trMsgs');
    box.innerHTML = `<li class="tr-msg bot"><span>Hi Lisa. I can look through Mom’s ${esc(R.span.replace('the ', ''))}: mental health (memory, mood, sleep), money (scams, card spend) and physical health (walking, balance, pills). What would you like to know?</span></li>`
      + st.turns.map((t) => t.role === 'user' ? `<li class="tr-msg me"><span>${esc(t.text)}</span></li>`
        : `<li class="tr-msg bot${t.covered === false ? ' uncovered' : ''}"><span>${esc(t.text)}</span>${(t.used || []).length ? `<small>Based on: ${esc(t.used.map(labelOf).join(', '))}</small>` : ''}<small>${t.source === 'openai' ? 'OpenAI' : t.source === 'error' ? 'Not answered' : 'Offline rules'}${t.covered === false ? ' · not in the data' : ''}</small></li>`).join('')
      + (st.busy ? '<li class="tr-msg bot typing" aria-label="Thinking"><span><span class="tr-dots"><i></i><i></i><i></i></span></span></li>' : '');
    box.scrollTop = box.scrollHeight;
    document.querySelector('#trAsk button').disabled = st.busy; document.getElementById('trQ').disabled = st.busy;
  }
  async function ask(q) {
    q = String(q || '').trim(); if (!q || st.busy) return;
    const turns = st.turns.slice(-16).map((t) => ({ role: t.role, text: t.text }));   // last 8 turns
    st.turns.push({ role: 'user', text: q }); st.busy = true; renderChat();
    let a;
    try { rebuild(); a = await post('api/chat', { question: q, turns, stats: buildStats(st.range, true), today: todayFacts() }); }
    catch (e) { a = { answer: 'I couldn’t reach the helper just now. Please try again.', used: [], covered: false, source: 'error' }; }
    st.busy = false; st.turns.push({ role: 'assistant', text: a.answer, used: a.used || [], covered: a.covered, source: a.source });
    if (st.turns.length > 40) st.turns = st.turns.slice(-40);
    renderChat(); document.getElementById('trQ').focus({ preventScroll: true });
  }

  if (root) {
    root.innerHTML = `
      <div class="tr-filters" role="toolbar" aria-label="Trend range">${segHtml()}
        <button type="button" class="tr-tablebtn" data-table aria-pressed="false">${ico('receipt', 16)}<span>Table</span></button></div>
      <p class="tr-note">${ico('clock', 16)}<span><b>Past days are sample history</b> until band 39 has stored real days. <b>Today is live</b> from the band, Mom’s conversations and her card, and updates as things happen.</span></p>
      <section class="tr-card tr-summary" aria-live="polite" id="trSummary"></section>
      <section class="tr-card tr-chat" aria-labelledby="trChatH">
        <div class="tr-head"><span class="tr-ic">${ico('chat', 20)}</span><div><h3 id="trChatH">Ask about Mom’s trends</h3><p class="fine">Answers only from these numbers and today’s data, never a diagnosis.</p></div></div>
        <ol class="tr-msgs" id="trMsgs" aria-live="polite"></ol>
        <div class="tr-chips">${['How has her sleep been?', 'Is her walking getting worse?', 'Anything about money I should know?', 'How is her memory?', 'What should I tell Dr. Patel?'].map((q) => `<button type="button" class="tr-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <form class="tr-ask" id="trAsk"><input id="trQ" maxlength="300" placeholder="Ask about Mom’s trends…" autocomplete="off" aria-label="Ask about Mom’s trends" /><button class="pill violet" type="submit">Ask</button></form>
      </section>
      <div id="trCats" class="tr-cats"></div>
      <div id="trTable" hidden></div>`;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-table]'), s = e.target.closest('[data-summary]'), c = e.target.closest('[data-q]');
      if (t) { st.table = !st.table; renderControls(); if (st.table) renderTable(); else renderTarget(document.getElementById('trCats'), true); }
      if (s) loadSummary(true);
      if (c) ask(c.dataset.q);
    });
    document.getElementById('trAsk').addEventListener('submit', (e) => { e.preventDefault(); const q = document.getElementById('trQ').value; document.getElementById('trQ').value = ''; ask(q); });
    if (ro) ro.observe(root);
  }

  try { VC.engine.subscribe(schedule); } catch (_) { /* older engine */ }
  setInterval(schedule, 3000);   // also picks up follower state, card changes, and new [data-trend-cat] containers
  rebuild(); st.sig = JSON.stringify(st.byAgo(0), (k, v) => (k === 'date' ? undefined : v));
  if (root) { renderControls(); renderSummary(); renderChat(); }
  refresh();

  window.VexoTrends = { get history() { return st.hist; }, stats: (r) => buildStats(r || st.range, true), today: todayFacts, ask, refreshSummary: () => loadSummary(true), render: renderEverything, categories: CATS.map((c) => c.id) };
})();
