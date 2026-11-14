# Band 39 care: Margaret's screen + Lisa's app

Live from the Vexo Open band **Vexo-HACK-39** (`BAND = 39` in `web/js/app.js`).

- **Motion labels** (`web/js/motion-lab.js`, 50 Hz accel + gyro): falling, tremor ("Parkinson shaking") score 0-4, steps,
  balance, sleep movement, nighttime wandering, seizure-like movement. Methods + PubMed-checked sources:
  `~/Documents/amy_sandbox/research/vexo-motion-algorithms/README.md`. Signals, not diagnoses.
- **Voice** (band mic → Deepgram) → **OpenAI** reads each transcript for risk (scam, abuse), medical (reminders,
  side effects, doctor notes), dementia signals (cognitive, memory, language), lifestyle tips and things to track
  (`server/insights.py`; offline rules if no key).
- **Read to me**: prompts and Lisa's messages are spoken by Deepgram's Aura voice (`DEEPGRAM_VOICE`, default `aura-2-vesta-en`), or by
  ElevenLabs when `ELEVENLABS_API_KEY` is set.
- **Care shop**: HSA/FSA-eligible equipment matched to what was detected (`web/js/catalog.js`), paid via **Stripe**
  Checkout (needs `STRIPE_SECRET_KEY`; demo mode until then). **Tell Dr. Patel** sends a summary to the clinic inbox.
- **Two health scores** at the top of Lisa's column (`web/js/scores.js`): Physical and Mental, 0-100, one line chart each (week or month,
  hover or arrow keys for the parts, table view). Physical blends balance, activity, sleep, falls and safety; Mental blends word recall,
  language, orientation, routine (pills) and connection (messages). Today's point is live; **earlier days are sample data** (the app keeps
  no history yet) and the weights are product guesses. The detailed motion and voice-note blocks fold away under "What's behind this score".
- **Mom's safe card** (`web/js/money.js`, rules in `web/js/card-rules.js`): a card with limits ($50 a purchase, $200 a week, no wires or
  crypto) in Lisa's column. A "Possible scam" alert from the care engine freezes it; only Lisa unfreezes it. The care shop can pay with a
  one-time card that closes after its one purchase. While it is frozen Margaret's screen says "Your card is taking a short rest" (no limits, no "scam"). **Simulated in the page: no real card, no real money.** Screens and plan:
  `../mockups/financial-ui.html`. Real cards via Stripe Issuing: `../experiments/cards/card_demo.py` (blocked on Stripe's side).
  Try it: 🧪 "Try it without a band" → the **Card** row, or the **Scam call** voice note.
- Look: soft self-care-app style (pastel sky, rounded type, chunky pills, original mascot "Pip").

## Run locally
    python3 server/server.py            # http://localhost:8039  (keys from ~/.config/vexo-band39/env or ../.env)
Chrome/Edge → double-tap the band → **Connect band 39**. No band: **Pretend band**, then "Try it without a band".

## Deployed on Superserve
    python3 tools/deploy_superserve.py  # new sandbox + public https URL (saved in tools/.superserve.json)
Keys are Superserve **secrets** bound to env vars: the sandbox only holds stand-in tokens, swapped for the real key
on the way to each API host. (Superserve's egress proxy is https://, so the server uses curl there.)

## Tests
    node tools/test_motion.mjs          # 11 checks: each label on synthetic signals
Keys: never in web/, git, or logs. They were shared in chat once: rotate them after the event.
