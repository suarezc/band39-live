# Real band recording: transcript, voice labels and gemini-decision-1 (2026-11-14)

Recording: session `1114-151423`, band 39, 216.8 s (`experiments/data/live/clips/1114-151423-151800.wav`), phrases ids 40-65 in
`experiments/data/live/transcript.db`. Charles (the enrolled "main" voice) and one second person read the test script in one room.
Script: `experiments/decisions/realband_eval.py` (it prints every table below; API answers are cached in the scratchpad
`/private/tmp/claude-501/-Users-charlessuarez-vexohacks/56491f33-22d1-417b-bb12-03f11ca839e1/scratchpad/realband/answers/`, so reruns cost nothing).
63 Decisions calls in total.

**What this is:** one recording, two speakers, acted lines, one room, one band. The numbers say how the system did on this
recording. They are not accuracy rates. I could not listen to the audio, so which sound is which in the wordless part is my inference from the energy and spectrum.

## A. Transcript (Deepgram, as stored)

Overall word error rate on the 13 spoken lines: **14 errors in 127 words, 11%**. 9 of the 13 lines were perfect.

| line | said | transcribed | errors |
|---|---|---|---|
| 1 you | I need to call the pharmacy on Tuesday at three ... | **So I need *you* to call** the pharmacy on Tuesday. / At three about my blood pressure pills. | 2 added ("so", "you"). "you" changes the meaning (asking someone else to call) |
| 3 you | ... I took my metformin | ... I took my **metmorphin** | 1 |
| 4 second | Hello, this is your bank's security ... | **Oh,** hello. This is your bank's security department ... | 1 added |
| 5 second | buy **four** gift cards today **and** read me ... | buy **for** gift cards today. Read me ... | 2 |
| 6 second | Your grandson is in jail and needs bail money right now. Don't tell anyone. | **He'll cry so I see in / The bell money** right now don't tell anyone. | 8 of 14 words (57%) |
| 2, 7-12, 15 | | exact | 0 |

- "Tuesday at three": kept, but split across two phrases ("...on Tuesday." / "At three ..."). Lisa and Ethan: correct.
- **"not" in line 10 survived**: "I'm fine. I'm not fine." (one phrase, with line 9).
- "four" became "for"; "metformin" became "metmorphin".
- **Line 6 was lost**: "grandson", "jail" and "bail" are all gone. Only "money right now, don't tell anyone" is left.
- Lines 13, 14, 16 and 17 (no words): nothing was transcribed, so no invented words. The groan after "I'm fine" (line 15) left no trace in the transcript either.

## B. Voice labels (app thresholds: main >= 0.65; other < 0.50, or < 0.25 for phrases under 1.5 s)

Stored scripted phrases: **12 right, 2 wrong, 3 unsure** (17 phrases; phrase 48 is the one the voice was learned from, so its 1.0 is automatic).

| speaker | match range | notes |
|---|---|---|
| you (8 phrases, without 48) | **0.21 - 0.74**, median 0.60 | main: 50 (.70), 51 (.74), 61 (.69). unsure: 49 (.60), 60 "I'm not sure about that." (.61, 1.1 s), 62 "I'm fine. I'm not fine." (.55). **wrong (other)**: 63 "Help, I've fallen and I can't get up." (.43, 1.7 s, the loudest "you" phrase), 65 "I'm fine." (.21, 0.7 s) |
| second voice (8 phrases) | **0.03 - 0.15**, median 0.10 | all 8 correctly "other" |

- All 8 second-voice phrases were labelled correctly. The errors were all on Charles: the call for help and the last "I'm fine" were labelled *someone else*. Those are the two phrases where the label matters most.
- The 1-second lines: 60 (1.1 s) 0.61, 65 (0.7 s) 0.21. Line 11 (shouted): 0.43.
- Deepgram's speaker numbers matched the people on 15 of 17 phrases: Charles was speaker 2 on 8 of 9 (not on 65), and the second voice was speaker 1 on 7 of 8 (not on 53 "Oh, hello.").
- **Thresholds that would have worked here:** on this recording, *other* is at most 0.15 and Charles is at least 0.21 (0.43 on phrases of 1.5 s or longer). Main >= 0.40 and other < 0.18 would have given no wrong labels and two unsure (63 would become main, 65 unsure). The margin is thin, though: Charles's unscripted 0.5 s "I'm just gonna" scored 0.15, the same as the highest second-voice phrase. This is one recording with one other voice, so treat these numbers as a hint, not a setting.
- Diagnostic: learning the voice from lines 1-3 together (mean of 48, 50, 51) instead of from phrase 48 alone raises Charles to 0.53-0.79 on phrases over 1 s (65 still 0.24). The second voice stays at 0.00-0.18. Enrolling from more than one phrase looks worthwhile.

