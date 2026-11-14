# What we found

Results from one day of building on band 39 (Vexo-HACK-39), 14 November 2026. Each section says what was
measured and on what, because most of it is small: a handful of written cases, synthetic clips, or one real
recording. Details and scripts are in `experiments/`.

## The short version

1. **The transcript is good enough to act on, but not word-perfect.** Through the band's microphone, 11% of
   words were wrong. The words that matter most can be the ones lost.
2. **A model that only reads the transcript is blind to what matters after a fall.** Groans and laboured
   breathing produce no transcript at all. The same model listening to the audio heard them.
3. **Voice identity works on the band, with different numbers than the textbooks.** One person's phrases match
   each other far less through a wrist microphone than in clean recordings, and a one-second reply is too
   short to identify anyone.
4. **A model must never be the thing that cancels an alert.** It was confidently wrong in exactly that
   direction. It may raise an alert or ask again; only a person, or a tap on the band, cancels.
5. **Scams have to be judged over a stretch of talk, not sentence by sentence.**

## 1. Transcript accuracy on the real band

One recording, two speakers reading 13 scripted lines near the band, Deepgram streaming (nova-3).

| | Result |
|---|---|
| Words wrong | 14 of 127 (11%) |
| Lines exactly right | 9 of 13 |
| "I'm not fine": did "not" survive? | Yes |
| Names (Lisa, Ethan), "Tuesday at three" | Right |
| "metformin" | Heard as "metmorphin" |
| "buy four gift cards" | Heard as "buy for gift cards" |
| "Your grandson is in jail and needs bail money right now" | Heard as "He'll cry so I see in the bell money right now" |
| Groans, breathing, laugh, cough, silence | No text at all (nothing invented) |

The scam line that was lost is the one a keyword list would have depended on: "grandson", "jail" and "bail"
all disappeared.

## 2. Whose voice is it?

A small open speaker model (WeSpeaker CAM++, 29 MB) run on the laptop. No provider we have a key for offers
this on a live stream: Deepgram, Gemini and MiniMax only label voices "Speaker 1, Speaker 2"; ElevenLabs has
a speaker library, documented for uploaded files only.

