# Vexo Companion · Life Simulator website

Single-page site showing how the Vexo bracelet helps older adults, especially people living with Alzheimer's, and their families.
Open `vexo-companion.html` (single self-contained file, shareable) or `index.html` (editable multi-file version) directly in a browser. It has no build step, no dependencies, and no audio.

Sections: hero → why it matters (stats) → **interactive day simulator** → real-life activity library → how data flows (band → phone → cloud → family) → family connection → value calculator → responsible AI → sources.

Lives in `vexo/product/life-sim/`, a sibling of `vexo/product/vexo-companion/` (a separate Node app built by another session). It's fully independent of that app. After editing the multi-file version, regenerate `vexo-companion.html` by re-inlining `css/` and `js/`.

## Simulator
- 14 isometric cubes = Margaret's day (78, early Alzheimer's, lives alone; daughter Lisa is 400 mi away). Click a cube or timeline chip to jump.
- Animated data packets: wrist → band → (BLE) phone → (TLS) cloud → Calendar/Email/Notion/SMS → Lisa's app. The packet inspector shows each illustrative payload.
- Haptic patterns (1 / 2 / 3 long), autonomy levels L0–L4, cue-before-reveal, calm mode, night redirect.
- **With / Without Vexo** toggle replays the same day unassisted. The metrics panel compares both.
- **Stage** selector (MCI / early / moderate) changes prompts and family sharing.
- Lisa's phone: type or tap a message → it travels to Margaret's band as a pulse plus read-aloud. Day words ("Saturday") become reminders.
- Sharing toggles filter what Lisa sees. Alerts and messages are always on.

## Files
- `js/scenario.js` – the day's story beats, payloads, metrics (data only)
- `js/engine.js` – DOM-free state machine (plan, apply, digest)
- `js/sim.js` – board, flights, feed, memory graph
- `js/activities.js`, `js/site.js` – activity library, counters, calculator
- `tools/test_engine.cjs` – `node tools/test_engine.cjs` walks every mode × stage

Story and stats come from `~/Documents/amy_sandbox/vexo/research/` (01–04). Figures there were compiled without live web checks ([verify] items).
Sensor rates, BLE/packet formats, and SDK capabilities are **illustrative assumptions** until Vexo confirms them.

## Band 39 live (Vexo Open kit)
Section `#live` connects to the team's real band **Vexo-HACK-39** (the only band it will connect to; `BAND` in `js/live.js`) through `../../vexo-open-kit/js/src/index.js`, or to the kit's pretend band.
- Serve the `vexo/` folder: `python3 -m http.server 8000 --bind 127.0.0.1` → http://localhost:8000/product/life-sim/vexo-companion.html (Chrome/Edge). Opened as a file, Bluetooth is off and an in-page stand-in replaces the pretend band.
- **Margaret's screen** (large type): fall check, pill reminders, night redirect, check-ins, messages, help. Band taps answer prompts; the band's light mirrors them (no vibration motor on this band).
- **Lisa's app**: status, activity/steps/pills/band tiles, alerts, two-way messages, timeline.
- **Life event simulator**: 9 scenarios + manual triggers played on the kit's `SimTransport`, with a jumpable fast scene clock.
- Files: `js/live-engine.js` (DOM-free rules), `js/live-scenarios.js`, `js/live.js`. Tests: `node tools/test_live.mjs`. Rebuild the single file: `node tools/bundle.cjs`.
- Thresholds (fall response 20 s, quiet 3 h, not-worn stillness, night hours) are guesses to tune on a real wearer. No microphone/speech yet.
