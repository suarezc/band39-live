// node tools/test_engine.cjs : walks the whole day in every mode × stage and checks outcomes.
const assert = require('assert');
const sc = require('../js/scenario.js');
const E = require('../js/engine.js');

const anchors = new Set(['cube', 'bracelet', 'phone', 'cloud', 'cal', 'mail', 'notion', 'sms', 'family']);
const speakers = new Set(Object.keys(sc.speakers));
let checks = 0;

for (const mode of ['with', 'without']) {
  for (const stage of Object.keys(sc.stages)) {
    const plan = E.buildPlan(sc, mode, stage);
    const st = E.initialState(sc, mode, stage);
    let lastClock = st.clock;
    for (const step of plan) {
      if (step.kind === 'beat') {
        const b = step.beat;
        if (b.say) { assert(speakers.has(b.say[0]), `unknown speaker ${b.say[0]}`); assert(b.say[1].length > 3); }
        (b.flows || []).forEach(f => { assert(anchors.has(f.from) && anchors.has(f.to), `bad anchor ${f.from}->${f.to}`); assert(f.payload); });
        if (b.haptic) assert([1, 2, 3].includes(b.haptic));
        if (b.level) assert(/^L[0-4]$/.test(b.level));
        if (mode === 'without') assert(!b.flows && !b.haptic, 'without-mode beats must not use Vexo');
      }
      E.applyStep(st, step, sc);
      assert(st.clock >= lastClock, `clock went backwards at ${JSON.stringify(step.kind)} ev ${step.ev}`);
      lastClock = st.clock;
      checks++;
    }
    assert(st.ended);
    assert.strictEqual(st.done.length, sc.events.length);
    // both columns are always filled for the comparison panel
    assert.deepStrictEqual(st.metrics.with, { meds: 2, instr: 3, lost: 0, calls: 0, alone: 0, family: 6 });
    assert.deepStrictEqual(st.metrics.without, { meds: 0, instr: 1, lost: 2000, calls: 2, alone: 4, family: 0 });
    if (mode === 'with') {
      const digest = st.feed.find(f => f.cat === 'digest');
      assert(digest && digest.lines.length >= 6, 'digest built');
      assert(digest.lines.some(l => l.text.includes('2/2')), 'digest sees both doses');
      assert(st.memory.some(n => n.id === 'patel') && st.memory.some(n => n.id === 'lisavisit'));
      const extra = { mci: 0, mild: 0, moderate: 3 }[stage];
      assert.strictEqual(st.feed.filter(f => ['location', 'trends'].includes(f.cat)).length, extra, `stage-specific family items for ${stage}`);
    } else {
      assert.strictEqual(st.feed.length, 2, 'without: only the worried-call entries');
      assert.strictEqual(st.memory.length, sc.seedMemory.length);
    }
    console.log(`ok  ${mode.padEnd(7)} ${stage.padEnd(8)} steps=${plan.length} feed=${st.feed.length} memory=${st.memory.length}`);
  }
}
// stage variants really differ
const len = s => E.buildPlan(sc, 'with', s).length;
assert(len('mci') < len('mild') && len('mild') < len('moderate'));
assert.strictEqual(E.fmtClock(E.minutes('02:40')), '2:40 AM');
assert.strictEqual(E.fmtClock(E.minutes('12:30')), '12:30 PM');
assert.strictEqual(E.parseFamilyMessage('I’m visiting Saturday').due, 'saturday');
assert.strictEqual(E.parseFamilyMessage('love you'), null);
console.log(`all engine checks passed (${checks} steps applied)`);
