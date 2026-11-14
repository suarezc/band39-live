# Can gemini-decision-1 judge audio directly? (2026-11-14)

Script: `experiments/decisions/audio_test.py` (reuses cached clips and answers; `--rejudge` asks again).
Clips, per-clip checks and raw answers are cached in the session scratchpad
`/private/tmp/claude-501/-Users-charlessuarez-vexohacks/56491f33-22d1-417b-bb12-03f11ca839e1/scratchpad/audio-decisions/`.

## 1. Does audio input work? Yes.

Request shape that works (same endpoint and three top-level fields as for text):

```json
{"model": "gemini-decision-1",
 "input": [{"type": "text", "text": "This is a 5-10 second clip from ... The audio clip follows.\n"},
           {"type": "audio", "data": "<base64 of the .wav bytes>", "mime_type": "audio/wav"}],
 "questions": { ... }}
```

A bare `[{"type":"audio", ...}]` with no text part works too. Shape documented by the Evolink reference
(the ai.google.dev page now redirects to aistudio.google.com/docs/decisions). Errors seen while probing:
- Gemini style `[{"inline_data": {"mime_type": ..., "data": ...}}]` -> 400 `The 'type' parameter is required at 'input[0]'.`
- `mime_type: application/octet-stream` -> 400 `Unsupported mime_type ... Only audio/* MIME types are supported.`

Per the reference: `uri` (public HTTPS, max 15 MB) can replace `data`; inline media up to 100 MB per request;
audio types wav/mp3/aac/ogg/flac/m4a/opus/webm/l16 and more.

## 2. The clips (24, all synthetic, 5-10 s, 16 kHz mono WAV)

Made with Deepgram Aura-2 TTS (5), Gemini TTS with style direction (13), numpy (4), and mixes of those (4).
Each clip was checked by duration, loudness and a Deepgram nova-3 transcription. For the clips meant to be
wordless or to carry a tone, I also asked gemini-3.8-flash once to describe what it heard (9 calls). That
Flash check is only a sanity check of the clips and is NOT part of the result; all answers in the tables
below come from gemini-decision-1.

What the checks say about whether the clips contain what was intended:
- Gemini TTS did make wordless sounds when asked: transcripts were empty for moan, breathing, crying,
  laugh and cough; the male groan transcribed as "Oh. Oh. Oh." (a groan, but with a vowel the STT took as a word).
  Flash heard: male groan = "low, guttural groans... pained"; female moan = "breathy sighs... tired" (so it may
  sound more tired than in pain); "crying" = "pants heavily... whimpers and groans" (probably not clearly
  crying); breathing = "pants heavily... strained". **Unsure: cry_gemini is not clearly crying; groan_gemini_f is
  more sighing than moaning.**
- gemini-2.5-flash-preview-tts returned no audio (`finishReason: OTHER`) twice: for the panicked "Help! ..."
  prompt and the laughter prompt. gemini-3.1-flash-tts-preview made both. No model produced speech instead
  of the requested non-verbal sounds.
- The numpy groan and breathing are crude. Flash heard the groan as "breathy 'oh'/'uh'... neutral tone" and
  the breathing as heavy breathing, but **I cannot tell how human they sound.**
- Deepgram misheard the flat "Help, I've fallen" as "Cope, I've fallen..." (the second "help me" survived).
- The "help" clips from Gemini TTS include gasps and laboured breathing (per Flash), so my label
  "no wordless distress" on them is arguably wrong; those count as misses below anyway.
- Clips over 10 s were cut at 10 s (the weather forecast loses its last word).

## 3. Results

Every clip got one Decisions call with six questions: `distress` (noul), `wordless` (groaning/moaning/crying/
laboured breathing, noul), `help` (noul), `speaking` (noul), `kind` (choice of 5), `urgency` (score 0-3).
Three ways of asking:
- **audio**: one context sentence ("wristband of an older person living alone, just after a possible fall") + the audio
- **bare**: the audio alone, no context sentence
- **text**: the same context sentence + the Deepgram transcript only ("(empty: no words were recognised)" if none)

Numbers are P(yes) for the four noul questions. `X!` = wrong with confidence >= 0.8, `x?` = wrong but less
sure, `-` = not scored (genuinely ambiguous). For urgency the most likely level is shown.

