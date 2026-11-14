# Architecture

How band 39, voice, the AI models, the family app and payments fit together.
Status: design agreed, setup done, components not built yet (see "Build status").

```
 Band 39  (motion, taps, free-fall, microphone, colour light; no speaker, no vibration)
    │ Bluetooth: ONE connection at a time
 HUB  (laptop now, Android phone later; Python + vexo-open-kit)
    • the only process that talks to the band
    • gait / fall features worked out locally (208 samples a second)
    • band audio (Opus) decoded and passed to the voice pipeline
    • local websocket feeding the web pages
    │ audio                         │ events + metrics (text only)
 VOICE (Pipecat)                 BACKEND (FastAPI)
    Deepgram speech-to-text         event timeline + memory
    → Gemini 4 Hydrogen + tools     care rules (companion/js/live-engine.js, levels L0–L4)
    → Deepgram Aura voice           Gemini 4 Carbon jobs (digest, trends, recommendations)
    → hub speaker                   recommendations → Stripe Checkout (test mode)
                                    │
                    Margaret's screen / Lisa's app (companion/)
```

## Components

| Piece | Job | Notes |
|---|---|---|
| **Hub** | Owns the band connection and fans data out | Needed because the band takes one Bluetooth connection. Web pages get band data from the hub's websocket instead of connecting themselves |
| **Pipecat** | Live conversation loop: speech-to-text → model → voice, with turn-taking and tool calls | Only for conversations. Passive capture ("I'll call the pharmacy tomorrow") goes straight to Deepgram via the kit's `speech.py` |
| **Deepgram** | Speech-to-text, and the reply voice (Aura) | Audio goes to Deepgram's cloud. Keep `mip_opt_out=true`. Tell people nearby before the microphone is on |
| **Gemini 4 Hydrogen** (`gemini-4-hydrogen`) | Real-time turns and tool calls | Tools: `save_memory`, `create_reminder`, `message_family`, `set_light`, `answer_from_memory` |
| **Gemini 4 Carbon** (`gemini-4-carbon`) | Slow, deep jobs | Lisa's nightly digest, memory graph, reading gait trends, explaining recommendations |
| **Stripe** | Checkout for recommended products | Test mode. See "HSA" below |

The model only chooses among actions we wrote. It never writes commands that are then run.

## Telemetry → recommendation → purchase

1. **Fixed rules** decide something changed (for example step-time asymmetry above 1.1 for 7 days, cadence down 15% in 2 weeks, repeated night-time stumbles).
2. **Carbon** picks from a fixed product catalog and writes a plain explanation that cites the data.
3. **A person approves**: Lisa sees the suggestion and the reason, and taps buy (level L3, "ask first").
4. Wording stays wellness, not diagnosis: "we noticed a change", never "fall risk".

## HSA

There is no special HSA key: an HSA card is an ordinary card to Stripe. Real HSA/FSA acceptance
needs each product on the SIGIS eligible product list plus an IIAS system (or a partner such as
Truemed). For the hackathon: Stripe test mode, products carry `hsa_eligible` metadata, and
checkout shows the HSA split.

## Gait and balance: where the band goes

| Placement | Good for |
|---|---|
| Ankle / lower shin | Step timing (heel strike, toe-off), stance and swing time, leg-by-leg asymmetry by swapping legs |
| Belt at the lower back / hip | Step asymmetry in one walk, standing balance (sway) |
| Wrist | Step rate, step-time variability, arm swing. Not validated for left/right step asymmetry |

Settings: 208 samples a second, both sensors; at the ankle 16 g and 1000 °/s.

## What the band does not have

No heart rate, no skin temperature, no vibration motor, no speaker. While the microphone is on
the light is locked solid blue, so listening is a short window, then the light shows the result.

## Keys

`.env` in the project folder (ignored by git): `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`,
`STRIPE_SECRET_KEY`. Never in a web page or a commit. Ask Charles for the values.

## Setup

    uv venv --python 3.12 .venv
    uv pip install -r requirements.txt
    .venv/bin/python tools/check_keys.py     # prints "works" or a status number, never a key

## Build status

- [x] Band page + Star Catcher (`index.html`), companion front end (`companion/`)
- [x] Python 3.12 environment, packages, keys checked (Deepgram, Gemini, Stripe test mode)
- [ ] Hub (band owner + websocket)
- [ ] Voice pipeline (Pipecat + Deepgram + Hydrogen)
- [ ] Backend (events, memory, Carbon jobs)
- [x] Test scaffold: recorder, first gait / balance / noise analysis, speech and decision tests (`experiments/README.md`)
- [ ] Run the tests on the real band
- [ ] Stripe test checkout with HSA-marked catalog
