// node tools/test_motion.mjs — each label fires on its synthetic signal and stays quiet on the others.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { createMotionLab, SIGNALS } = require('../web/js/motion-lab.js');
let pass = 0; const ok = (n, f) => { f(); pass++; console.log('  ✓', n); };

function run(signal, seconds, { hh = 14, activity, opts } = {}) {
  const t0 = new Date(2026, 10, 14, hh, 0, 0).getTime();
  const c = { now: 0 };
  const clock = { scene: () => t0 + c.now, real: () => t0 + c.now };
  const lab = createMotionLab(clock, opts);
  const events = [];
  lab.on((type, data) => events.push({ type, data: JSON.parse(JSON.stringify(data)) }));
  if (activity) lab.activity(activity);
  const f = signal;
  for (let i = 0; i < seconds * 50; i++) {
    c.now = i * 20;
    lab.push(Object.assign({ t: t0 + c.now }, f(i / 50)));
    if (activity && i % 50 === 0) lab.activity(activity);
  }
  return { lab, events, types: events.map((e) => e.type) };
}

ok('rest: no fall, no tremor, no seizure', () => {
  const r = run(SIGNALS.rest(), 20);
  assert.ok(!r.types.includes('fall')); assert.equal(r.lab.labels.tremor.score, 0); assert.ok(!r.types.includes('seizure'));
});
ok('tremor 5 Hz, 45 °/s → score 3, ~5 Hz', () => {
  const r = run(SIGNALS.tremor(45, 5), 12);
  assert.equal(r.lab.labels.tremor.score, 3); assert.ok(Math.abs(r.lab.labels.tremor.hz - 5) < 0.6, 'hz ' + r.lab.labels.tremor.hz);
});
ok('mild tremor 8 °/s → score 1; strong 120 °/s → 4', () => {
  assert.equal(run(SIGNALS.tremor(8, 4.5), 12).lab.labels.tremor.score, 1);
  assert.equal(run(SIGNALS.tremor(120, 6), 12).lab.labels.tremor.score, 4);
});
ok('fall: free-fall + impact + lying still → fall label', () => {
  const sig = SIGNALS.fall();
  const r = run((s) => (s < 2 ? SIGNALS.rest()(s) : sig(s - 2)), 8, { opts: { fall: {} } });
  const f = r.events.find((e) => e.type === 'fall');
  assert.ok(f, 'fall fired'); assert.ok(f.data.score >= 85, 'score ' + f.data.score);
});
ok('seizure-like 4 Hz large rhythmic ≥10 s → alert; 6 s → none', () => {
  const r = run(SIGNALS.seizure(4), 16);
  assert.ok(r.types.includes('seizure'));
  const short = run((s) => (s < 6 ? SIGNALS.seizure(4)(s) : SIGNALS.rest()(s)), 14);
  assert.ok(!short.types.includes('seizure'));
});
ok('seizure-like does not count as tremor', () => {
  const r = run(SIGNALS.seizure(4), 16); assert.equal(r.lab.labels.tremor.score, 0);
});
ok('balance: steady walk scores higher than an unsteady walk', () => {
  const a = { state: 'walk', cadence: 108, steps: 1000 };
  const steady = run(SIGNALS.walk(0), 30, { activity: a }).lab.labels.balance.score;
  const shaky = run(SIGNALS.walk(1), 30, { activity: a }).lab.labels.balance.score;
  assert.ok(steady > shaky + 10, `steady ${steady} vs unsteady ${shaky}`);
});
ok('walking is not tremor or seizure', () => {
  const r = run(SIGNALS.walk(0), 20, { activity: { state: 'walk', cadence: 108, steps: 10 } });
  assert.equal(r.lab.labels.tremor.score, 0); assert.ok(!r.types.includes('seizure'));
});
ok('sleep: still night = asleep, restless night = more wake epochs', () => {
  const calm = run(SIGNALS.rest(), 6 * 60, { hh: 2 }).lab.labels.sleep;
  const rest = run(SIGNALS.restless(), 6 * 60, { hh: 2 }).lab.labels.sleep;
  assert.equal(calm.restless, 0); assert.ok(rest.restless > calm.restless, `restless ${rest.restless}`);
});
ok('night wandering: walking at 2 am ≥ 2 min → episode; daytime walk → none', () => {
  const a = { state: 'walk', cadence: 100, steps: 50 };
  assert.ok(run(SIGNALS.walk(0), 150, { hh: 2, activity: a }).types.includes('wander'));
  assert.ok(!run(SIGNALS.walk(0), 150, { hh: 14, activity: a }).types.includes('wander'));
});
ok('walking and seizure exclude each other: band says walk + seizure shaking → seizure, steps discarded', () => {
  const t0 = new Date(2026, 10, 14, 14).getTime(); const c = { now: 0 };
  const lab = createMotionLab({ scene: () => t0 + c.now, real: () => t0 + c.now }); const ev = [];
  lab.on((type) => ev.push(type));
  const sig = SIGNALS.seizure(4); let steps = 2000;
  for (let i = 0; i < 16 * 50; i++) { c.now = i * 20; lab.push(Object.assign({ t: t0 + c.now }, sig(i / 50))); if (i % 50 === 0) { steps += 3; lab.activity({ state: 'walk', cadence: 180, steps }); } }
  assert.ok(ev.includes('seizure'), 'seizure despite the band saying walk');
  assert.notEqual(lab.labels.steps.state, 'walk'); assert.ok(lab.labels.steps.discarded > 0, 'steps during the episode discarded');
});
ok('steps since the day began', () => {
  const t0 = Date.now(); const lab = createMotionLab({ scene: () => t0, real: () => t0 });
  lab.activity({ steps: 5000, cadence: 0, state: 'still' }); lab.activity({ steps: 5420, cadence: 105, state: 'walk' });
  assert.equal(lab.labels.steps.today, 420);
});
console.log(`\n${pass} motion checks passed`);
