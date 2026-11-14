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

## Self-test of the analysis

    .venv/bin/python experiments/analyze.py --selftest

Builds made-up walks with step-time ratios 1.00, 1.15 and 1.60 and a made-up 6 mg wobble, and
checks that the analysis gets them back. It passes. A person is the real test.
