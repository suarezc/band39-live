# Experiments: what we need to test, and how

Each test answers one question the product depends on. Scripts connect only to band 39
(`BAND` in `band.py`). Recordings go to `experiments/data/`, which git ignores (they contain
people's voices and movement). Run every command in the project folder.

Setup once: `uv venv --python 3.12 .venv && uv pip install -r requirements.txt`, keys in `.env`.
Add `--sim` to any recording script to try it with the pretend band (made-up data: it checks the
plumbing, not the answer). Close the dashboard and other band pages first: one connection at a time.

| # | Question | Needs the real band | Status |
|---|---|---|---|
| 1 | How noisy is the sensor at rest? | yes | script ready, not run on the band |
| 2 | Can we detect a left/right walking difference, and from where on the body? | yes | script ready, checked on made-up signals only |
| 3 | Can we measure standing balance above the noise? | yes | script ready, checked on made-up signals only |
| 4 | How accurate is the transcript from the band's microphone? | yes | script ready, plumbing checked |
| 5 | Does the decision model choose correctly, and does it know when it is unsure? | no | runs now: see results below |
| 7 | Do the care app's seven motion labels fire on the right movements and stay quiet on look-alikes? | yes | bench ready; runs on the pretend band |
| 6 | Is a reply the wearer's own voice, and close to the band? | for tuning | works on test recordings; one-second replies are too short: see below |

## 1. Sensor noise floor

Band flat on a table, nobody touching the table.

    .venv/bin/python experiments/record_motion.py --test noise --placement desk --condition flat --seconds 60
    .venv/bin/python experiments/analyze.py experiments/data/motion/noise_*.csv

Gives the accelerometer noise (mg) and the gyroscope's offset and noise. Tests 2 and 3 are only
meaningful where their numbers are clearly above this floor. The kit measured about 2.3 °/s gyro
offset and steps of at most 5 mg on one band.

## 2. Gait asymmetry

Walk at least 20 steps in a straight line, 3 walks per condition, laptop within about 10 m.
Create a limp on purpose the way Apple did: an ankle weight, a heel lift or a stiff knee brace on one leg.

    .venv/bin/python experiments/record_motion.py --test gait --placement belt --condition normal --seconds 30
    .venv/bin/python experiments/record_motion.py --test gait --placement belt --condition limp-left --seconds 30
    (repeat with --placement wrist-left, ankle-left, ankle-right)
    .venv/bin/python experiments/analyze.py experiments/data/motion/gait_*.csv

| Placement | What the analysis reports | What we expect |
|---|---|---|
| belt (lower back or hip) | step and stride regularity, symmetry, step-time ratio (1.1 and 1.5 thresholds) | ratio near 1.0 normal, above 1.1 with the limp |
| wrist | the same numbers | probably cannot tell the limp from normal: that is the finding to confirm |
| ankle, one leg at a time | stride time, its variation, peak swing speed | compare left with right: the limping leg swings slower |

Pass: the limp is flagged in every limp walk and in no normal walk, for at least one placement.
Not built yet: stance and swing time at the ankle (heel strike and toe-off from the gyroscope).

## 3. Standing balance

Band on a belt at the lower back. Stand 30 seconds per condition, arms crossed, 2 repeats.
Have someone next to the person for the eyes-closed and foam conditions.

    .venv/bin/python experiments/record_motion.py --test sway --placement belt --condition eyes-open --seconds 30
    (repeat with --condition eyes-closed, foam-eyes-open, foam-eyes-closed, feet-in-line)
    .venv/bin/python experiments/analyze.py experiments/data/motion/sway_*.csv

Reports sway RMS, range, jerk and path. Pass: the numbers rise in the order eyes-open,
eyes-closed, foam, and eyes-open is clearly above the noise floor from test 1. If eyes-open sits
at the noise floor, we can only claim balance under harder conditions.

## 4. Transcript accuracy

The phrases are in `speech/phrases.json`: safety answers ("I'm fine" / "I'm not fine"), reminders
with days and times, medication and family names, questions. Record every phrase per condition.
The light is solid blue while the microphone is on: tell the people near you.

    .venv/bin/python experiments/speech/record_speech.py --condition "arm's length, quiet"
    .venv/bin/python experiments/speech/record_speech.py --condition "across the room"
    .venv/bin/python experiments/speech/record_speech.py --condition "arm's length, TV on"
    .venv/bin/python vexo-open-kit/examples/python/speech_accuracy.py experiments/data/speech --show

Recording sends nothing anywhere. The last command sends the recordings to Deepgram and prints
the word error rate per condition and kind of phrase, with what was heard when it was wrong.
Look hardest at: "not" in "I'm not fine", the day names, the medication names.
Not built yet: Deepgram's per-word confidence and its key-terms option (medication and family
names), which the scoring script does not use.

## 5. Decision model

    .venv/bin/python experiments/decisions/eval_decisions.py --threshold 0.8

Runs `gemini-decision-1` on the cases in `decisions/cases.json`, each with a right answer we wrote.
Add a case whenever the model surprises you.

