/* DOM-free simulation core: plan building + state reduction. Tested in tools/test_engine.cjs */
(function (root) {
  function minutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h < 5 ? h + 24 : h) * 60 + m; // times after midnight belong to the same "day"
  }
  function fmtClock(min) {
    const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
  }
  function beatsFor(ev, mode, stage) {
    if (mode === 'without') return ev.without.beats;
    return ev.beats.filter(b => (!b.only || b.only.includes(stage)) && (!b.skip || !b.skip.includes(stage)));
  }
  function buildPlan(sc, mode, stage) {
    const plan = [];
    sc.events.forEach((ev, i) => {
      plan.push({ kind: 'travel', ev: i });
      beatsFor(ev, mode, stage).forEach((beat, j) => plan.push({ kind: 'beat', ev: i, j, beat }));
      plan.push({ kind: 'done', ev: i });
    });
    plan.push({ kind: 'end' });
    return plan;
  }
  function zeroMetrics(sc) {
    const o = {};
    sc.metrics.forEach(m => (o[m.key] = 0));
    return o;
  }
  function initialState(sc, mode, stage) {
    return {
      mode, stage,
      clock: minutes(sc.start),
      evIdx: -1,
      memory: sc.seedMemory.map(n => ({ ...n, seed: true })),
      feed: [],
      metrics: { with: zeroMetrics(sc), without: zeroMetrics(sc) },
      done: [],
      actions: [],
      ended: false,
    };
  }
  function hasMem(state, id) { return state.memory.some(n => n.id === id); }

  function makeDigest(state, sc) {
    const m = state.metrics.with;
    const names = state.memory.filter(n => n.type === 'person' && !n.seed).map(n => n.label);
    const lines = [
      { cat: 'meds', text: `💊 Meds ${m.meds}/2 taken on time` },
      hasMem(state, 'metoprolol') && { cat: 'appts', text: '🩺 New Rx: metoprolol 25 mg (starts tomorrow)' },
      hasMem(state, 'labtest') && { cat: 'appts', text: '📅 Next: blood test Thu Nov 27' },
      hasMem(state, 'scamcall') && { cat: 'alerts', text: '🛡️ 1 scam call blocked ($0 lost)' },
      names.length && { cat: 'digest', text: `🗣️ Talked with ${names.join(', ')}, and you` },
      hasMem(state, 'walk') && { cat: 'trends', text: '🚶 2,340 steps, walked to Elm St' },
      { cat: 'trends', text: '🌀 Restless ~6:30 PM, settled with tea' },
      hasMem(state, 'lisavisit') && { cat: 'messages', text: '🌷 Looking forward to your Saturday visit' },
    ].filter(Boolean);
    return { cat: 'digest', icon: '📋', title: `Mom’s day · ${sc.date}`, lines };
  }

  // Applies one plan step. Returns a list of {type,...} effects the UI may animate.
  function applyStep(state, step, sc) {
    const fx = [];
    if (step.kind === 'travel') {
      state.evIdx = step.ev;
      state.clock = minutes(sc.events[step.ev].time);
      state.actions = [];
      fx.push({ type: 'travel', ev: step.ev });
    } else if (step.kind === 'beat') {
      const b = step.beat;
      if (b.at) state.clock = minutes(b.at);
      (b.mem || []).forEach(n => {
        const i = state.memory.findIndex(x => x.id === n.id);
        if (i >= 0) state.memory[i] = { ...state.memory[i], quote: n.quote, refreshed: true };
        else { state.memory.push({ ...n }); fx.push({ type: 'mem', id: n.id }); }
      });
      (b.actions || []).forEach(a => state.actions.push(a));
      if (b.family) {
        const base = b.family.dynamic === 'digest' ? makeDigest(state, sc) : { ...b.family };
        const item = { ...base, at: state.clock, ev: step.ev, id: `f${state.feed.length}` };
        state.feed.push(item);
        fx.push({ type: 'feed', item });
      }
    } else if (step.kind === 'done') {
      const ev = sc.events[step.ev];
      for (const side of ['with', 'without']) {
        const d = (ev.impact && ev.impact[side]) || {};
        Object.keys(d).forEach(k => (state.metrics[side][k] += d[k]));
      }
      state.done.push(step.ev);
      fx.push({ type: 'done', ev: step.ev });
    } else if (step.kind === 'end') {
      state.ended = true;
      fx.push({ type: 'end' });
    }
    return fx;
  }

  // Pulls a day-of-week commitment out of a family message ("I'm visiting Saturday").
  function parseFamilyMessage(text) {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tomorrow', 'tonight', 'weekend'];
    const lower = text.toLowerCase();
    const day = days.find(d => lower.includes(d));
    if (!day) return null;
    const label = text.length > 26 ? text.slice(0, 24).trim() + '…' : text;
    return { id: 'msg-' + day + '-' + lower.length, type: 'promise', label: `${label}`, quote: `Lisa: “${text}”`, due: day };
  }

  const API = { minutes, fmtClock, beatsFor, buildPlan, initialState, applyStep, makeDigest, parseFamilyMessage };
  root.VexoEngine = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
