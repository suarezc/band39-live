// Test scenarios for the seven motion labels in care/web/js/motion-lab.js.
// Each one: what the person does, for how long, and what the label should do.
//   want: 'detect'  the label should fire      want: 'ignore'  a look-alike: the label should stay quiet
//   night: true     the bench tells the lab it is 2 am (sleep and wandering only count at night)
//   sim(SIGNALS)    what the pretend band plays, so the bench itself can be tried with no band.
//                   null = only a person can do this one.
//   expect(r, all)  r = runner.js summary(); all = earlier results by id. Returns { pass, detail }.
// SAFETY: nobody falls for real. Falls are done with the arm only, onto a bed or sofa.

const TAU = 2 * Math.PI;
const noise = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; };

// Extra pretend signals for the look-alikes (rough guesses of what the wrist does).
const EXTRA = {
  clapOnce: () => (s) => (s > 1 && s < 1.04 ? { ax: 3.2, ay: 2.4, az: 1.5, gx: 300 } : { ax: 0.02, ay: 0.01, az: 1 }),
  applause: (hz = 3.5) => { const r = noise(17); return (s) => { const ph = (s * hz) % 1; return ph < 0.12 ? { ax: 2.6 + r(), ay: 1.8, az: 1.4, gx: 320, gy: 150 * r() } : { ax: 0.5 * Math.sin(TAU * hz * s), ay: 0.3 * Math.sin(TAU * hz * s + 1), az: 1 + 0.4 * Math.sin(TAU * hz * s), gx: 200 * Math.sin(TAU * hz * s) }; }; },
  bandDrop: () => (s) => (s < 1 ? { ax: 0.02, ay: 0, az: 1 } : s < 1.25 ? { ax: 0.05, ay: 0.05, az: 0.1 } : s < 1.32 ? { ax: 2.0, ay: 1.5, az: 3.0, gx: 500 } : { ax: 0.0, ay: 0.0, az: 1.0 }),
  toothbrush: (hz = 4.5) => { const r = noise(19); return (s) => ({ ax: 0.15 * Math.sin(TAU * hz * s), ay: 0.05 * r(), az: 1 + 0.05 * r(), gx: 60 * Math.sin(TAU * hz * s) + 3 * r(), gy: 5 * r(), gz: 5 * r() }); },
  wave: (hz = 2.5) => (s) => ({ ax: 0.7 * Math.sin(TAU * hz * s), ay: 0.2, az: 0.8 + 0.3 * Math.sin(TAU * hz * s + 1), gx: 30, gy: 40, gz: 260 * Math.sin(TAU * hz * s) }),
};

const fired = (r, type) => (r.events[type] || 0) > 0;