Result on 14 November (15 cases, 27 answers, threshold 0.8): 21 confident and right, 4 unsure
and right, **2 confident and wrong**. Both wrong answers cancelled a fall alert that should have
stayed open:

- the "reply" was a TV weather forecast with high-confidence words: it chose cancel (0.93)
- there was no reply and no tap, but the band showed normal walking: it chose cancel (0.87)

So: the model must not be the thing that cancels a fall alert. Cancelling needs a tap on the
band or an exact phrase match checked by a fixed rule; the model may only escalate or ask again.

## 6. Is it the wearer's voice, and is it close? (voice match + loudness)

    .venv/bin/python experiments/speech/voice_check.py selftest
    .venv/bin/python experiments/speech/voice_check.py enroll margaret a.ogg b.ogg c.ogg
    .venv/bin/python experiments/speech/voice_check.py check margaret reply.ogg

A 29 MB open speaker model (WeSpeaker CAM++) run locally; the command that downloads it is at the
top of `voice_check.py`. Deepgram, Gemini and MiniMax have no enrolled voice match.

Results on 14 November (no band involved yet):

- 9 real recordings of 3 people (the model project's test set): same person 0.68 to 0.95,
  different people 0.57 and below. Clean.
- Voices made by Deepgram text-to-speech, sentences of 3 to 6 seconds: same voice about 0.7,
  different voices about 0.3. Clean.
- **A one-second "I'm fine" is too short.** From the right voice it scored anywhere from 0.31 to
  0.59 across runs: never a confident yes, sometimes a confident no. A different voice never
  scored a confident yes (highest 0.52), so the mistakes are on the safe side.
- The `sherpa-onnx` wrapper (2.0.1) gave embeddings that did not separate people at all, on the
  same files. The script runs the model directly instead.

So voice match can confirm a sentence, not a two-word reply. For the fall check: a tap cancels;
a short spoken "I'm fine" counts only if it is also loud (close to the band); otherwise ask her
to say a full sentence or tap. Still to do on the real band: tune YES, NO and NEAR, and record a
TV across the room to see how far apart "near" and "far" loudness really are.

## 7. Live test bench for the care app's motion labels

Open <http://localhost:8000/experiments/bench/> in Chrome or Edge (server: `python3 -m http.server 8000 --bind 127.0.0.1`
in the project folder). Close the care app and the dashboard first: the band takes one connection.

The bench connects to band 39, walks a person through 24 scenarios and feeds the band's motion into the
care app's own code (`care/web/js/motion-lab.js`, same settings: 50 samples a second, 8 g). It says pass or
fail for each, shows what the lab saw, and keeps the raw motion. The band's light blinks amber for "get
ready" and turns green for "go". Nobody falls for real: falls are acted with the arm onto a bed.

For each of the seven labels there is a movement that should fire it and look-alikes that should not:

| Label | Should fire | Look-alikes that should stay quiet |
|---|---|---|
| Falling | arm drops onto a bed and lies still | one hard clap, the band dropped on a table, sitting down heavily |
| Tremor | small fast hand shake | hand at rest, brushing teeth, typing |
| Steps | 50 counted steps, 30 shuffling steps | swinging the arm while seated |
| Balance | normal walk, uneven walk scores lower, standing eyes closed | |
| Sleep movement | tossing and turning | lying still (the bench tells the lab it is 2 am) |
| Night wandering | two minutes of walking at "2 am" | a one-minute trip, the same walk by day |
| Seizure-like | large rhythmic arm jerking | applause, brushing teeth, waving, jogging on the spot |

For the demo, the point is to learn which movements show each label reliably on stage, and which everyday
movements to avoid while the judges watch.

No band: press **Pretend band** (it plays a rough made-up version of each movement), or run all of them in
a few seconds with `node experiments/bench/dry_run.mjs`. On those made-up signals every "should fire"
scenario fires, and four look-alikes raise false alarms: a dropped band counts as a fall, brushing teeth as
tremor, applause and waving as seizure-like. Those are predictions to check on the real band, not results.

Scenarios live in `bench/scenarios.js`: add one by copying an entry.

## 8. Scam-safe cards (Stripe Issuing, test mode)

    .venv/bin/python experiments/cards/card_demo.py

Margaret gets a virtual card with limits ($50 a purchase, $200 a week, no wires or money orders); a scam
alert from the band freezes it; Lisa unfreezes it; a care-shop item is paid with a one-time card.
Pretend cards and pretend purchases only: the script refuses a live key.

Status on 14 November: **not run end to end yet.** Issuing is switched on and the test cardholder exists,
but Stripe's financial account that the cards draw on is still "pending", so no card could be created.
The script says so and stops. Still unknown: how that account gets test funds, and whether purchases are
approved without them.

## Self-test of the analysis

    .venv/bin/python experiments/analyze.py --selftest

Builds made-up walks with step-time ratios 1.00, 1.15 and 1.60 and a made-up 6 mg wobble, and
checks that the analysis gets them back. It passes. A person is the real test.
