# Apotheosis

A wristband that looks after an older person's **physical, mental and financial health**, and keeps her
family in the loop without hovering. Built in one day on a Vexo Open band (band 39) at the Vexo hackathon,
14 November 2026.

Margaret is 78, has early memory problems and lives alone. Her daughter Lisa lives 400 miles away. Margaret
wears the band; it has a motion sensor and a microphone. Everything else runs on a laptop.

| Pillar | What the band notices | What happens |
|---|---|---|
| **Physical** | Falls, steps, unsteady walking, night wandering, restless sleep | A "did you fall?" check on her screen, an alert to Lisa, a health score that moves |
| **Mental** | Everything said near her wrist, as text, attributed to each voice | A searchable memory of the day, reminders she voiced, a nightly summary for Lisa and her doctor |
| **Financial** | A stranger's voice asking for gift cards or account details | Her card freezes on the spot; only Lisa can unfreeze it. Suggested care products are paid through Stripe |

The pillars feed each other: memory decline is what makes someone a scam target, and the same microphone that
hears her reminders hears the scam call.

## How it works

```
 Band 39  (motion sensor, microphone)
    │ Bluetooth, straight into the browser (Web Bluetooth, the Vexo Open kit)
 The page  http://localhost:8039   Margaret's screen  |  Lisa's app
    │ motion → fall, steps, balance, sleep labels (in the page)
    │ microphone packets, 50 a second
 The server  (Python)
    ├─ Deepgram            speech to text as people speak, and the read-aloud voice
    ├─ a local voice model whose voice is each phrase: Mom, Voice 2, ... (nothing leaves the laptop)
    ├─ SQLite              every phrase, searchable by words (BM25) and by meaning (vectors), fused
    ├─ Gemini decision model   the last 45 seconds of talk: is this a scam? a call for help?
    ├─ Gemini (nightly)    the day condensed for the caregiver and the doctor, with product suggestions
    └─ Stripe              Checkout for suggested HSA/FSA-eligible products
```

- **Always-on transcript.** Press Start listening once; from then on it listens whenever the band is connected.
  Each phrase is labelled with who said it and stored. No sound is written to disk.
- **Voices.** A small open speaker model (WeSpeaker CAM++) gives every phrase a voice fingerprint. The wearer
  is "Mom"; every other voice is numbered and can be named.
- **Search.** Words and meaning are ranked separately and fused by reciprocal rank, and can be filtered by
  person: "who asked for gift cards", from voices that are not Mom's.
- **Scam and fall alerts in real time.** A decision model judges the recent conversation as a whole, because
  single fragments look innocent. It can raise an alert; it can never cancel one.
- **Safe card.** A spending card with limits that freezes on a scam alert, and one-time cards for care
  purchases. Simulated in the page (see "What is real").
- **Nightly summary.** One run over the day's transcript: key points for Lisa, notes for the doctor, the
  reminders she voiced, and products from a list of 70 typical HSA/FSA-eligible items when a need she
  voiced clears a threshold. Every point cites the lines it rests on.
- **Two scores.** Physical and Mental health as two line charts, with the detail folded away underneath.

## Run it

You need Python 3.12 (via [uv](https://docs.astral.sh/uv/)), Chrome or Edge, and keys for Deepgram, Gemini and Stripe (test mode).

    git clone --recurse-submodules https://github.com/suarezc/band39-live
    cd band39-live
    uv venv --python 3.12 .venv && uv pip install -r requirements.txt

Put your keys in a file called `.env` in the project folder (git ignores it):

    DEEPGRAM_API_KEY=...
    GEMINI_API_KEY=...
    STRIPE_SECRET_KEY=sk_test_...

Download the two small models (about 120 MB, commands in [experiments/README.md](experiments/README.md#model-files-not-in-git)), then:

    cd care
    ../.venv/bin/python server/server.py

Open <http://localhost:8039> in Chrome or Edge.

- **With a Vexo Open band:** double-tap it (it blinks blue), press **Connect band 39**, then **Start listening**
  in Lisa's column. The band number is set in one place, `BAND` in `care/web/js/app.js`.
- **With no band:** press **Pretend band**. It plays a recorded sample voice through the same path.
- **A whole fictional day, no band:** load it into a separate folder and browse it on another port.

      ../.venv/bin/python tools/load_demo_day.py --date 2026-11-12 --reset     # prints the next two commands
      BAND39_LIVE_DATA=<path it prints> ../.venv/bin/python server/server.py 8040
      BAND39_LIVE_DATA=<path it prints> ../.venv/bin/python server/digest.py --date 2026-11-12 --print

While it listens, everything the microphone hears is sent to Deepgram to be written down. The page says so.
Tell the people near the band.

## What is real, and what is not

| Piece | State |
|---|---|
| Live transcript from the band, voice labels, search | Real, running on band 39 |
| Scam and call-for-help alerts from the live transcript | Real (Gemini decision model on the transcript) |
| Fall, steps, balance, sleep and wandering labels from motion | Real code on real motion; thresholds tested on made-up signals only |
| Nightly summary and product suggestions | Real, from the stored transcript |
| Stripe Checkout for suggested products | Real, in Stripe test mode |
| The safe card (limits, freeze, one-time cards) | **Simulated in the page.** Stripe Issuing offers the same controls; our sandbox account never opened, so no real card could be created |
| The history in the two score charts | **Sample data.** Only today's point is live |
| "HSA/FSA eligible" labels | General guidance with a source per product; plans differ, and nothing here checks eligibility at checkout |
| Margaret, Lisa, Dr. Patel, the demo day | Fictional |

This is a hackathon project, not a medical device. It notices things worth a look; it does not diagnose.

## What we found

[FINDINGS.md](FINDINGS.md) has the measurements: transcript accuracy through the band's microphone (11% of
words wrong), how voice identity behaves on a wrist microphone, the decision model on text and on audio
(a real groan scored 87% for distress from the audio and produced no transcript at all), and why scams have
to be judged over a stretch of talk.

## Where things are

| Path | What |
|---|---|
| `care/` | The app: `server/` (Python), `web/` (the page), `data/` (product list, demo day), `tools/` (tests) |
| `care/server/live.py` | Live transcript: Deepgram stream, voices, storage, search |
| `care/server/watch.py` | Real-time scam and call-for-help alerts |
| `care/server/digest.py` | The nightly summary |
| `experiments/` | Tests and measurements: decision model, voice match, speech accuracy, a motion test bench, card rules |
| `care/web/deck.html` | The slides (by Amy): open <http://localhost:8039/deck.html> with the server running |
| `companion/` | The concept site: a day in Margaret's life, with and without the band |
| `mockups/` | The financial screens as designed |
| `index.html` | The first thing we built: a live band page with a tilt game |
| `vexo-open-kit/` | The [Vexo Open kit](https://github.com/VexoAI-Org/vexo-open-kit) (MIT), unchanged, as a submodule |
| `ARCHITECTURE.md` | The plan from the morning; the section above describes what was built |

## Built with

Vexo Open kit · Deepgram (streaming speech-to-text, Aura voices) · Google Gemini (`gemini-decision-1`,
Gemini 4 for the summary) · Stripe (Checkout) · WeSpeaker CAM++ and all-MiniLM-L6-v2 (run locally with ONNX
Runtime) · SQLite FTS5 · plain JavaScript, no build step.

## Also in this repository

The branch `amy/band39-care-v2` holds Amy's parallel version of the app: a 3D day simulator, trend charts, a product
page and an iOS wrapper. It was not merged; `main` is the version described above.

## Team

Charles Suarez and Amy (amyamyaaa), with Claude Code.