| clip | intended / how made | audio: distress, wordless, help, speaking, kind, urgency | text (transcript only) |
|---|---|---|---|
| calm_toast_vesta | calm speech, Deepgram vesta | .14 .13 .06 .96 calm_speech 0 | .07 .08 .04 .88 calm_speech 0 |
| calm_garden_orion | calm speech, Deepgram orion | .05 .08 .05 .94 calm_speech 0 | .07 .09 .03 .93 calm_speech 0 |
| fine_thalia | "I'm fine" calm, Deepgram thalia | .07 .08 .05 .96 calm_speech 0 | .07 .08 .03 .98 calm_speech 0 |
| fine_gemini | "I'm fine" calm, Gemini TTS | .08 .07 .07 .94 calm_speech 0 | .09 .10 .05 .99 calm_speech 0 |
| help_orion_flat | help call read flatly, Deepgram (distress/kind not scored) | .93 .17 .94 .93 call_for_help 3 | .95 .27 .98 .99 call_for_help 3 |
| help_gemini_panic | panicked help call, Gemini 3.1 TTS | .95 **.80x?** .95 .95 call_for_help 3 | .93 .34 .98 .97 call_for_help 3 |
| help_gemini_weak | weak trembling help call, Gemini TTS | .92 .33 .94 .93 call_for_help 3 | .99 .38 .99 .98 call_for_help 3 |
| groan_gemini_m | groans + heavy breathing, Gemini TTS | .76 .88 .10 .09 wordless_distress 2 | .70 .53 .44 **.86X!** wordless_distress 2 (STT "Oh. Oh. Oh.") |
| groan_gemini_f | moaning/sighing, Gemini TTS | .77 .82 .13 .11 wordless_distress 2 | .44x? .45x? .33 .21 silence_noise x? 2 |
| breath_gemini | laboured breathing, Gemini TTS | .87 .87 .35 .14 wordless_distress 2 | same as all empty transcripts: .44x? .45x? .33 .21 silence_noise x? 2 |
| cry_gemini | "crying" (sounds more like panting/whimpers), Gemini TTS | .91 .87 .13 .09 wordless_distress 2 | empty transcript (wrong, as above) |
| groan_synth | numpy synthetic groan | .62 .63 .26 .14 wordless_distress 2 | empty transcript (wrong) |
| breath_synth | numpy synthetic fast breathing | **.46x? .41x?** .22 .11 wordless_distress (.46) **0x?** | empty transcript (wrong) |
| silence | numpy silence | .29 .22 .23 .18 silence_noise 0 | .44 .45 .33 .21 silence_noise **2x?** |
| room_noise | numpy pink noise | .25 .20 .17 .17 silence_noise 0 | same, urgency **2x?** |
| tv_weather | weather forecast, Deepgram orion | .08 .11 .06 .90 broadcast 0 | .08 .09 .03 .97 broadcast 0 |
| tv_weather_far | same, band-passed, -24 dB, + noise | .10 .08 .04 .87 broadcast 0 | .10 .07 .03 .97 broadcast 0 |
| tv_news_gemini | newsreader, Gemini TTS | .40 .27 .18 **.30x? silence_noise x?** 0 | .07 .08 .05 .95 broadcast 0 |
| fine_shaky | conflict: "I'm fine" in shaky pained voice | .70 **.53x?** .11 .92 calm_speech(.46) - 2 | **.48x?** .26 .21 .97 calm_speech - 2 |
| fine_then_groan | conflict: calm "I'm fine" spliced with synthetic groan | **.35x?** .51 .14 **.31x?** calm_speech - **0x?** | **.18X!** .16 .04 .98 calm_speech **0x?** |
| laugh_gemini | false-alarm test: laughter, Gemini 3.1 TTS | .26 .34 .11 .12 wordless_distress(.57, not scored) 0 | empty transcript, urgency **2x?** |
| cough_gemini | coughing fit (only help/speaking scored) | .22 .30 .12 .15 wordless_distress(.53) 0 | empty transcript |
| groan_under_tv | male groan mixed with the forecast at equal level | .79 .71 .13 .66 wordless_distress(.49) 2 | **.10X! .07X!** .03 .97 broadcast 0 |
| groan_quiet | male groan at -20 dB + room noise | .60 .80 .17 .14 wordless_distress 2 | empty transcript (wrong) |

Per-question accuracy (scored answers only; 24 clips, some questions unscored on ambiguous clips):

| question | audio + context | bare audio | transcript text |
|---|---|---|---|
| distress | 20/22 | 15/22 | 13/22 (2 confidently wrong) |
| wordless | 19/22 | 18/22 (2 confidently wrong) | 15/22 (1 confidently wrong) |
| help | 24/24 | 24/24 | 24/24 |
| speaking | 22/24 | 24/24 | 23/24 (1 confidently wrong) |
| kind | 17/18 | 17/18 | 12/18 |
| urgency | 21/23 | 18/23 | 18/23 |
| **total** | **123/133, 0 confidently wrong** | **116/133, 2 confidently wrong** | **105/133, 4 confidently wrong** |

The question that matters most for the fall check, "is someone in distress or pain?", on audio + context:
10 of 12 distress clips above 0.5 (misses: the crude numpy breathing at 0.46 and the spliced
"I'm fine" + synthetic groan at 0.35), and all 10 calm/silent/TV/laugh clips below 0.5 (highest 0.40,
the Gemini newsreader). On the transcript alone only 3 of 12 distress clips were caught, and those were
the ones with words.

