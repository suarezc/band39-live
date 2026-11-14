// node tools/test_live.mjs
// 1) Care-engine rules on a fake clock (fast).  2) The kit's pretend band, end to end:
// events travel through the real Vexo Open protocol into the engine, and the engine's
// light commands reach the band.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { createEngine, atToday } = require('../js/live-engine.js');
const { SCENARIOS } = require('../js/live-scenarios.js');

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

function fakeClock(hhmm) {
  const c = { s: atToday(Date.UTC(2026, 10, 14, 12), hhmm), r: 1e9 };
  return { clock: { scene: () => c.s, real: () => c.r }, adv(min, realSec) { c.s += min * 60000; c.r += (realSec ?? 0) * 1000; } };
}
function eng(hhmm, opts) { const f = fakeClock(hhmm); const e = createEngine(f.clock, opts); e.state.connected = true; return { e, f }; }

console.log('engine');
ok('pill reminder fires, a tap confirms it, light goes green then off', () => {
  const { e, f } = eng('07:55');
  f.adv(6); e.tick();
  assert.equal(e.prompt().kind, 'reminder'); assert.equal(e.led().color, '#ffb020');
  e.ingest({ type: 'tap' });
  assert.equal(e.state.meds['08:00'], 'taken'); assert.equal(e.prompt(), null); assert.equal(e.led().kind, 'good');
  f.adv(1, 5); assert.equal(e.led(), null);
});
ok('missed pills alert after the window', () => {
  const { e, f } = eng('19:58');
  f.adv(3); e.tick(); f.adv(46); e.tick();
  assert.equal(e.state.meds['20:00'], 'missed');
  assert.ok(e.state.alerts.some((a) => a.level === 'warn' && /Evening pills/.test(a.title)));
  assert.equal(e.status().level, 'warn');
});
ok('fall + double-tap within 20 s = OK, no urgent alert', () => {
  const { e, f } = eng('10:40');
  e.ingest({ type: 'free-fall' }); assert.equal(e.prompt().kind, 'fall'); assert.ok(e.wantsRealtime());
  f.adv(0, 5); e.ingest({ type: 'double-tap' });
  assert.equal(e.prompt(), null);
  assert.ok(e.state.alerts.some((a) => a.level === 'good' && /says she is OK/.test(a.title)));
  assert.equal(e.status().level, 'good');
});
ok('fall + silence escalates to urgent, then OK cancels', () => {
  const { e, f } = eng('15:10');
  e.ingest({ type: 'free-fall' }); f.adv(0, 21); e.tick();
  assert.equal(e.prompt().kind, 'help'); assert.equal(e.status().level, 'urgent'); assert.ok(!e.wantsRealtime());
  e.userAction('ok', 'screen');
  assert.equal(e.prompt(), null); assert.equal(e.status().level, 'good');
});
ok('double-tap with nothing on screen = "call me" for Lisa', () => {
  const { e } = eng('11:00');
  e.ingest({ type: 'double-tap' });
  assert.ok(e.state.alerts.some((a) => a.key === 'callme'));
  assert.equal(e.state.messages.at(-1).from, 'Margaret');
});
ok('night walking: gentle prompt, warn once, back to rest resolves', () => {
  const { e, f } = eng('02:38');
  e.ingest({ type: 'activity', state: 'walk', steps: 1200, cadence: 100 });
  assert.equal(e.prompt().kind, 'night'); assert.equal(e.led().brightness, 0.25);
  assert.equal(e.state.alerts.filter((a) => a.key === 'night').length, 1);
  e.ingest({ type: 'activity', state: 'still', steps: 1260, cadence: 0 });
  f.adv(11); e.tick();
  assert.equal(e.prompt(), null);
  assert.ok(e.state.alerts.some((a) => /went back to rest/.test(a.title)));
});
ok('night walking 20+ min escalates', () => {
  const { e, f } = eng('03:00');
  e.ingest({ type: 'activity', state: 'walk', steps: 10, cadence: 100 });
  f.adv(21); e.ingest({ type: 'activity', state: 'walk', steps: 900, cadence: 100 }); e.tick();
  assert.equal(e.status().level, 'urgent');
});
ok('quiet afternoon: check-in, unanswered → warn; answering resets the timer', () => {
  const { e, f } = eng('11:00');
  f.adv(181); e.tick(); assert.equal(e.prompt().kind, 'checkin');
  f.adv(0, 26); e.tick(); assert.equal(e.status().level, 'warn');
  e.userAction('ok', 'screen'); e.tick();
  assert.equal(e.prompt(), null, 'check-in must not reopen right after an answer');
});
ok('band lying still for 2 h = not worn; movement clears it', () => {
  const { e, f } = eng('09:00');
  e.ingest({ type: 'motion-summary', std: 0.0001 }); f.adv(121); e.tick();
  assert.ok(e.state.offWrist); assert.equal(e.prompt().kind, 'notworn');
  e.ingest({ type: 'motion-summary', std: 0.03 });
  assert.ok(!e.state.offWrist); assert.equal(e.prompt(), null);
});
ok('steps since the day began, goal celebration', () => {
  const { e } = eng('13:00');
  e.ingest({ type: 'activity', state: 'walk', steps: 5000, cadence: 110 });
  e.ingest({ type: 'activity', state: 'walk', steps: 8100, cadence: 110 });
  assert.equal(e.state.steps, 3100); assert.ok(e.state.goalHit);
});
ok('low battery once, charging resolves', () => {
  const { e } = eng('20:40');
  e.ingest({ type: 'battery', percent: 18, state: 'battery' });
  e.ingest({ type: 'battery', percent: 17, state: 'battery' });
  assert.equal(e.state.alerts.filter((a) => a.key === 'battery').length, 1);
  e.ingest({ type: 'battery', percent: 18, state: 'charging' });
  assert.ok(e.state.alerts.some((a) => /charging/.test(a.title)));
});
ok('message from Lisa: violet light until read by tap', () => {
  const { e } = eng('09:10');
  e.sendMessage('Visiting Saturday', 'Lisa');
  assert.equal(e.prompt().kind, 'message'); assert.equal(e.led().color, '#8b6cf0');
  e.ingest({ type: 'tap' });
  assert.ok(e.state.messages[0].read); assert.equal(e.prompt(), null);
});
ok('fall outranks a pending reminder', () => {
  const { e, f } = eng('07:59');
  f.adv(2); e.tick(); e.ingest({ type: 'free-fall' });
  assert.equal(e.prompt().kind, 'fall');
});
ok('every scenario step uses a known action', () => {
  const known = ['activity', 'gesture', 'offWrist', 'battery', 'rssi', 'dropLink', 'message', 'reply', 'note'];
  for (const sc of SCENARIOS) for (const st of sc.steps) assert.ok(known.includes(st.do), `${sc.id}: ${st.do}`);
});