## C. Loudness (loud_db)

You: -27.3 to -15.8 dB (median -18.7). Second voice: -23.4 to -11.6 dB (median -17.6). **The ranges overlap almost completely**: the second person was as close to the band as Charles, and the loudest phrase (-11.6, "Oh my god, are you okay?") was theirs. On this recording, loudness does not tell the wearer from someone else.

## Wordless part (181.6 s to end): events by short-time RMS

Room tone is about -47 dB per 50 ms frame. Events are frames more than 12 dB above it.

| my guess | time s | confidence | evidence |
|---|---|---|---|
| (faint) | 182.6-183.0 | - | -33 dB, just below the event threshold; maybe an in-breath |
| 13 groan | 183.7-184.4 | medium | loudest burst (-11 dB), partly voiced, pitch about 125-145 Hz. Only about 0.8 s long, not 5 s |
| 14 laboured breathing | 184.8-189.5 | medium | 5-6 noisy, mostly unvoiced pulses (flatness 0.33-0.44, centroid about 2 kHz) about 0.6-1 s apart. The line between 13 and 14 is uncertain |
| 15 "I'm fine" + groan | 190.1-192.4 | high | "I'm fine" is transcribed at 189.9-190.6, then a low, voiced sound (centroid about 430 Hz) until 191.2, and another voiced burst at 191.9-192.4 |
| 16 laugh, then cough | 195.0-197.3 | medium | 195.0-195.8 is voiced (laugh?), 196.5-197.2 is three short noisy bursts (coughs?). The order comes from the script |
| 17 silence | 197.4-207.4+ | high | room tone only, with clicks at 203.5 and 212.7 s |

## D. Decision model on the TEXT (transcript as stored, with the voice label and match it carries)

**Scam probability, P(yes) "someone asking for money, gift cards, card numbers or account details":**

Each phrase on its own (as a per-phrase check would see it):

