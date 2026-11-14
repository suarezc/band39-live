/* Band 39 · motion lab (DOM-free).
 * Turns the band's raw motion (ax ay az in g, gx gy gz in °/s, ~50 Hz) plus its own events and
 * activity into seven labels: falling, tremor ("Parkinson shaking") score, steps, balance, sleep
 * movement, nighttime wandering, seizure-like movement.
 * Methods and sources: research/vexo-motion-algorithms/README.md (Bourke 2007, Kangas 2008,
 * Salarian 2007, Moe-Nilssen 2004, Hausdorff 2001/2005, Mancini 2012, Cole 1992, Sadeh 1994,
 * Beniczky 2013, Kramer 2011). Thresholds marked "design" are guesses to tune on real wearers.
 * Signals worth a look, not diagnoses.
 */
(function (root) {
  'use strict';

  const DEF = {
    rate: 50,
    fall: { freeFallG: 0.6, freeFallMs: 60, impactG: 2.5, impactAloneG: 3.5, windowMs: 2500, stillStd: 0.08, orientDeg: 45 },
    tremor: { winS: 5, lo: 3.5, hi: 7.5, ratio: 0.45, bins: [5, 15, 40, 100] },        // Salarian band; bins = design
    seizure: { winS: 2, lo: 2, hi: 7, ratio: 0.4, stdG: 0.6, gyroRms: 150, sustainS: 10 }, // Beniczky/Kramer-style; amplitudes = design
    balance: { winS: 8 },
    sleep: { epochS: 30, nightStartH: 22.5, nightEndH: 6, deadband: 0.02, scale: 4 },
    wander: { minMin: 2, escalateMin: 20, farRssi: -85 },
    stepGoal: 3000,
  };

  const mag = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) * (v - m)))); };
  const hour = (ms) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };

  /** Power spectrum by direct DFT at `step` Hz from lo to hi. Returns [{f, p}]. */
  function spectrum(x, rate, lo, hi, step) {
    const n = x.length; const m = mean(x); const out = [];
    for (let f = lo; f <= hi + 1e-9; f += step) {
      let re = 0, im = 0; const w = 2 * Math.PI * f / rate;
      for (let i = 0; i < n; i++) { const v = x[i] - m; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
      out.push({ f: Math.round(f * 100) / 100, p: (re * re + im * im) / (n * n) });
    }
    return out;
  }
  /** Of three axes, the one with most power in [lo, hi]; its peak frequency, band share and RMS in band. */
  function bandAnalysis(axes, rate, lo, hi, fullLo, fullHi) {
    const n = axes[0].length; const step = rate / n < 0.2 ? 0.2 : rate / n;
    let best = null;
    for (const x of axes) {
      const sp = spectrum(x, rate, fullLo, fullHi, step);
      const total = sp.reduce((s, b) => s + b.p, 0) || 1e-12;
      const band = sp.filter((b) => b.f >= lo && b.f <= hi);
      const bp = band.reduce((s, b) => s + b.p, 0);
      const peak = sp.reduce((a, b) => (b.p > a.p ? b : a), sp[0]);
      // amplitude of a sinusoid with DFT power p (normalised by n²) is 2·sqrt(p); RMS = amp/√2
      const rms = Math.sqrt(band.reduce((s, b) => s + 2 * b.p, 0));
      if (!best || bp > best.bp) best = { bp, share: bp / total, peakF: peak.f, peakInBand: peak.f >= lo && peak.f <= hi, rms };
    }
    return best;
  }
  /** Unbiased autocorrelation of x at lags in samples [a, b]; returns the max and its lag. */
  function autocorrMax(x, a, b) {
    const n = x.length; const m = mean(x); const d = x.map((v) => v - m);
    const v0 = d.reduce((s, v) => s + v * v, 0) / n || 1e-12;
    let best = { r: -1, lag: a };
    for (let k = a; k <= b && k < n - 1; k++) {
      let s = 0; for (let i = 0; i + k < n; i++) s += d[i] * d[i + k];
      const r = (s / (n - k)) / v0;
      if (r > best.r) best = { r, lag: k };
    }
    return best;
  }

  function createMotionLab(clock, opts) {
    const C = JSON.parse(JSON.stringify(DEF));
    if (opts) for (const k of Object.keys(opts)) C[k] = typeof opts[k] === 'object' ? Object.assign(C[k] || {}, opts[k]) : opts[k];
    const subs = new Set();
    const buf = [];                                   // recent samples
    const keep = C.rate * 12;
    let sinceHop = 0;

    const L = {
      fall: { score: 0, at: null, stages: null, count: 0 },
      tremor: { score: 0, hz: null, rms: 0, share: 0, minutesToday: 0, at: null },
      steps: { today: 0, cadence: 0, state: 'unknown', goal: C.stepGoal, base: null, total: null, discarded: 0 },
      balance: { score: null, regularity: null, sway: null, at: null, walkWindows: 0 },
      sleep: { asleep: null, restless: 0, wakeEpochs: 0, epochs: 0, movement: 0, at: null },
      wander: { active: false, since: null, episodes: 0, minutes: 0, far: false },
      seizure: { active: false, seconds: 0, hz: null, at: null, count: 0 },
    };
    const fs = { ffStart: null, ffSeen: null, impact: null, gBefore: null, pendingCheck: null };
    let seizureRun = 0, seizureSteps = null;
    const epochCounts = []; let epochAcc = 0, epochStart = null;
    let rssi = null;

    function emit(type, data) { for (const fn of subs) { try { fn(type, data, L); } catch (e) { console.error(e); } } }

    // ---- per sample ----------------------------------------------------------
    function push(s) {
      if (s.ax == null) return;
      const a = mag(s.ax, s.ay, s.az);
      const t = s.t != null ? s.t : clock.real();
      buf.push({ t, ax: s.ax, ay: s.ay, az: s.az, gx: s.gx || 0, gy: s.gy || 0, gz: s.gz || 0, a });
      if (buf.length > keep) buf.shift();
      fallSample(t, a);
      epochSample(a);
      if (++sinceHop >= C.rate) { sinceHop = 0; hop(); }
    }

    // ---- 1. falling: free-fall → impact → still / turned (Bourke 2007, Kangas 2008) --------
    function gravityAround(fromT, toT) {
      const w = buf.filter((b) => b.t >= fromT && b.t <= toT); if (!w.length) return null;
      const g = [mean(w.map((b) => b.ax)), mean(w.map((b) => b.ay)), mean(w.map((b) => b.az))];
      const m = mag(g[0], g[1], g[2]) || 1; return g.map((v) => v / m);
    }
    function fallSample(t, a) {
      const F = C.fall;
      if (a < F.freeFallG) { if (fs.ffStart === null) fs.ffStart = t; if (t - fs.ffStart >= F.freeFallMs && !fs.ffSeen) { fs.ffSeen = t; fs.gBefore = gravityAround(t - 1500, fs.ffStart - 50); } }
      else fs.ffStart = null;
      if (a > F.impactG && !fs.impact && (fs.ffSeen && t - fs.ffSeen < 1000 || a > F.impactAloneG)) {
        fs.impact = { t, g: a };
        if (!fs.gBefore) fs.gBefore = gravityAround(t - 1500, t - 300);
        fs.pendingCheck = t + 3000;                 // 1 s settle + 2 s stillness window
      }
      if (fs.pendingCheck && t >= fs.pendingCheck) { judgeFall(t); }
      if (fs.ffSeen && !fs.impact && t - fs.ffSeen > C.fall.windowMs) { fs.ffSeen = null; fs.gBefore = null; }
    }
    function judgeFall(t) {
      const after = buf.filter((b) => b.t >= fs.impact.t + 1000 && b.t <= fs.impact.t + 3000).map((b) => b.a);
      const still = after.length > 10 && std(after) < C.fall.stillStd;
      const gAfter = gravityAround(fs.impact.t + 1000, fs.impact.t + 3000);
      let turned = false, deg = 0;
      if (fs.gBefore && gAfter) { const dot = fs.gBefore[0] * gAfter[0] + fs.gBefore[1] * gAfter[1] + fs.gBefore[2] * gAfter[2]; deg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI; turned = deg > C.fall.orientDeg; }
      const stages = { freeFall: !!fs.ffSeen, impact: true, impactG: Math.round(fs.impact.g * 10) / 10, still, turnedDeg: Math.round(deg) };
      const score = (stages.freeFall ? 30 : 0) + 40 + (still ? 15 : 0) + (turned ? 15 : 0);
      fs.ffSeen = fs.impact = fs.pendingCheck = fs.gBefore = null;
      if (score >= 70) {
        Object.assign(L.fall, { score, at: clock.scene(), stages }); L.fall.count++;
        emit('fall', L.fall);
      }
    }
    function bandFreeFall() {                      // the band's own free-fall event (0.35 g for 100 ms)
      if (!fs.ffSeen) { const t = buf.length ? buf[buf.length - 1].t : clock.real(); fs.ffSeen = t; fs.gBefore = gravityAround(t - 1500, t - 100); }
    }

    // ---- every second: tremor, seizure, balance ---------------------------------------------
    // Walking and a seizure can't happen together. While seizure-like shaking runs, she is not walking
    // (a step counter can mistake rhythmic jerking for steps): those steps are discarded below.
    const bandWalking = () => L.steps.state === 'walk' || L.steps.state === 'run' || L.steps.cadence > 40;
    const isWalking = () => bandWalking() && seizureRun === 0;
    function hop() {
      const now = clock.scene();
      // 7. seizure-like: rhythmic 2-7 Hz, large, sustained ≥ 10 s
      const S = C.seizure; const sw = buf.slice(-S.winS * C.rate);
      if (sw.length >= S.winS * C.rate * 0.9) {
        const amp = std(sw.map((b) => b.a));
        const gyroRms = Math.sqrt(mean(sw.map((b) => b.gx * b.gx + b.gy * b.gy + b.gz * b.gz)));
        const ba = bandAnalysis([sw.map((b) => b.ax), sw.map((b) => b.ay), sw.map((b) => b.az)], C.rate, S.lo, S.hi, 0.5, 12);
        const big = amp > S.stdG || gyroRms > S.gyroRms;
        const rhythmic = ba.share > S.ratio && ba.peakInBand;
        const gaitLike = ba.peakF >= 1.2 && ba.peakF <= 2.5 && amp < S.stdG;     // ordinary steps: ~1.5-2 Hz, moderate
        const realWalk = bandWalking() && gaitLike;
        if (big && rhythmic && !realWalk) { if (seizureRun === 0) seizureSteps = L.steps.total; seizureRun++; }
        else seizureRun = 0;
        const wasActive = L.seizure.active;
        L.seizure.seconds = seizureRun; L.seizure.hz = rhythmic ? ba.peakF : null;
        if (seizureRun >= S.sustainS && !wasActive) { Object.assign(L.seizure, { active: true, at: now }); L.seizure.count++; emit('seizure', L.seizure); }
        if (seizureRun === 0 && wasActive) { L.seizure.active = false; emit('seizure-end', L.seizure); }
      }
      const walking = isWalking();
      // 2. tremor: 3.5-7.5 Hz on the gyro axis with most band power (Salarian 2007)
      const T = C.tremor; const tw = buf.slice(-T.winS * C.rate);
      const gross = tw.length ? std(tw.map((b) => b.a)) : 0;        // rest tremor is small: big rhythmic motion is not tremor
      if (tw.length >= T.winS * C.rate * 0.9 && !L.seizure.active && seizureRun === 0 && gross < 0.3) {
        const hasGyro = tw.some((b) => b.gx || b.gy || b.gz);
        const axes = hasGyro ? [tw.map((b) => b.gx), tw.map((b) => b.gy), tw.map((b) => b.gz)]
                             : [tw.map((b) => b.ax * 300), tw.map((b) => b.ay * 300), tw.map((b) => b.az * 300)];
        const ba = bandAnalysis(axes, C.rate, T.lo, T.hi, 1, 15);
        const present = ba.share > T.ratio && ba.peakInBand && !walking;
        const score = present ? Math.max(1, Math.min(4, T.bins.filter((b) => ba.rms >= b).length)) : 0;   // 0-4, not MDS-UPDRS
        const prev = L.tremor.score;
        Object.assign(L.tremor, { score, hz: present ? ba.peakF : null, rms: Math.round(ba.rms * 10) / 10, share: Math.round(ba.share * 100) / 100 });
        if (present) { L.tremor.minutesToday += 1 / 60; L.tremor.at = now; }
        if (score !== prev) emit('tremor', L.tremor);
      }
      // 4. balance: gait regularity while walking (Moe-Nilssen 2004), sway jerk while standing (Mancini 2012)
      const B = C.balance; const bw = buf.slice(-B.winS * C.rate);
      if (bw.length >= B.winS * C.rate * 0.9) {
        if (walking) {
          const x = bw.map((b) => b.a);
          const step = autocorrMax(x, Math.round(0.25 * C.rate), Math.round(0.75 * C.rate));
          const stride = autocorrMax(x, Math.round(0.6 * C.rate), Math.round(1.4 * C.rate));
          const reg = Math.max(0, Math.min(1, Math.max(step.r, stride.r)));
          L.balance.regularity = L.balance.regularity == null ? reg : 0.7 * L.balance.regularity + 0.3 * reg;
          L.balance.walkWindows++;
        } else if (std(bw.map((b) => b.a)) < 0.05) {
          const jerk = []; for (let i = 1; i < bw.length; i++) jerk.push(mag(bw[i].ax - bw[i - 1].ax, bw[i].ay - bw[i - 1].ay, bw[i].az - bw[i - 1].az) * C.rate);
          const j = Math.sqrt(mean(jerk.map((v) => v * v)));       // g/s
          L.balance.sway = L.balance.sway == null ? j : 0.8 * L.balance.sway + 0.2 * j;
        }
        if (L.balance.regularity != null) {
          const swayN = L.balance.sway == null ? 0.3 : Math.min(1, L.balance.sway / 1.5);
          const score = Math.round(100 * (0.7 * L.balance.regularity + 0.3 * (1 - swayN)));
          const prev = L.balance.score; L.balance.score = score; L.balance.at = now;
          if (prev == null || Math.abs(prev - score) >= 3) emit('balance', L.balance);
        }
      }
      wanderCheck(now);
    }

    // ---- 5. sleep movement: 30 s epochs, Cole-Kripke weights (Cole 1992) ---------------------
    function isNight(ms) { if (C.forceNight === true) return true; if (C.forceNight === false) return false; const h = hour(ms); return h >= C.sleep.nightStartH || h < C.sleep.nightEndH; }
    function epochSample(a) {
      const now = clock.scene();
      if (epochStart === null) epochStart = now;
      epochAcc += Math.max(0, Math.abs(a - 1) - C.sleep.deadband);
      if (now - epochStart >= C.sleep.epochS * 1000) {
        const count = epochAcc * C.sleep.scale; epochCounts.push(count); if (epochCounts.length > 240) epochCounts.shift();
        epochAcc = 0; epochStart = now;
        if (isNight(now)) scoreEpoch(now);
      }
    }
    function scoreEpoch(now) {
      const n = epochCounts.length; if (n < 3) return;
      const A = (k) => epochCounts[n - 3 + k] ?? 0;                      // score the epoch 2 back (needs 2 after it)
      const P = 0.001 * (106 * A(-4) + 54 * A(-3) + 58 * A(-2) + 76 * A(-1) + 230 * A(0) + 74 * A(1) + 67 * A(2));
      const awake = P >= 1;
      L.sleep.epochs++; if (awake) L.sleep.wakeEpochs++;
      L.sleep.asleep = !awake; L.sleep.movement = Math.round(A(0));
      L.sleep.restless = Math.round(100 * L.sleep.wakeEpochs / L.sleep.epochs);
      L.sleep.at = now;
      emit('sleep', L.sleep);
    }

    // ---- 6. nighttime wandering: night + awake + walking ≥ 2 min (rule-based, design) --------
    function wanderCheck(now) {
      const walking = isWalking();
      const W = C.wander; const far = rssi != null && rssi < W.farRssi;
      if (isNight(now) && walking) {
        if (!L.wander.since) L.wander.since = now;
        L.wander.minutes = (now - L.wander.since) / 60000; L.wander.far = far;
        if (!L.wander.active && L.wander.minutes >= W.minMin) { L.wander.active = true; L.wander.episodes++; emit('wander', L.wander); }
        else if (L.wander.active && (far || L.wander.minutes >= W.escalateMin) && !L.wander.escalated) { L.wander.escalated = true; emit('wander-escalate', L.wander); }
      } else if (L.wander.since && !walking) {
        const was = L.wander.active; Object.assign(L.wander, { active: false, since: null, escalated: false });
        if (was) emit('wander-end', L.wander);
      }
    }

    // ---- 3. steps: the band's own counter + cadence -----------------------------------------
    function activity(e) {
      if (typeof e.steps === 'number') {
        if (L.steps.base == null || e.steps < L.steps.base) L.steps.base = e.steps;
        if (seizureRun > 0 && L.steps.total != null && e.steps > L.steps.total) { L.steps.base += e.steps - L.steps.total; L.steps.discarded += e.steps - L.steps.total; }
        L.steps.total = e.steps; L.steps.today = e.steps - L.steps.base;
      }
      L.steps.cadence = seizureRun > 0 ? 0 : (e.cadence || 0);
      L.steps.state = seizureRun > 0 ? 'still' : (e.state || L.steps.state);
      emit('steps', L.steps);
    }
    function event(kind) { if (kind === 'free-fall') bandFreeFall(); }
    function link(v) { rssi = v; }
    function resetDay() { L.steps.base = null; L.steps.today = 0; L.tremor.minutesToday = 0; Object.assign(L.sleep, { wakeEpochs: 0, epochs: 0, restless: 0 }); }

    return { push, activity, event, link, resetDay, labels: L, cfg: C, on: (fn) => { subs.add(fn); return () => subs.delete(fn); }, _buf: buf };
  }

  // ---- synthetic signals for demos and tests (also played on the kit's pretend band) ---------
  // Each returns a function of seconds → { ax, ay, az, gx, gy, gz }, as SimTransport.playMotion takes.
  const rnd = (seed) => { let s = seed || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; };
  const SIGNALS = {
    rest: () => { const r = rnd(3); return () => ({ ax: 0.01 * r(), ay: 0.01 * r(), az: 1 + 0.01 * r(), gx: r(), gy: r(), gz: r() }); },
    tremor: (amp = 45, hz = 5) => { const r = rnd(5); return (s) => ({ ax: 0.04 * Math.sin(2 * Math.PI * hz * s) + 0.005 * r(), ay: 0.01 * r(), az: 1 + 0.01 * r(), gx: amp * Math.sqrt(2) * Math.sin(2 * Math.PI * hz * s) + 2 * r(), gy: 3 * r(), gz: 3 * r() }); },
    walk: (irregular = 0) => { const r = rnd(7); let ph = 0, last = 0; return (s) => { const dt = s - last; last = s; ph += 2 * Math.PI * 1.8 * dt * (1 + irregular * 0.9 * r()); return { ax: 0.25 * Math.sin(ph / 2) + irregular * 0.25 * r(), ay: 0.1 * Math.cos(ph) + irregular * 0.15 * r(), az: 1 + 0.3 * Math.sin(ph) + irregular * 0.3 * r(), gx: 60 * Math.sin(ph / 2), gy: 20 * r(), gz: 30 * Math.cos(ph / 2) }; }; },
    fall: () => (s) => (s < 0.6 ? { ax: 0.02, ay: 0, az: 1 } : s < 0.85 ? { ax: 0.1, ay: 0.1, az: 0.2 } : s < 0.95 ? { ax: 2.4, ay: 1.8, az: 2.2, gx: 400, gy: 300 } : { ax: 0.98, ay: 0.12, az: 0.05 }),
    seizure: (hz = 4) => { const r = rnd(11); return (s) => ({ ax: 1.2 * Math.sin(2 * Math.PI * hz * s) + 0.1 * r(), ay: 0.8 * Math.sin(2 * Math.PI * hz * s + 1) + 0.1 * r(), az: 1 + 0.9 * Math.sin(2 * Math.PI * hz * s + 2), gx: 350 * Math.sin(2 * Math.PI * hz * s), gy: 200 * r(), gz: 150 * r() }); },
    restless: () => { const r = rnd(13); return (s) => { const burst = (Math.floor(s / 6) % 3 === 0) && (s % 6) < 2.5; return burst ? { ax: 0.35 * r() + 0.2 * Math.sin(3 * s), ay: 0.3 * r(), az: 1 + 0.35 * r(), gx: 80 * r(), gy: 60 * r(), gz: 50 * r() } : { ax: 0.005 * r(), ay: 0.005 * r(), az: 1 }; }; },
  };

  const VexoMotion = { createMotionLab, SIGNALS, spectrum, bandAnalysis, autocorrMax, DEF };
  if (typeof module !== 'undefined' && module.exports) module.exports = VexoMotion;
  else root.VexoMotion = VexoMotion;
})(typeof window !== 'undefined' ? window : globalThis);