// ---- 2) the kit's pretend band, end to end ---------------------------------------------
console.log('kit pretend band → engine');
import { existsSync } from 'node:fs';
const kitPath = ['../../vexo-open-kit', '../../../vexo-open-kit'].map((p) => new URL(p + '/js/src/index.js', import.meta.url)).find((u) => existsSync(u));
if (!kitPath) { console.log('vexo-open-kit not found next to this project (git submodule update --init)'); process.exit(1); }
const kit = await import(kitPath.href);
const BAND = 39;
const sim = new kit.SimTransport(BAND, { autoTap: false });
const band = await kit.Band.connect(BAND, { transport: sim });
const clock = { scene: () => atToday(Date.now(), '10:40'), real: () => Date.now() };
const e = createEngine(clock); e.state.connected = true;
for (const g of ['tap', 'double-tap', 'free-fall']) band.on(g, () => e.ingest({ type: g }));
band.on('activity', (a) => e.ingest({ type: 'activity', state: a.state, steps: a.steps, cadence: a.cadence }));
band.on('battery', (b) => e.ingest({ type: 'battery', percent: b.percent, state: b.state }));
await band.configure({ events: true, activity: true, battery: true, motion: 10 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ok(`connected to ${band.name}`, () => assert.equal(band.name, 'Vexo-HACK-39'));
sim.setActivity('walk', { steps: 2000 });
await wait(2300);
ok('activity frames arrive through the protocol', () => { assert.equal(e.state.activity, 'walk'); assert.ok(e.state.stepsTotal >= 2000); });
sim.tap('free-fall'); await wait(150);
ok('free-fall from the band opens the fall check', () => assert.equal(e.prompt().kind, 'fall'));
const want = e.led();
await band.setLed(want.color, { brightness: want.brightness, pattern: want.pattern, period: want.period });
ok('engine light command lands on the band', () => { const l = sim.led; assert.equal(typeof l.pattern === 'number' ? kit.LED_PATTERNS[l.pattern] : l.pattern, 'blink'); assert.ok(l.r > 200 && l.g < 80); });
sim.tap('double-tap'); await wait(150);
ok('double-tap on the band answers “I’m OK”', () => { assert.equal(e.prompt(), null); assert.equal(e.status().level, 'good'); });
sim.setBattery(15); await wait(300);
ok('low battery from the band reaches Lisa', () => assert.ok(e.state.alerts.some((a) => a.key === 'battery')));
await band.disconnect();

console.log(`\n${pass} checks passed`);
process.exit(0);
