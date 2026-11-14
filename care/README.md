# Band 39 care: Margaret's screen + Lisa's app

Live from the Vexo Open band **Vexo-HACK-39** (`BAND = 39` in `web/js/app.js`).

**App shell:** a landing page shows the circle of care (Margaret, Lisa, Ruth, Dr. Patel, Pip) and links to two portals:
- **Margaret's portal** (`#/grandma/...`) has the tabs Today · Talk · Messages · Help.
- **Caregiver portal** (`#/caregiver/...`) has the tabs Home · Physical · Memory · Safety · Care · Circle.

**Day / Night** (toggle, top right) switches on sleep scoring, the wandering watch, night prompts and a dark theme.
Every signal tile has a **?** sheet (`web/js/signals-info.js`) explaining how it works, how to trigger it, and a demo.

**AI agents** (`server/agents.py`): Pip replies and acts (`/api/pip`), memory moments (`/api/recall`), Lisa's digest
(`/api/digest`), "Ask about Mom" (`/api/ask`), doctor note draft (`/api/doctor-draft`).

**Always-on mic** (`L`, `feed`, `heard` in `web/js/app.js`): band 39's mic whenever the band is connected (the band
shows solid blue while its mic is on, and the LED can't be changed then), or this device's mic in Margaret's portal.
Loudness over an adaptive noise floor cuts speech into utterances, which go to Deepgram. Pip replies only when you say
"Pip", tap Talk, or speak within 20 s of Pip speaking. Everything else is "Heard nearby": checked for scam, abuse, memory
and health signs, with no reply. The mic pauses while Pip talks and while a band prompt needs the light. Toggle: Talk tab.

**Event simulator** (`#/sim`, `web/js/simulator.js`): 30 events in 3 groups (mental, financial, physical health), each
sent down the real path (voice → `heard()`, motion → pretend band, band → care-engine events). It has live panels
(captured / Margaret sees / Lisa gets), a health snapshot, "Run all" per group, and "Play a whole day".

**Two devices:** Margaret's device is the hub. It shares state under a 6-letter household code (`/api/state`, `/api/actions`),
which Lisa enters on her phone.

- **Motion labels** (`web/js/motion-lab.js`, 50 Hz accel + gyro): falling, tremor ("Parkinson shaking") score 0-4, steps,
  balance, sleep movement, nighttime wandering, seizure-like movement. Methods + PubMed-checked sources:
  `~/Documents/amy_sandbox/research/vexo-motion-algorithms/README.md`. Signals, not diagnoses.
- **Voice** (band mic → Deepgram) → **OpenAI** reads each transcript for risk (scam, abuse), medical (reminders,
  side effects, doctor notes), dementia signals (cognitive, memory, language), lifestyle tips and things to track
  (`server/insights.py`; offline rules if no key).
- **ElevenLabs** reads prompts and Lisa's messages to Margaret ("Read to me").
- **Care shop**: HSA/FSA-eligible equipment matched to what was detected (`web/js/catalog.js`), paid via **Stripe**
  Checkout (needs `STRIPE_SECRET_KEY`; demo mode until then). **Tell Dr. Patel** sends a summary to the clinic inbox.
- Look: soft self-care-app style (pastel sky, rounded type, chunky pills, original mascot "Pip").

**Features by health area:** see `FEATURES.md` (mental · physical · financial).

**Mom's safe card** (`web/js/money.js`, `web/js/card-rules.js`, ported from github.com/suarezc/band39-live @ 39567e1): Lisa's
**Money** tab. Card limits ($50 a purchase, $200 a week, no wires or crypto); any "Possible scam" alert freezes it; only Lisa
unfreezes; one-time cards for the care shop. Margaret sees "Your card is taking a short rest". Simulated: no real card or money.

**Trends** (`web/js/trends.js`, `server/history.py`): Lisa's history, trend charts, AI summary and chat about Mom's trends.

**Pip's voice:** replies are spoken hands-free (ElevenLabs; Deepgram Aura fallback, `DEEPGRAM_VOICE`). The first tap anywhere
unlocks sound; a reply that arrives before that shows "Tap to hear Pip". **Mic on/off button** in Margaret's header and the
simulator's top bar. In the simulator, Pip stays silent unless "Pip's voice" is ticked.

**Simulator stage** (`web/js/sim-stage.js`, three.js r186 vendored in `web/vendor/`): blocky voxel Margaret in her room acting
out each event, the band LED on her wrist; beside it the bracelet panel and Lisa's phone.

## Run locally
    python3 server/server.py            # http://localhost:8039  (keys from ~/.config/vexo-band39/env)
Chrome/Edge → double-tap the band → **Connect band 39**. No band: **Pretend band**, then "Try it without a band".

## Deployed on Superserve
    python3 tools/deploy_superserve.py           # new sandbox + public https URL (saved in tools/.superserve.json)
    python3 tools/deploy_superserve.py --update  # redeploy to the saved sandbox (same URL)
Keys are Superserve **secrets** bound to env vars: the sandbox only holds stand-in tokens, swapped for the real key
on the way to each API host. (Superserve's egress proxy is https://, so the server uses curl there.)

## Tests
    node tools/test_motion.mjs          # 12 checks: each label on synthetic signals
Keys: never in web/, git, or logs. They were shared in chat once: rotate them after the event.