## 4. Where it was right and wrong

Right:
- **Wordless distress is heard.** Groans, moaning, laboured breathing and whimpering with an empty
  transcript got distress 0.6-0.9 and `kind = wordless_distress` (0.71-0.95). The transcript route cannot
  see any of this: every empty transcript gets the same answer (distress 0.44, "silence or noise").
- **Groan under a TV** (equal level): audio said distress 0.79, wordless 0.71. The transcript only contains
  the forecast, and text mode said broadcast, distress 0.10: a confidently wrong all-clear.
- **TV vs a person:** both clean and muffled "from another room" forecasts were called `broadcast` (0.93-0.95).
- **Silence, noise, laughter, coughing** were not called distress (0.22-0.33).
- **Quiet groan** at -20 dB in noise was still caught (distress 0.60, wordless 0.80).

Wrong or shaky (none of these was confidently wrong at a 0.8 threshold on audio + context):
- **The context sentence changes the answer.** On `tv_news_gemini`, "is anyone speaking?" was 0.30 with the
  wristband/fall sentence in front, but 0.93 on bare audio, and 0.93 when asked alone on bare audio. With
  context it also called the clip silence/noise. So the framing can make it ignore clear speech. Overall
  the context sentence helped (distress 20/22 vs 15/22 bare: bare audio heard the groans as wordless but
  rated them as less distressed, e.g. male groan 0.23), but it is a lever that can push the wrong way.
- **Spliced "I'm fine" + groan**: it heard the groan half-way (wordless 0.51) but said distress 0.35,
  speaking 0.31 and urgency 0. The splice is artificial, but "says fine, then groans" is exactly the
  case we care about, and it was missed (not confidently).
- **Synthetic breathing** (numpy noise bursts) was a near coin-flip (0.46). Probably my fault, not the model's.
- **Laughter and coughing** got `kind = wordless_distress` (0.57, 0.53), though distress stayed low. Expect
  some false alarms on non-verbal sounds if the `kind` answer is used on its own.
- **Shaky "I'm fine"**: distress 0.70 on audio vs 0.48 on text, so tone is heard, but `kind` still said
  calm_speech (0.46) with call_for_help second.

## 5. Latency and cost

- Audio calls: median 0.72 s, max 1.79 s (24 clips x 2 runs, from this laptop). Text-only calls: median 0.29 s.
- Audio is billed at **30 tokens per second** (5 s = 150, 10 s = 300). A full call with the 6-question set
  and context sentence was 688-848 input tokens; ~540 of those are the text (questions + context). Output
  tokens are always 0.
- **Deterministic:** the two audio runs gave identical answers on every clip.
- Usage example: `{"total_input_tokens": 793, "input_tokens_by_modality": [{"modality":"text","tokens":546},{"modality":"audio","tokens":247}]}`
- Calls spent: about 103 Decisions calls, about 20 TTS calls (5 Deepgram, 15 Gemini including 2 empty
  responses), 24 Deepgram transcriptions, 9 Flash description checks (plus 9 that 404ed: gemini-2.5-flash
  is no longer available to this key).

## 6. What this does NOT show

- **Every clip is synthetic.** TTS "groans" are performances by a speech model, judged by a model from the
  same company; they may be much easier to recognise than a real older person groaning on a floor. I could
  not listen to any clip.
- No wristband microphone: no fabric rubbing, wrist movement, clipping, distance, room echo, or the band's
  own codec. Mixes and the -24 dB "other room" filter are crude stand-ins.
- 24 clips, one or two per condition. The counts are not accuracy estimates; they show the model behaves
  sensibly on easy examples.
- The labels are mine and some are arguable (gasping in help calls; "crying" that sounds like panting).
- No test of real false alarms in a home: kettle, dog, TV drama with someone groaning, a person sighing in
  an armchair. A TV drama with a groaning actor would probably fool it.

## 7. Recommendation

Worth wiring in as **one extra signal** in the fall check, not as a decider. It hears what the transcript
cannot (wordless groans and laboured breathing, a groan under a TV), it was never confidently wrong on
audio here, it is cheap (about 800 tokens per 10 s clip) and fast (under 1 s typically). Suggested use:
send the clip with a short context sentence and treat `distress >= 0.5` or `wordless >= 0.6` as "escalate or
ask again", never as "cancel the alert"; a low distress score must not cancel an alert on its own (it missed
"I'm fine" followed by a groan). Keep the context sentence short and test it, since it moved one clear-speech
clip to "silence". Before relying on it, record a handful of real clips through the actual band (staff
groaning, breathing hard, TV on, silence) and rerun this script against them.