| id | text | P(scam) |
|---|---|---|
| 53 | Oh, hello. | 0.08 |
| 54 | This is your bank's | 0.72 |
| 55 | security department. Your account has been compromised. | 0.82 |
| 56 | I need you to buy for | 0.20 |
| 57 | gift cards today. Read me the numbers. | **0.94** |
| 58 | On the back. He'll cry so I see in | 0.09 |
| 59 | The bell money right now don't tell anyone. | 0.72 |
| negatives: 48-52 (Charles's ordinary lines, "Can you say those lines?"), 64 (bystander) | | **0.01 - 0.13** (highest: 52 at 0.13) |

- **Phrase by phrase, the scam lines and the ordinary lines cannot be fully separated.** Every phrase that has scam content in it scored 0.72 or more, and every negative scored 0.13 or less, so any threshold between 0.14 and 0.71 (for example 0.5) catches 54, 55, 57 and 59 with no false alarms on this recording. But 3 of the 7 scam phrases are fragments with nothing suspicious in them on their own (53, 56, 58: 0.08-0.20), and those are missed. That happens because the app cuts phrases wherever Deepgram's speaker number changes.
- **Grouping the phrases by script line fixes this:** line 4 = 0.82, line 5 = 0.96, line 6 (garbled) = 0.57, lines 4-6 = **0.98**, the whole call 4-8 = 0.98. Charles's reply line 7 alone ("I'm not sure about that.") = 0.13. Phrase 61, his own "...What card number do you need?", = 0.82, which fits a scam in progress.
- Distress/help: 9-10 = 0.69, 11 = 0.83, 12 = 0.47. "Said fine": 9-10 "I'm fine. I'm not fine." = 0.49 (a coin flip), 15 = 0.87. One wrong answer: phrase 51 ("toast and tea... metmorphin") got said-fine 0.62 (wrong, but not confidently).

**Fall check (wearer_ok_v2), text after "did you fall?":**

| heard | answer (probabilities) | right answer |
|---|---|---|
| 62 "I'm fine. I'm not fine." (unsure .55) | ask_again 0.49 / escalate 0.49 | escalate |
| 63 "Help, I've fallen..." (labelled **other** .43) | **ask_again 0.64** / escalate 0.34 | escalate |
| 62 + 63 | ask_again 0.72 / escalate 0.25 | escalate |
| 64 bystander only | escalate 0.54 / ask_again 0.45 | escalate or ask_again |
| 63 + 64 | escalate 0.71 | escalate |
| no words (lines 13-14 as the transcript sees them) | ask_again 0.68 / escalate 0.30 | escalate (it was groaning) |
| 65 "I'm fine." (labelled other .21) | ask_again 0.92 | escalate (a groan followed, but the text cannot see it) |
| 62-65 all | escalate 0.62 | escalate |

Same phrases with the label corrected to main (match number unchanged): 62 -> **escalate 0.66**, 63 -> **escalate 0.79**, 65 -> ask_again 0.69 / cancel 0.20.
**The wrong voice label is what turned "Help, I've fallen" into "ask again".** Text-only answers were never confidently wrong in the dangerous direction (no cancel); they were too hesitant.

## E. Decision model on AUDIO clips cut from the WAV

P(yes) with the one-sentence context (the fall sentence from `audio_test.py`; a plain wristband sentence for the scam and reply clips). Bare (no context) in brackets where it differs by more than 0.1.

| clip | s | distress | wordless | help | speaking | scam | kind | urgency |
|---|---|---|---|---|---|---|---|---|
| control A, chat before the test | 12.4 | .15 | .19 | .12 | .90 | .13 | calm_speech | 0 |
| control B, Charles talking | 5.5 | .16 | .19 | .19 | .86 | .11 | calm_speech | 0 |
| scam 4-6 | 19.7 | .48 (.56) | .39 | .27 | .90 | **.88** (.83) | call_for_help .37 / calm .36 | 3 (E2.2) |
| scam 4 only | 5.8 | .40 (.22) | .14 | .17 | .90 | .78 (**.20** bare) | calm_speech | 3 (E1.8) |
| scam 5-6 | 11.8 | .31 (.53) | .44 | .24 (.34) | .90 | **.49** (.60) | calm_speech | 1 |
| replies 7-8 | 5.5 | .10 | .12 | .12 | .93 | .58 (.33) | calm_speech | 0 |
| fall speech 9-11 | 7.9 | **.80** | .25 (.43) | **.87** | .83 | .09 | call_for_help .71 | 3 (E2.8) |
| bystander 12 | 3.5 | **.83** | .33 (.54) | .77 (.90) | .94 | .10 | call_for_help .86 | 3 |
| groan 13 (my cut) | 1.2 | **.87** (.74) | .84 | .37 (.14) | .10 | .10 | wordless_distress .84 | 2 |
| breathing 14 (my cut) | 5.0 | **.84** (.65) | .85 | .31 | .25 | .14 | wordless_distress .83 | 2 |
| 13-14 as one 8 s window | 7.9 | **.75** (.61) | .86 | .18 | .19 | .12 | wordless_distress .84 | 2 |
| "I'm fine" + groan 15 | 3.0 | **.48** (.57) | .43 (.50) | .11 | .88 | .08 | calm_speech .59 (wordless .30) | 2 (E1.5) |
| laugh + cough 16 | 2.6 | .11 | .17 (.29) | .07 | .20 | .09 | calm_speech .58 (bare: wordless .43) | 0 |
| silence 17 | 10.0 | .28 | .20 | .21 | .15 (.26) | .14 | silence_noise .56 | 0 |

- The real groan and laboured breathing were heard as distress (0.75-0.87 with context) and as `wordless_distress`. The transcript had nothing for them.
- "I'm fine" followed by a real groan: distress 0.48 with context, 0.57 bare, and `kind` = calm_speech. Urgency was most likely 2, though, so it was not an all-clear. This is the same weak spot the synthetic splice showed (0.35).
- Laugh/cough and silence were not called distress (0.11 and 0.28). Controls were 0.15-0.16.
- Audio scam detection is weaker than text: lines 5-6 (the gift cards) came out at 0.49, against 0.96 on text. Line 4 depends on the context sentence (0.78 with it, 0.20 without). Every scam clip got urgency level 3 as most likely.
- Audio cost: median 753 input tokens per call.

## F. Against the synthetic results (AUDIO_FINDINGS.md)

Mostly the same picture. Wordless distress is heard on audio and is invisible to the transcript. Real groan and breathing scored about as high as the Gemini-TTS ones (0.76-0.87). The real breathing (0.84) did much better than the numpy one (0.46). Laughter and coughing stayed low on distress, and, unlike the synthetic laugh, the real one was not called `wordless_distress` with context. "I'm fine then groan" is still the weak case (0.48 real, 0.35 synthetic): on audio, low distress must not cancel an alert. One new finding: on real audio, the voice label (not the model) caused the worst text mistake.

## What this does not show

One recording, one wearer, one second person reading close to the band, acted lines, one quiet room, no TV (line 18 was not recorded). I picked the clip boundaries for the wordless part without listening, and lines 13 and 14 may be split wrongly. The app's later code (being edited now) may label differently from the version that wrote these rows.
