// Try every scenario that has a pretend signal, with no band and no waiting: made-up motion goes
// through the same runner and the same expect() as the bench page.
//   node experiments/bench/dry_run.mjs
// It shows that the bench works, and what the lab does with ROUGH GUESSES of each movement.
// A "ignore" scenario that fails here is a prediction to check on the real band, not a result.
import { createRequire } from 'node:module';
import { SCENARIOS } from './scenarios.js';
import { startRun, offsetToHour } from './runner.js';

const VexoMotion = createRequire(import.meta.url)('../../care/web/js/motion-lab.js');
const all = {};
let broken = 0;
for (const scn of SCENARIOS) {
  if (!scn.sim) { console.log(`-      ${scn.feature.padEnd(22)} ${scn.title}  (needs a person)`); continue; }
  const start = new Date(); start.setHours(14, 0, 0, 0);            // a fixed afternoon, so day/night is stable
  let now = start.getTime();
  const offset = scn.night ? offsetToHour(2, now) : 0;
  const run = startRun(VexoMotion, { real: () => now, scene: () => now + offset });
  const sim = scn.sim(VexoMotion.SIGNALS);
  let steps = 1000, carry = 0;
  for (let i = 0; i < scn.seconds * 50; i++) {
    const s = i / 50;
    now = start.getTime() + s * 1000;
    const walking = sim.activity === 'walk' && (sim.walkSeconds == null || s < sim.walkSeconds);
    if (i % 50 === 0) {
      if (walking) { carry += (sim.cadence || 100) / 60; steps += Math.floor(carry); carry -= Math.floor(carry); }
      run.activity({ steps, cadence: walking ? sim.cadence || 100 : 0, state: walking ? 'walk' : 'still' });
    }
    const m = walking || sim.activity !== 'walk' ? sim.signal(s) : { ax: 0, ay: 0, az: 1 };
    run.push({ t: s * 1000, ax: m.ax || 0, ay: m.ay || 0, az: m.az == null ? 1 : m.az, gx: m.gx || 0, gy: m.gy || 0, gz: m.gz || 0 });
  }
  const summary = run.summary();
  const verdict = scn.expect(summary, all);
  all[scn.id] = { summary, verdict };
  if (!verdict.pass && scn.want === 'detect') broken++;
  console.log(`${verdict.pass ? 'pass  ' : 'FAIL  '} ${scn.feature.padEnd(22)} ${scn.title}  [${scn.want}]  ${verdict.detail}`);
}
console.log(broken ? `\n${broken} "detect" scenario(s) failed on the lab's own made-up signals: the bench or the lab is off.` : '\nEvery "detect" scenario fires on made-up signals. "ignore" failures above are predictions to check on the real band.');
process.exit(broken ? 1 : 0);