export const SCENARIOS = [
  // ---- 1. falling ---------------------------------------------------------------------------
  { id: 'fall-arm-drop', feature: 'Falling', want: 'detect', seconds: 10,
    title: 'Arm drops onto a bed and stays there',
    do: ['Stand next to a bed or sofa, band on your wrist, arm raised to shoulder height.',
         'When it turns green: let the arm fall freely onto the cushion, so it lands turned over (palm up).',
         'Leave it completely still until the time is up.'],
    sim: (S) => ({ signal: S.fall(), activity: 'still' }),
    expect: (r) => ({ pass: fired(r, 'fall'), detail: r.fall ? `fall score ${r.fall.score}, impact ${r.fall.impactG} g, free fall ${r.fall.freeFall}, still ${r.fall.still}, turned ${r.fall.turnedDeg}°` : `no fall; peak ${r.peakG} g` }) },
  { id: 'fall-clap-once', feature: 'Falling', want: 'ignore', seconds: 8,
    title: 'One hard clap, then hand in the lap',
    do: ['Sit down. When it turns green: clap once, hard.', 'Then rest the hand in your lap, palm up, and keep still.'],
    sim: () => ({ signal: EXTRA.clapOnce(), activity: 'still' }),
    expect: (r) => ({ pass: !fired(r, 'fall'), detail: fired(r, 'fall') ? `FALSE ALARM: score ${r.fall.score}, impact ${r.fall.impactG} g, turned ${r.fall.turnedDeg}°` : `quiet; peak ${r.peakG} g` }) },
  { id: 'fall-band-dropped', feature: 'Falling', want: 'ignore', seconds: 8,
    title: 'The band is taken off and dropped on a table',
    do: ['Take the band off. Hold it 20 cm above a table (or a book on the table).', 'When it turns green: drop it. Do not touch it again.'],
    sim: () => ({ signal: EXTRA.bandDrop(), activity: 'still' }),
    expect: (r) => ({ pass: !fired(r, 'fall'), detail: fired(r, 'fall') ? `FALSE ALARM: a dropped band counts as a fall (score ${r.fall.score}, impact ${r.fall.impactG} g)` : `quiet; peak ${r.peakG} g` }) },
  { id: 'fall-sit-hard', feature: 'Falling', want: 'ignore', seconds: 8,
    title: 'Sitting down heavily',
    do: ['Stand in front of a sofa or soft chair.', 'When it turns green: drop into the seat, arms landing on your thighs. Then sit still.'],
    sim: null,
    expect: (r) => ({ pass: !fired(r, 'fall'), detail: fired(r, 'fall') ? `FALSE ALARM: score ${r.fall.score}, impact ${r.fall.impactG} g` : `quiet; peak ${r.peakG} g` }) },

  // ---- 2. tremor ----------------------------------------------------------------------------
  { id: 'tremor-rest', feature: 'Tremor', want: 'ignore', seconds: 15,
    title: 'Hand resting on a table',
    do: ['Sit down, forearm and hand resting on a table.', 'Keep still and relaxed until the time is up.'],
    sim: (S) => ({ signal: S.rest(), activity: 'still' }),
    expect: (r) => ({ pass: r.tremor.max === 0, detail: `highest tremor score ${r.tremor.max}/4` }) },
  { id: 'tremor-shake', feature: 'Tremor', want: 'detect', seconds: 20,
    title: 'A small, fast hand tremor (acted)',
    do: ['Sit down, forearm resting on your thigh, hand hanging free.', 'When it turns green: make a small, fast shake of the hand, like shivering (about 5 a second).', 'Keep it small: the arm itself should hardly move.'],
    sim: (S) => ({ signal: S.tremor(45, 5), activity: 'still' }),
    expect: (r) => ({ pass: r.tremor.max >= 1, detail: `highest tremor score ${r.tremor.max}/4` + (r.tremor.hz ? ` at ${r.tremor.hz} Hz` : '') }) },
  { id: 'tremor-toothbrush', feature: 'Tremor', want: 'ignore', seconds: 20,
    title: 'Brushing teeth',
    do: ['Stand up. When it turns green: brush your teeth (or act it out) with the band hand, normal pace.'],
    sim: () => ({ signal: EXTRA.toothbrush(), activity: 'still' }),
    expect: (r) => ({ pass: r.tremor.max === 0, detail: r.tremor.max ? `FALSE ALARM: tremor score ${r.tremor.max}/4 at ${r.tremor.hz} Hz` : 'quiet' }) },
  { id: 'tremor-typing', feature: 'Tremor', want: 'ignore', seconds: 20,
    title: 'Typing on a keyboard',
    do: ['Sit at a keyboard. When it turns green: type normally with both hands.'],
    sim: null,
    expect: (r) => ({ pass: r.tremor.max === 0, detail: r.tremor.max ? `FALSE ALARM: tremor score ${r.tremor.max}/4 at ${r.tremor.hz} Hz` : 'quiet' }) },

  // ---- 3. steps -----------------------------------------------------------------------------
  { id: 'steps-fifty', feature: 'Steps', want: 'detect', seconds: 45,
    title: 'Walk exactly 50 steps',
    do: ['When it turns green: walk at a normal pace and count 50 steps out loud.', 'Then stand still until the time is up.'],
    sim: (S) => ({ signal: S.walk(0), activity: 'walk', cadence: 100, walkSeconds: 30 }),
    expect: (r) => ({ pass: r.steps.counted >= 45 && r.steps.counted <= 55, detail: `band counted ${r.steps.counted} (want 45 to 55)` }) },
  { id: 'steps-shuffle', feature: 'Steps', want: 'detect', seconds: 45,
    title: 'Walk 30 slow, short steps (a shuffle)',
    do: ['When it turns green: walk slowly with short steps, hardly lifting the feet. Count 30 steps.', 'Then stand still.'],
    sim: null,
    expect: (r) => ({ pass: r.steps.counted >= 24 && r.steps.counted <= 36, detail: `band counted ${r.steps.counted} (want 24 to 36)` }) },
  { id: 'steps-arm-wave', feature: 'Steps', want: 'ignore', seconds: 20,
    title: 'Sitting, swinging the arm',
    do: ['Sit down. When it turns green: swing the band arm back and forth as if walking, but stay seated.'],
    sim: null,
    expect: (r) => ({ pass: r.steps.counted <= 3, detail: `band counted ${r.steps.counted} steps while seated` }) },

  // ---- 4. balance ---------------------------------------------------------------------------
  { id: 'balance-normal', feature: 'Balance', want: 'detect', seconds: 30,
    title: 'Walk normally',
    do: ['When it turns green: walk at your normal, even pace in a straight line or a wide loop until the time is up.'],
    sim: (S) => ({ signal: S.walk(0), activity: 'walk', cadence: 108 }),
    expect: (r) => ({ pass: r.balance.score != null && r.balance.score >= 60, detail: r.balance.score == null ? 'no balance score: the band never reported walking' : `balance score ${r.balance.score}/100, regularity ${r.balance.regularity}` }) },
  { id: 'balance-irregular', feature: 'Balance', want: 'detect', seconds: 30,
    title: 'Walk unevenly (do "Walk normally" first)',
    do: ['When it turns green: walk unevenly: change pace, take a long step then two short ones, pause half a second now and then.'],
    sim: (S) => ({ signal: S.walk(1), activity: 'walk', cadence: 96 }),
    expect: (r, all) => {
      const normal = all['balance-normal'] && all['balance-normal'].summary.balance.score;
      if (r.balance.score == null) return { pass: false, detail: 'no balance score: the band never reported walking' };
      if (normal == null) return { pass: false, detail: `score ${r.balance.score}/100; run "Walk normally" first to compare` };
      return { pass: r.balance.score <= normal - 10, detail: `score ${r.balance.score}/100 against ${normal}/100 for normal walking (want at least 10 lower)` };
    } },
  { id: 'balance-stand', feature: 'Balance', want: 'detect', seconds: 20,
    title: 'Stand still, eyes closed',
    do: ['Stand with feet together, arms at your sides, someone next to you.', 'When it turns green: close your eyes and stand as still as you can.'],
    sim: (S) => ({ signal: S.rest(), activity: 'still' }),
    expect: (r) => ({ pass: r.balance.sway != null, detail: r.balance.sway == null ? 'no sway reading' : `sway ${r.balance.sway} g/s (wrist; compare with eyes open by running it twice)` }) },

  // ---- 5. sleep movement (the bench says it is 2 am) ------------------------------------------
  { id: 'sleep-still', feature: 'Sleep movement', want: 'ignore', night: true, seconds: 180,
    title: 'Lying still for three minutes',
    do: ['Lie down or lean back, band arm resting. The bench tells the lab it is 2 am.', 'Keep still for the whole three minutes.'],
    sim: (S) => ({ signal: S.rest(), activity: 'still' }),
    expect: (r) => ({ pass: r.sleep.epochs >= 3 && r.sleep.wakeEpochs === 0, detail: `${r.sleep.wakeEpochs} of ${r.sleep.epochs} half-minutes scored awake` }) },
  { id: 'sleep-restless', feature: 'Sleep movement', want: 'detect', night: true, seconds: 180,
    title: 'Tossing and turning',
    do: ['Lie down or lean back. The bench tells the lab it is 2 am.', 'Every 20 seconds or so: shift position, turn over, pull at a blanket for a few seconds, then lie still again.'],
    sim: (S) => ({ signal: S.restless(), activity: 'still' }),
    expect: (r) => ({ pass: r.sleep.wakeEpochs >= 1, detail: `${r.sleep.wakeEpochs} of ${r.sleep.epochs} half-minutes scored awake (restless ${r.sleep.restless}%)` }) },

  // ---- 6. night wandering ---------------------------------------------------------------------
  { id: 'wander-night', feature: 'Night wandering', want: 'detect', night: true, seconds: 150,
    title: 'Walking for over two minutes at "2 am"',
    do: ['The bench tells the lab it is 2 am.', 'When it turns green: walk around steadily and keep walking until the time is up.'],
    sim: (S) => ({ signal: S.walk(0), activity: 'walk', cadence: 100 }),
    expect: (r) => ({ pass: fired(r, 'wander'), detail: fired(r, 'wander') ? `flagged after about 2 min (${r.wander.minutes} min walked)` : `not flagged; ${r.wander.minutes} min walked, band said "${r.steps.state}"` }) },
  { id: 'wander-bathroom', feature: 'Night wandering', want: 'ignore', night: true, seconds: 75,
    title: 'A one-minute trip at "2 am"',
    do: ['The bench tells the lab it is 2 am.', 'When it turns green: walk for one minute (count 60 seconds), then sit down and stay still.'],
    sim: (S) => ({ signal: S.walk(0), activity: 'walk', cadence: 100, walkSeconds: 60 }),
    expect: (r) => ({ pass: !fired(r, 'wander'), detail: fired(r, 'wander') ? 'FALSE ALARM: a short trip was flagged as wandering' : 'quiet' }) },
  { id: 'wander-day', feature: 'Night wandering', want: 'ignore', seconds: 150,
    title: 'The same two-minute walk in the daytime',
    do: ['When it turns green: walk around steadily until the time is up. (No clock change: it is daytime.)',
         'Run this one between 6 am and 10:30 pm, or it will rightly be flagged.'],
    sim: (S) => ({ signal: S.walk(0), activity: 'walk', cadence: 100 }),
    expect: (r) => ({ pass: !fired(r, 'wander'), detail: fired(r, 'wander') ? 'flagged: is it really night right now?' : 'quiet' }) },

  // ---- 7. seizure-like movement ---------------------------------------------------------------
  { id: 'seizure-shake', feature: 'Seizure-like movement', want: 'detect', seconds: 20,
    title: 'Large rhythmic jerking of the arm (acted)',
    do: ['Sit down. When it turns green: jerk the whole forearm back and forth, large and rhythmic, about 4 a second.', 'Keep going for at least 15 seconds.'],
    sim: (S) => ({ signal: S.seizure(4), activity: 'still' }),
    expect: (r) => ({ pass: fired(r, 'seizure'), detail: fired(r, 'seizure') ? `flagged; longest rhythmic run ${r.seizure.longestRun} s` : `not flagged; longest rhythmic run ${r.seizure.longestRun} s (needs 10)` }) },
  { id: 'seizure-applause', feature: 'Seizure-like movement', want: 'ignore', seconds: 20,
    title: 'Applauding',
    do: ['Sit down. When it turns green: clap as if applauding, steadily, for 15 seconds.'],
    sim: () => ({ signal: EXTRA.applause(), activity: 'still' }),
    expect: (r) => ({ pass: !fired(r, 'seizure'), detail: fired(r, 'seizure') ? `FALSE ALARM: applause flagged (run ${r.seizure.longestRun} s)` : `quiet; longest rhythmic run ${r.seizure.longestRun} s` }) },
  { id: 'seizure-toothbrush', feature: 'Seizure-like movement', want: 'ignore', seconds: 20,
    title: 'Brushing teeth hard',
    do: ['When it turns green: brush your teeth (or act it out) briskly for 15 seconds.'],
    sim: () => ({ signal: EXTRA.toothbrush(4), activity: 'still' }),
    expect: (r) => ({ pass: !fired(r, 'seizure'), detail: fired(r, 'seizure') ? `FALSE ALARM: brushing flagged (run ${r.seizure.longestRun} s)` : `quiet; longest rhythmic run ${r.seizure.longestRun} s` }) },
  { id: 'seizure-wave', feature: 'Seizure-like movement', want: 'ignore', seconds: 20,
    title: 'Waving goodbye',
    do: ['When it turns green: wave with the band hand, big and friendly, for 15 seconds.'],
    sim: () => ({ signal: EXTRA.wave(), activity: 'still' }),
    expect: (r) => ({ pass: !fired(r, 'seizure'), detail: fired(r, 'seizure') ? `FALSE ALARM: waving flagged (run ${r.seizure.longestRun} s)` : `quiet; longest rhythmic run ${r.seizure.longestRun} s` }) },
  { id: 'seizure-jog', feature: 'Seizure-like movement', want: 'ignore', seconds: 20,
    title: 'Jogging on the spot',
    do: ['When it turns green: jog on the spot with your arms pumping, for 15 seconds.'],
    sim: null,
    expect: (r) => ({ pass: !fired(r, 'seizure'), detail: fired(r, 'seizure') ? `FALSE ALARM: jogging flagged (run ${r.seizure.longestRun} s)` : `quiet; longest rhythmic run ${r.seizure.longestRun} s` }) },
];
