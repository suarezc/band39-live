/* Vexo Companion · live care engine (DOM-free).
 * Turns Vexo Open band signals (taps, free-fall, activity, battery, link, motion) into
 * what Margaret's screen shows, what the band's light does, and what Lisa sees.
 * Runs in the browser (window.VexoLive) and in Node (module.exports) for tests.
 *
 * Two clocks: "scene" time is the simulated time of day (the life-event simulator can jump
 * and speed it up); "real" time is the wall clock, used for how long a person gets to answer.
 * Thresholds are product guesses, not clinical values; they need tuning on a real wearer.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    medTimes: ['08:00', '20:00'],
    medWindowMin: 45,          // pills count as missed this long after the reminder
    fallResponseSec: 20,       // real seconds Margaret has to answer "did you fall?"
    checkinResponseSec: 25,    // real seconds for a quiet-day check-in
    inactivityMin: 180,        // daytime minutes with no movement before a check-in
    notWornMin: 120,           // minutes the band lies perfectly still before "is it on?"
    stillStd: 0.004,           // g: stdev of |a| below this = lying on a table (guess)
    nightStartH: 22.5, nightEndH: 6,
    nightBackToRestMin: 10, nightEscalateMin: 20,
    dayStartH: 8, dayEndH: 21,
    stepGoal: 3000,
    lowBattery: 20,
    farRssi: -85,
  };

  const PRIORITY = ['fall', 'help', 'checkin', 'night', 'reminder', 'message', 'notworn'];

  const LEDS = {
    fall:     { color: '#ff3040', pattern: 'blink',   period: 400,  brightness: 1,    say: 'blinking red: did you fall?' },
    help:     { color: '#ff3040', pattern: 'flash',   period: 600,  brightness: 1,    say: 'flashing red: Lisa has been called' },
    checkin:  { color: '#ffb020', pattern: 'blink',   period: 900,  brightness: 0.8,  say: 'blinking amber: just checking on you' },
    night:    { color: '#ff9a5a', pattern: 'breathe', period: 3000, brightness: 0.25, say: 'a soft warm glow: it is night-time' },
    reminder: { color: '#ffb020', pattern: 'breathe', period: 2000, brightness: 0.8,  say: 'glowing amber: time for your pills' },
    message:  { color: '#8b6cf0', pattern: 'breathe', period: 1500, brightness: 0.8,  say: 'glowing violet: a message from Lisa' },
    notworn:  { color: '#8b6cf0', pattern: 'blink',   period: 2000, brightness: 0.4,  say: 'blinking slowly: please put me on' },
    good:     { color: '#38c172', pattern: 'flash',   period: 500,  brightness: 0.9,  say: 'a green flash: all done' },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ms) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };
  function fmtTime(ms) {
    const d = new Date(ms); let h = d.getHours(); const ap = h < 12 ? 'am' : 'pm';
    h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`;
  }
  const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  function atToday(ms, hhmm) {
    const [h, m] = hhmm.split(':').map(Number); const d = new Date(ms);
    d.setHours(h, m, 0, 0); return d.getTime();
  }
  const isNight = (ms, c) => { const h = hm(ms); return h >= c.nightStartH || h < c.nightEndH; };
  const isDay = (ms, c) => { const h = hm(ms); return h >= c.dayStartH && h < c.dayEndH; };
  const medName = (t) => (Number(t.split(':')[0]) < 12 ? 'morning' : Number(t.split(':')[0]) < 17 ? 'afternoon' : 'evening');

  function createEngine(clock, opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const subs = new Set();
    let seq = 0;
    let flashUntil = 0;           // real ms: brief green "done" flash
    const s = {};

    function reset(sceneMs) {
      Object.assign(s, {
        day: dayKey(sceneMs),
        connected: false, transport: null, bandName: null,
        activity: 'unknown', cadence: 0, motionG: null,
        stepsBase: null, stepsTotal: null, steps: 0, goalHit: false,
        lastMoveAt: sceneMs, stillSince: null, offWrist: false,
        battery: null, batteryState: null, lowBatteryFlagged: false,
        rssi: null, far: false, tempC: null,
        meds: {}, active: {}, alerts: [], timeline: [], messages: [],
        night: null, signals: 0, lastSignal: null,
      });
      for (const t of cfg.medTimes) s.meds[t] = atToday(sceneMs, t) <= sceneMs ? 'n/a' : 'pending';
      log(sceneMs, '🌅', `Watching from ${fmtTime(sceneMs)}`, 'info');
    }

    // ---- helpers -------------------------------------------------------------
    function emit() { for (const fn of subs) { try { fn(api); } catch (e) { console.error(e); } } }
    function log(at, icon, text, kind) {
      s.timeline.unshift({ id: ++seq, at, icon, text, kind: kind || 'info' });
      if (s.timeline.length > 80) s.timeline.length = 80;
    }
    function alert(level, title, body, key) {
      const now = clock.scene();
      if (key) { const old = s.alerts.find((a) => a.key === key && !a.ack); if (old) { Object.assign(old, { level, title, body, at: now }); return old; } }
      const a = { id: ++seq, key, level, title, body, at: now, ack: false };
      s.alerts.unshift(a);
      if (s.alerts.length > 40) s.alerts.length = 40;
      return a;
    }
    function resolveAlert(key, level, title, body, newKey) {
      const a = s.alerts.find((x) => x.key === key && !x.ack);
      if (a) Object.assign(a, { level, title, body: body || a.body, key: newKey || key + ':done:' + seq++, at: clock.scene() });
      return a;
    }
    function open(kind, data) { s.active[kind] = Object.assign({ kind, since: clock.real(), sceneSince: clock.scene() }, data || {}); }
    function close(kind) { delete s.active[kind]; }
    function flash() { flashUntil = clock.real() + 2500; }
    function moved(at) { s.lastMoveAt = at; if (s.active.checkin) answerCheckin('moved'); }

    // ---- what the band tells us ---------------------------------------------
    function ingest(sig) {
      const now = clock.scene();
      rollDay(now);
      s.signals++; s.lastSignal = sig.type;
      switch (sig.type) {
        case 'connect':
          s.connected = true; s.transport = sig.transport || null; s.bandName = sig.name || s.bandName;
          resolveAlert('link', 'good', 'Band connected again', `${s.bandName || 'The band'} is back in touch with Mom's tablet.`);
          log(now, '🔗', `${s.bandName || 'Band'} connected${sig.transport === 'sim' ? ' (pretend band)' : ''}`, 'info');
          break;
        case 'disconnect':
          s.connected = false;
          if (sig.reason !== 'closed') {
            alert('warn', 'Band lost touch with the tablet', 'Mom may be out of range, or the band is off. Trying to reconnect for 2 minutes.', 'link');
            log(now, '📴', 'Band disconnected', 'warn');
          } else log(now, '🔌', 'Band disconnected', 'info');
          break;
        case 'reconnected':
          s.connected = true;
          resolveAlert('link', 'good', 'Band reconnected', 'The link came back by itself.');
          log(now, '🔗', 'Band reconnected', 'info');
          break;
        case 'tap': onTap(1); break;
        case 'double-tap': onTap(2); break;
        case 'free-fall': onFall(now); break;
        case 'motion-start': moved(now); onWalkLike(now); break;
        case 'motion-stop': break;
        case 'tilt': case 'orientation': moved(now); break;
        case 'activity': onActivity(now, sig); break;
        case 'motion-summary': onMotion(now, sig); break;
        case 'battery': onBattery(now, sig); break;
        case 'temperature': s.tempC = sig.celsius; break;
        case 'link': onRssi(now, sig.rssi); break;
        case 'notice':
          if (sig.kind === 'critical-battery') alert('warn', 'Band battery is empty', 'The band has switched its sensors off until it is charged.', 'battery');
          break;
        default: break;
      }
      emit();
    }

    function onTap(n) {
      const now = clock.scene(); const top = prompt();
      // The impact of a fall also arrives as taps: for the first moments of a fall check a tap is not an answer.
      if (top && top.kind === 'fall' && clock.real() - (top.since || 0) < 2500) return;
      if (top && (top.kind === 'fall' || top.kind === 'checkin' || top.kind === 'night' || top.kind === 'notworn')) { userAction('ok', n === 2 ? 'double-tap' : 'tap'); return; }
      if (top && top.kind === 'reminder') { userAction('done', 'tap'); return; }
      if (top && top.kind === 'message') { userAction('read', 'tap'); return; }
      moved(now);
      // A double-tap with nothing to answer used to mean "call me". Removed: the jolt of a fall reads as a double-tap,
      // so the fall check and a "Mom would like a call" message appeared together.
    }

    function onFall(now) {
      if (s.active.fall) return;
      open('fall', { deadline: clock.real() + cfg.fallResponseSec * 1000 });
      alert('warn', 'Possible fall: checking on Mom', `The band felt a sudden drop at ${fmtTime(now)}. Mom has ${cfg.fallResponseSec} seconds to answer on her band or screen.`, 'fall');
      log(now, '⚠️', 'Possible fall detected. Asking Margaret', 'safety');
    }

    function onWalkLike(now) {
      if (isNight(now, cfg)) {
        if (!s.night) {
          s.night = { since: now, lastWalk: now, escalated: false };
          open('night');
          alert('warn', `Mom is up at ${fmtTime(now)}`, 'She started moving at night. Her screen and band are gently suggesting bed. No action needed yet.', 'night');
          log(now, '🌙', 'Up and moving at night', 'safety');
        } else s.night.lastWalk = now;
      }
    }

    function onActivity(now, a) {
      const prev = s.activity;
      s.activity = a.state; s.cadence = a.cadence || 0; s.motionG = a.motion;
      if (typeof a.steps === 'number') {
        if (s.stepsBase === null || a.steps < s.stepsBase) s.stepsBase = a.steps;
        s.stepsTotal = a.steps; s.steps = a.steps - s.stepsBase;
        if (!s.goalHit && s.steps >= cfg.stepGoal) {
          s.goalHit = true; flash();
          log(now, '🎉', `Reached ${cfg.stepGoal.toLocaleString()} steps`, 'good');
        }
      }
      if (a.state === 'walk' || a.state === 'run') {
        moved(now); s.offWrist = false; close('notworn');
        if (prev !== a.state) log(now, a.state === 'run' ? '🏃‍♀️' : '🚶‍♀️', a.state === 'run' ? 'Moving briskly' : 'Out walking', 'activity');
        onWalkLike(now);
      } else if (prev === 'walk' || prev === 'run') {
        log(now, '🪑', 'Resting', 'activity');
      }
    }

    function onMotion(now, m) {
      // m.std: stdev of |a| over about a second of samples. A wrist is never this still.
      if (m.std < cfg.stillStd) { if (s.stillSince === null) s.stillSince = now; }
      else { s.stillSince = null; if (s.offWrist) { s.offWrist = false; close('notworn'); log(now, '⌚', 'Band back on the wrist', 'info'); resolveAlert('notworn', 'good', 'Band is back on', 'Movement detected again.'); } }
    }

    function onBattery(now, b) {
      s.battery = b.percent; s.batteryState = b.state;
      if (b.state === 'charging' || b.state === 'charged') { if (s.lowBatteryFlagged) { s.lowBatteryFlagged = false; log(now, '🔌', 'Band is charging', 'info'); resolveAlert('battery', 'good', 'Band is charging', 'Thanks, Mom plugged it in.'); } return; }
      if (b.percent < cfg.lowBattery && !s.lowBatteryFlagged) {
        s.lowBatteryFlagged = true;
        alert('info', `Band battery ${b.percent}%`, 'Remind Mom to put it on the charger tonight. Her screen is reminding her too.', 'battery');
        log(now, '🪫', `Band battery low (${b.percent}%)`, 'warn');
      }
    }

    function onRssi(now, rssi) {
      if (rssi === null || rssi === undefined) return;
      s.rssi = rssi;
      const far = rssi < cfg.farRssi;
      if (far && !s.far) { s.far = true; log(now, '🏡', 'Band is far from the home tablet (out of the house?)', 'activity'); }
      if (!far && s.far) { s.far = false; log(now, '🏠', 'Band is back near the home tablet', 'activity'); }
    }

    // ---- what Margaret or Lisa do on screen ----------------------------------
    function userAction(kind, via) {
      const now = clock.scene(); const how = via ? ` (${via})` : '';
      if (kind === 'ok') {
        if (s.active.fall) {
          close('fall'); flash();
          resolveAlert('fall', 'good', 'Possible fall: Mom says she is OK', `She answered${how} at ${fmtTime(now)}. Worth a call later to ask how she feels.`);
          log(now, '💚', `Margaret answered she is OK${how}`, 'good');
        } else if (s.active.checkin) answerCheckin(via || 'screen');
        else if (s.active.night) { close('night'); flash(); log(now, '🛏️', `Margaret answered the night prompt${how}`, 'good'); }
        else if (s.active.notworn) { close('notworn'); s.stillSince = null; s.offWrist = false; log(now, '⌚', 'Margaret put the band back on', 'good'); resolveAlert('notworn', 'good', 'Band is back on', 'Mom answered the reminder.'); }
        else if (s.active.help) { close('help'); flash(); resolveAlert('help', 'good', 'Mom says she is OK now', `She cancelled the help call${how}.`); log(now, '💚', 'Margaret cancelled the help call', 'good'); }
      } else if (kind === 'help') {
        close('fall'); close('checkin');
        open('help');
        alert('urgent', 'Mom pressed HELP', `At ${fmtTime(now)}${how}. Call her now; if she does not answer, call her neighbour Ruth or 911.`, 'help');
        log(now, '🆘', 'Margaret asked for help', 'safety');
      } else if (kind === 'done') {
        const t = Object.keys(s.meds).find((k) => s.meds[k] === 'due');
        if (t) {
          s.meds[t] = 'taken'; close('reminder'); flash();
          log(now, '💊', `Took ${medName(t)} pills${how}`, 'health');
          resolveAlert('med:' + t, 'good', `${cap(medName(t))} pills taken`, `Confirmed at ${fmtTime(now)}.`);
        }
      } else if (kind === 'read') {
        const m = s.messages.find((x) => x.from === 'Lisa' && !x.read);
        if (m) { m.read = true; m.readAt = now; close('message'); flash(); log(now, '💌', `Margaret read: "${m.text}"`, 'family'); }
        if (s.messages.some((x) => x.from === 'Lisa' && !x.read)) open('message');
      }
      emit();
    }
    const cap = (t) => t[0].toUpperCase() + t.slice(1);

    function answerCheckin(via) {
      const now = clock.scene();
      close('checkin'); flash(); s.lastMoveAt = now;
      resolveAlert('quiet', 'good', 'Quiet spell: Mom answered', `She ${via === 'moved' ? 'started moving again' : 'answered the check-in'} at ${fmtTime(now)}.`);
      log(now, '💚', via === 'moved' ? 'Moving again after a quiet spell' : 'Margaret answered the check-in', 'good');
    }

    function sendMessage(text, from) {
      const now = clock.scene(); text = String(text || '').trim(); if (!text) return;
      from = from || 'Lisa';
      s.messages.push({ id: ++seq, from, text, at: now, read: from !== 'Lisa' });
      if (from === 'Lisa') { open('message'); log(now, '📨', `Lisa sent: "${text}"`, 'family'); }
      else { log(now, '💬', `Margaret replied: "${text}"`, 'family'); }
      emit();
    }

    function ack(id) { const a = s.alerts.find((x) => x.id === id); if (a) { a.ack = true; emit(); } }

    // ---- time passing ----------------------------------------------------------
    function rollDay(now) {
      const k = dayKey(now);
      if (k === s.day) return;
      s.day = k; s.stepsBase = s.stepsTotal; s.steps = 0; s.goalHit = false; s.lowBatteryFlagged = false;
      for (const t of cfg.medTimes) s.meds[t] = 'pending';
      log(now, '📅', 'A new day', 'info');
    }

    function tick() {
      const now = clock.scene(); const real = clock.real();
      rollDay(now);
      // pills
      for (const t of cfg.medTimes) {
        const due = atToday(now, t);
        if (s.meds[t] === 'pending' && now >= due) {
          s.meds[t] = 'due'; open('reminder', { med: t });
          log(due, '⏰', `Reminder: ${medName(t)} pills`, 'health');
        }
        if (s.meds[t] === 'due' && now >= due + cfg.medWindowMin * 60000) {
          s.meds[t] = 'missed'; close('reminder');
          alert('warn', `${cap(medName(t))} pills not confirmed`, `The ${fmtTime(due)} reminder went unanswered for ${cfg.medWindowMin} minutes. A quick call can sort it out.`, 'med:' + t);
          log(now, '💊', `${cap(medName(t))} pills not confirmed`, 'warn');
        }
      }
      // fall with no answer
      if (s.active.fall && real >= s.active.fall.deadline) {
        close('fall'); open('help', { auto: true });
        resolveAlert('fall', 'urgent', 'Possible fall: NO answer', `No reply for ${cfg.fallResponseSec} s after a sudden drop. Call Mom now; if she does not pick up, call Ruth next door or 911.`, 'help');
        log(now, '🚨', 'No answer after a possible fall. Lisa alerted', 'safety');
      }
      // quiet day
      if (!s.active.checkin && !s.active.fall && !s.active.help && isDay(now, cfg) && s.connected !== false &&
          now - s.lastMoveAt >= cfg.inactivityMin * 60000 && !s.offWrist) {
        open('checkin', { deadline: real + cfg.checkinResponseSec * 1000 });
        log(now, '🤍', `No movement since ${fmtTime(s.lastMoveAt)}. Checking in`, 'safety');
      }
      if (s.active.checkin && s.active.checkin.deadline && real >= s.active.checkin.deadline) {
        s.active.checkin.deadline = null;
        alert('warn', 'Quiet spell, no answer', `No movement since ${fmtTime(s.lastMoveAt)} and Mom did not answer a check-in. She may be napping. Give her a call.`, 'quiet');
        log(now, '📞', 'Check-in unanswered. Lisa notified', 'warn');
      }
      // band not on the wrist
      if (s.stillSince !== null && !s.offWrist && now - s.stillSince >= cfg.notWornMin * 60000) {
        s.offWrist = true;
        if (isDay(now, cfg)) open('notworn');
        alert('info', 'Band may be off Mom’s wrist', `It has been perfectly still since ${fmtTime(s.stillSince)}, like it is lying on a table. Falls and walks will not be noticed until she puts it back on.`, 'notworn');
        log(now, '⌚', 'Band lying still. Probably not worn', 'warn');
      }
      // night wandering
      if (s.night) {
        if (s.activity === 'still' && now - s.night.lastWalk >= cfg.nightBackToRestMin * 60000) {
          close('night');
          resolveAlert('night', 'good', 'Mom went back to rest', `Up from ${fmtTime(s.night.since)} to about ${fmtTime(s.night.lastWalk)}.`);
          log(now, '🛏️', 'Back to rest', 'good'); s.night = null;
        } else if (!s.night.escalated && (s.activity === 'walk' || s.activity === 'run') && now - s.night.since >= cfg.nightEscalateMin * 60000) {
          s.night.escalated = true;
          alert('urgent', 'Mom has been up for 20 minutes', `Moving since ${fmtTime(s.night.since)}${s.far ? ', and the band is far from the house' : ''}. Call her, or ask Ruth next door to knock.`, 'night');
          log(now, '🚨', 'Still walking at night. Escalated', 'safety');
        } else if (!isNight(now, cfg)) { close('night'); s.night = null; }
      }
      emit();
    }

    // ---- read-outs --------------------------------------------------------------
    function prompt() {
      for (const k of PRIORITY) if (s.active[k]) return s.active[k];
      return null;
    }
    function led() {
      const top = prompt();
      if (top) return Object.assign({ kind: top.kind }, LEDS[top.kind]);
      if (clock.real() < flashUntil) return Object.assign({ kind: 'good' }, LEDS.good);
      return null;
    }
    function wantsRealtime() { return !!(s.active.fall || (s.active.checkin && s.active.checkin.deadline)); }
    function status() {
      const open = s.alerts.filter((a) => !a.ack);
      if (open.some((a) => a.level === 'urgent')) return { level: 'urgent', label: 'Needs you now' };
      if (s.active.fall) return { level: 'warn', label: 'Checking on Mom…' };
      if (open.some((a) => a.level === 'warn')) return { level: 'warn', label: 'Worth a check-in' };
      return { level: 'good', label: 'All good' };
    }
    function nextUp() {
      const now = clock.scene();
      const t = cfg.medTimes.find((x) => s.meds[x] === 'pending' && atToday(now, x) > now);
      return t ? { text: `${cap(medName(t))} pills`, at: atToday(now, t) } : null;
    }

    // hooks for the motion lab: raise an alert, add a timeline line, open the fall check
    function raise(level, title, body, key) { const a = alert(level, title, body, key); emit(); return a; }
    function note(icon, text, kind) { log(clock.scene(), icon, text, kind); emit(); }
    const api = {
      raise, note,
      cfg, LEDS, state: s, ingest, tick, userAction, sendMessage, ack, prompt, led, status, nextUp,
      wantsRealtime, reset, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
      fmtTime, medName,
    };
    reset(clock.scene());
    return api;
  }

  const VexoLive = { createEngine, DEFAULTS, LEDS, fmtTime, atToday, isNight: (ms) => isNight(ms, DEFAULTS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = VexoLive;
  else root.VexoLive = VexoLive;
})(typeof window !== 'undefined' ? window : globalThis);