| Where | Same person | Different people |
|---|---|---|
| Clean recordings of 3 people (the model project's test set) | 0.68 to 0.95 | 0.57 and below |
| Text-to-speech voices, 3 to 6 second sentences | about 0.7 | about 0.3 |
| **Band 39, real room, two real people** | **0.21 to 0.74** | **0.03 to 0.15** |

- Thresholds set on clean audio (yes at 0.65) labelled most of the wearer's own phrases "not sure" on the band.
  On this recording, yes at 0.40 and no below 0.18 would have labelled every scripted line correctly.
- **One second is too short.** A 0.7 second "I'm fine" from the right person scored 0.21.
- **A distressed voice is a different voice.** The wearer acting "Help, I've fallen and I can't get up" scored
  0.43 against their own calm voice and was labelled as someone else.
- Learning a voice from three phrases instead of one raised the wearer's scores to 0.53 to 0.79.
- **Loudness did not separate two people who were both near the band** (wearer -27 to -16 dB, second voice
  -23 to -12 dB). Whether it separates a TV across the room is not measured yet.
- A tooling trap: the `sherpa-onnx` wrapper (2.0.1) produced fingerprints that did not separate anyone, on
  the model's own test files. Running the model directly fixed it.

## 3. The decision model on written cases (`gemini-decision-1`)

Google's Decisions API answers yes/no, pick-one and score questions with a probability, in about 0.3 seconds,
with no text generation. Cases are ours, so this shows it reasons sensibly, not that it is accurate.

- **Telemetry cases** (is gait changing, was that a fall, which product fits): 20 of 21 right. It said
  "nothing needed" at 92% for a normal fortnight, and matched cane / night lights / pill organiser to the cause
  at 87 to 97%.
- **Fall check from a transcript**: of 27 answers, 21 confident and right, 4 unsure and right, **2 confident
  and wrong, both cancelling an alert that should have stayed open**:
  - the "reply" was a TV weather forecast (cancel, 93%)
  - no reply and no tap, but the band showed normal walking (cancel, 87%)
- Adding who spoke and how close fixed the TV case (ask again, 89%). Walking alone still cancelled (86%).
- **A bystander's words are evidence of a fall, not an answer on the wearer's behalf.** "Oh my god, are you
  OK?" after an impact: fall confirmed 99%. "She's fine, just slipped" changes how urgent it is, not whether
  it happened. The same alarmed words from a TV with no impact on the band: no fall, 96%.

## 4. The decision model listening to audio

The API also accepts audio (`{"type": "audio", "data": <base64 wav>, "mime_type": "audio/wav"}` in `input`),
at 30 tokens a second and about 0.7 seconds a call.

**Synthetic clips** (24 clips: text-to-speech performances and generated noise):

| How it was asked | Answers right | Confidently wrong |
|---|---|---|
| Audio plus one sentence of context | 123 of 133 | 0 |
| Audio alone | 116 of 133 | 2 |
| Transcript only | 105 of 133 | 4 |

A groan under a TV: audio said distress 79%; the transcript held only the forecast, so text said 10%.

**Real band** (the same recording as section 1), probability of distress:

| Clip | Audio | What the transcript had |
|---|---|---|
| A groan | 87% | nothing |
| Laboured breathing | 84% | nothing |
| "I'm fine. I'm not fine. Help, I've fallen…" | 80% | the words |
| Bystander: "Oh my god, are you okay?" | 83% | the words |
| **"I'm fine", then a groan** | **48%** | "I'm fine." |
| A laugh, then a cough | 11% | nothing |
| Silence | 28% | nothing |
| Ordinary conversation | 15 to 16% | the words |

"I'm fine" followed by a groan is the weak case on both synthetic and real audio, and it is the dangerous one.

## 5. Scam detection has to look at the whole exchange

The decision model's probability that someone is asking for money, gift cards or account details, on the
scam lines as the band transcribed them:

| What was judged | Probability |
|---|---|
| "I need you to buy for" (a fragment) | 20% |
| "gift cards today. Read me the numbers." | 94% |
| "On the back. He'll cry so I see in" (the lost line) | 9% |
| The three scam lines together | **98%** |
| The wearer's ordinary lines, and the bystander | 1 to 13% |

Phrase by phrase, three of seven fragments looked innocent. Judged together they were unmistakable, even with
the garbled line. The same lines judged from audio scored lower than from text (49% against 96% for the gift
card line), so for scams the transcript is the better input.

## 6. Motion labels: predictions to check, not results

A test bench (`experiments/bench/`) feeds the band's motion into the care app's own label code. On rough
made-up versions of each movement, every label fires when it should, and four look-alikes raise false alarms:
a dropped band counts as a fall, brushing teeth as tremor, applause and waving as seizure-like movement.
None of this has been run on the real band yet.

## 7. Gait and balance: where the band is worn matters more than its sensor

From the kit's documentation and published work, not from measurements on the band:

- The sensor is adequate: 208 samples a second with both sensors over Bluetooth, about 5 ms timing.
- **Apple's walking asymmetry and steadiness come from the iPhone at the hip, not the Watch.** Every validated
  method for step asymmetry or standing sway puts the sensor at the lower back, waist or hip.
- The wrist is good for step rate, variation in step timing, and arm swing. Left/right step asymmetry from
  one wrist has not been validated by anyone we could find.
- The ankle gives precise step timing for that leg (heel strike and toe-off to within about 5 ms in the
  literature); comparing legs means moving the band.

## 8. Things that did not work

- **Real cards from Stripe Issuing**: switched on in the sandbox, but the account the cards draw on stayed
  "pending", so no card could be created. The card in the demo is simulated in our own code.
- **Voice match from any cloud provider on a live stream**: none available with the keys we had.

## The rules we took from this

- Cancelling an alert takes a tap or an exact answer from the wearer. A model can only raise or ask again.
- Motion is the anchor for a fall. Speech adds evidence; speech alone does not create a fall.
- A call for help escalates whoever says it.
- Listen to the audio for distress; read the transcript for scams.
- Judge scams over the last half minute of another voice, not one phrase.
- Treat a short reply as "voice unknown", not as "someone else".

## What this does not show

Small samples throughout. One real recording, one room, two speakers, acted lines, no TV in the background,
no person who has actually fallen. Synthetic clips are an easy stand-in. The decision model's probabilities
were not checked against a large labelled set. Nothing here is a medical claim.
