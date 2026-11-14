# Band 39 Live

A live web page for our Vexo Open band, **Vexo-HACK-39**: motion graph, gestures, LED controls,
steps / battery / signal, and **Star Catcher**, a tilt-to-roll game.

## Run it

You need Python 3 and Chrome or Edge (other browsers have no Web Bluetooth).

    git clone --recurse-submodules <this repo's URL>
    cd <repo folder>
    python3 -m http.server 8000 --bind 127.0.0.1

Open <http://localhost:8000/index.html>.

- **Real band:** double-tap the band (it blinks blue), then press **Connect** within 60 seconds and
  pick `Vexo-HACK-39`. Close the kit dashboard or any other program connected to the band first.
- **No band:** press **Pretend band**. In Star Catcher, your mouse tilts the pretend band.

Cloned without `--recurse-submodules`? Run `git submodule update --init`.

The band number lives in one place: `const BAND = 39` in `index.html`.
`vexo-open-kit/` is the [Vexo Open kit](https://github.com/VexoAI-Org/vexo-open-kit) (MIT), included unchanged as a submodule.

## Vexo Companion: grandma screen + caregiver app

`companion/` is a second page for the same band 39: **Margaret's screen** (large type: fall check,
pill reminders, night redirect, check-ins, messages, help), **Lisa's caregiver app** (status, steps,
pills, alerts, two-way messages, timeline) and a **life event simulator** that plays fake days
(falls, missed pills, night walking, quiet spells, band left off, low battery) on the kit's pretend band.

With the server above running, open <http://localhost:8000/companion/vexo-companion.html#live>.
Band taps answer the prompts, and the band's light follows them. It connects only to `Vexo-HACK-39`
(`const BAND = 39` in `companion/js/live.js`). Tests: `node companion/tools/test_live.mjs`.
After editing `companion/index.html`, `css/` or `js/`, rebuild the single file with `node companion/tools/bundle.cjs`.

## Architecture and backend setup

See [ARCHITECTURE.md](ARCHITECTURE.md): the hub, voice (Pipecat + Deepgram + Gemini), Stripe checkout, and where to wear the band for gait and balance. Python setup: `uv venv --python 3.12 .venv && uv pip install -r requirements.txt`, then `.venv/bin/python tools/check_keys.py`.

## Band 39 care: motion labels, voice insights, HSA care shop

`care/` is Margaret's screen + Lisa's app with:
- seven motion labels from the band (fall, tremor score, steps, balance, sleep movement, night wandering, seizure-like)
- voice notes: band mic → Deepgram → OpenAI (scam/abuse, reminders, side effects, doctor notes, memory/language signals)
- ElevenLabs read-aloud, an HSA/FSA care shop with Stripe Checkout, and a doctor summary

Run it with `python3 care/server/server.py` (http://localhost:8039). It needs no packages. API keys go only in each
person's own `~/.config/vexo-band39/env` (see `care/README.md`), never in the repo.
Deploy: `python3 care/tools/deploy_superserve.py`. Tests: `node care/tools/test_motion.mjs`.
