// One scenario run: feeds band data into Amy's motion lab (care/web/js/motion-lab.js) and keeps
// what happened, so a scenario's expect() can judge it. No page code here: the bench page and
// the Node dry run (dry_run.mjs) both use it.
export function startRun(VexoMotion, clock) {
  const lab = VexoMotion.createMotionLab(clock);
  const seen = { events: {}, maxTremor: 0, tremorHz: null, maxSeizureSeconds: 0, samples: 0, peakG: 0 };
  lab.on((type, data) => {
    seen.events[type] = (seen.events[type] || 0) + 1;
    if (type === 'tremor' && data.score > seen.maxTremor) { seen.maxTremor = data.score; seen.tremorHz = data.hz; }
    if (type === 'fall') seen.fallStages = Object.assign({ score: data.score }, data.stages);
  });
  return {
    lab,
    push(m) {
      lab.push(m);
      seen.samples++;
      if (m.ax != null) seen.peakG = Math.max(seen.peakG, Math.hypot(m.ax, m.ay, m.az));
      seen.maxSeizureSeconds = Math.max(seen.maxSeizureSeconds, lab.labels.seizure.seconds);
    },
    activity: (a) => lab.activity(a),
    event: (kind) => lab.event(kind),
    link: (rssi) => lab.link(rssi),
    /** What a scenario's expect() gets. */
    summary() {
      const L = lab.labels;
      return {
        events: seen.events, samples: seen.samples, peakG: Math.round(seen.peakG * 100) / 100,
        fall: seen.fallStages || null,
        tremor: { max: seen.maxTremor, hz: seen.tremorHz, rms: L.tremor.rms, share: L.tremor.share },
        steps: { counted: L.steps.today, cadence: L.steps.cadence, state: L.steps.state },
        balance: { score: L.balance.score, regularity: L.balance.regularity == null ? null : Math.round(L.balance.regularity * 100) / 100,
                   sway: L.balance.sway == null ? null : Math.round(L.balance.sway * 1000) / 1000, walkWindows: L.balance.walkWindows },
        sleep: { epochs: L.sleep.epochs, wakeEpochs: L.sleep.wakeEpochs, restless: L.sleep.restless },
        wander: { episodes: L.wander.episodes, minutes: Math.round(L.wander.minutes * 10) / 10 },
        seizure: { count: L.seizure.count, longestRun: seen.maxSeizureSeconds, hz: L.seizure.hz },
      };
    },
  };
}

/** A clock for the lab. offsetMs shifts "scene" time, so a night-time test can run in the afternoon. */
export function benchClock(offsetMs = 0, now = () => Date.now()) {
  return { real: now, scene: () => now() + offsetMs };
}

/** The offset that makes "now" read as the given hour today (2 = 2 am). */
export function offsetToHour(hour, nowMs = Date.now()) {
  const d = new Date(nowMs);
  d.setHours(hour, 0, 0, 0);
  return d.getTime() - nowMs;
}
