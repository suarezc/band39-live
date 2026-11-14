# Submission kit

Everything to paste into Devpost, the one-minute video shot list, and the two-minute demo.
Deadline: **6:00 PM Pacific, 14 November 2026.** Repo must be public before then.

## Devpost: project description

**Vexo Companion: a wristband that looks after an older person's physical, mental and financial health.**

Margaret is 78, has early memory problems and lives alone. Her daughter Lisa is 400 miles away. Margaret wears
a Vexo Open band: a motion sensor and a microphone on her wrist, nothing to press and no screen.

**What it does**

- **Physical.** The band's motion feeds fall detection, steps, walking regularity, night wandering and restless
  sleep. A fall brings up a "did you fall?" check and alerts Lisa.
- **Mental.** The microphone is always on. Everything said near Margaret's wrist is written down as it is
  spoken, attributed to each voice (Mom, and every other voice numbered until someone names it), and stored as
  a searchable memory of her day. Each night it is condensed into a short summary for Lisa and notes for her
  doctor, with the reminders Margaret voiced and every point linked to the lines it came from.
- **Financial.** When a voice that is not Margaret's asks for gift cards, account details or secrecy, her
  spending card freezes on the spot and Lisa is told. Only Lisa can unfreeze it. When Margaret mentions a need
  during the day (her knee on the stairs, feeling dizzy), the nightly summary suggests HSA/FSA-eligible
  products that Lisa can buy through Stripe.

The three feed each other: memory decline is what makes someone a scam target, and the same microphone that
hears her reminders hears the scam call.

**How it works**

The band connects straight to a web page over Bluetooth (the Vexo Open kit). Motion is analysed in the page.
Microphone packets stream to a small Python server, which sends them to Deepgram for live transcription and,
in parallel, runs a local speaker model on each phrase to work out whose voice it is. Phrases go into SQLite
and can be searched by words (BM25) and by meaning (vectors), fused by reciprocal rank, and filtered by person.
Google's Gemini decision model watches the last 45 seconds of conversation for scams and calls for help, and
Gemini writes the nightly summary. Stripe Checkout handles purchases.

**What we learned (the part we are proudest of)**

We measured instead of assuming, on the real band:

- Through a wrist microphone 11% of words were wrong, and the scam line a keyword list would have relied on
  ("your grandson is in jail and needs bail money") came out as nonsense. Judged as a whole conversation, the
  decision model still called it a scam at 98%; judged sentence by sentence, three of seven fragments looked
  innocent.
- A model reading only the transcript is blind after a fall: a groan produces no text. The same model
  listening to the audio scored a real groan at 87% for distress and a laugh at 11%.
- A model must never be the thing that cancels an alert. In our tests it confidently cancelled a fall alert
  because a TV weather forecast "answered". Our rule: it can raise an alert or ask again; only a person, or a
  tap on the band, cancels.
- Voice identity works on a wrist microphone but with different numbers than clean recordings, and a
  one-second "I'm fine" is too short to identify anyone.

Full write-up: `FINDINGS.md` in the repository.

**What is real and what is simulated**

Real on band 39: the live transcript, voice attribution, search, scam and call-for-help alerts, motion labels,
the nightly summary, Stripe Checkout (test mode). Simulated: the limited spending card (Stripe Issuing has the
same controls, but our sandbox account never opened), and the history in the score charts (only today is live).
Margaret, Lisa and the demo day are fictional. Not a medical device.

**Built with**

Vexo Open kit, Deepgram (streaming speech-to-text and Aura voices), Google Gemini (`gemini-decision-1` on text
and audio, Gemini 4 for the summary), Stripe (Checkout), WeSpeaker CAM++ and all-MiniLM-L6-v2 run locally with
ONNX Runtime, SQLite FTS5, Python, plain JavaScript.

**What's next**

Distress detection from audio in the live fall check; the band on a belt or ankle for gait asymmetry and
balance (where the published methods put the sensor); real limited cards; consent and privacy controls for
everyone the microphone hears.

## Sponsor technology we used (for the track question)

| Sponsor | What we used it for | Honest caveat |
|---|---|---|
| Vexo | The band, the Open kit, Web Bluetooth | |
| Deepgram | Live streaming transcription of the band's microphone; the read-aloud voice | |
| Google Gemini | Decision model for scam / help / fall checks on text and on audio; the nightly summary | |
| Stripe | Checkout for suggested products (test mode) | The limited card is simulated; Issuing was blocked |

We did not end up using Pipecat or ElevenLabs.

## One-minute video (backup for the live demo)

Record the screen with the band on. Narrate over it; do not explain the code.

| Seconds | Show | Say |
|---|---|---|
| 0-8 | Margaret's screen and Lisa's app side by side, band connected | "Margaret is 78 and lives alone. Her band looks after her physical, mental and financial health." |
| 8-22 | Talk normally; the live transcript fills in with "Mom" on your lines | "Everything said near her wrist is written down live, and it knows who said it." |
| 22-40 | Second voice reads the scam lines; the scam alert appears; the card turns grey and says FROZEN | "A stranger asks for gift cards. Her card freezes on the spot, and only her daughter can unfreeze it." |
| 40-50 | Search "who asked for gift cards", filtered to other voices | "Her day is searchable, by meaning and by voice." |
| 50-60 | Press "Run tonight's summary now"; show the summary and a suggested product | "Each night her daughter and her doctor get the day in a few lines, with what she said she needed." |

## Two-minute live demo (2:00 demo + 1:00 questions)

Two people: **Presenter** wears the band and is "Margaret". **Second voice** stands next to the band and is the
scam caller. One laptop, speakers on, Chrome window wide enough to show both columns (about 1400 px).

### Ten minutes before
- [ ] Server running: `cd care && ../.venv/bin/python server/server.py`. Second tab open on the fictional day: `http://localhost:8040`.
- [ ] `http://localhost:8039` reloaded; band connected; the Live strip at the top says **Listening**.
- [ ] In Lisa's column the card says **ACTIVE** (press "It's fine, unfreeze" if it is frozen from rehearsal).
- [ ] Your own lines show as **Mom** in the transcript. If not, press **This is Mom** on one long line of yours.
- [ ] Laptop volume up. Say "Hey Pip, what day is it?" once to check the voice answers.
- [ ] Tell the judges' table the microphone is on.

### The run

| Time | Who | Do / say | What the judges see |
|---|---|---|---|
| 0:00 | Presenter | "This is Margaret. She's 78, lives alone, and wears this band. It looks after three things: her physical, mental and financial health. Her daughter Lisa is 400 miles away; this is Lisa's screen." | Margaret's screen left, Lisa's app right |
| 0:15 | Presenter, as Margaret | "I need to call the pharmacy on Tuesday at three about my blood pressure pills." | The words appear live under **Mom** |
| 0:25 | Presenter | "Everything said near her wrist is written down as it's spoken, and it knows who said it." | Point at the Voices row |
| 0:30 | Second voice, close to the band | "Hello, this is your bank's security department. Your account has been compromised. I need you to buy four gift cards today and read me the numbers on the back." | Lines appear under **Voice 2**; within a few seconds **Possible scam call** appears and the card turns grey: **FROZEN** |
| 0:50 | Presenter | "A stranger asks for gift cards. Her card freezes on the spot. Margaret's screen only says her card is resting and Lisa will call. Only Lisa can unfreeze it." | Point at the frozen card, then Margaret's calm message |
| 1:05 | Presenter, as Margaret | "Hey Pip, when do I call the pharmacy?" | Pip answers out loud: Tuesday at three |
| 1:20 | Presenter | "It's her memory, in her own words. And it's searchable." Type **gift cards** in the search, choose Voice 2. | The scam line, filtered to the stranger |
| 1:30 | Presenter | Switch to the 8040 tab. "Here is a whole day. Every night it becomes a short summary for Lisa and notes for her doctor." Press **Run tonight's summary now** (or show the one already there). | Headline, flags, reminders, and a knee brace suggested with her own words: "this knee hurts going up the stairs" |
| 1:50 | Presenter | "Physical, mental, financial: one band, and the three protect each other. We measured all of it on the real band; the numbers are in the repo." | |

If you are ahead of time: say "Help, I've fallen and I can't get up" for the call-for-help alert.

### If something breaks
- **Band will not connect:** press **Pretend band** (it plays a recorded voice), and do the scam beat with the
  demo button: in "Try it without a band" press **Unknown voice asks for gift cards**. The card freezes the same way.
- **No scam alert within ten seconds:** say the gift-card line once more, slowly; then fall back to the demo button above.
- **Pip does not answer the spoken question:** press the big **Ask Pip** button and ask again, or type it.
- **Everything is down:** play the one-minute video.

### On stage, avoid
- Clapping or waving with the band hand (the motion labels can mistake them).
- A second voice far from the band: stand within arm's length.
- A narrow browser window: it folds the two screens into tabs.

### Questions you are likely to get (one minute)
- **"Is the card real?"** Stripe Checkout is real, in test mode. The limited card is simulated in our code: Stripe
  Issuing offers the same limits and freezing, but our sandbox account never opened today.
- **"How do you know it's a scam?"** Google's decision model reads the last 45 seconds of talk as a whole. On our
  real recording single sentences looked innocent, but the whole call scored 98%. It can raise an alert; it can
  never cancel one.
- **"What about privacy?"** No sound is stored, only text; the voice model runs on the laptop; the page shows
  when it is listening. Consent from everyone the microphone hears is the first thing we would build next.
- **"Does it detect falls?"** From motion, yes, with a "did you fall?" check; and it hears "help, I've fallen".
  We also measured the decision model on audio: a real groan scored 87% for distress and produces no text at
  all. That is not wired into the live check yet.
- **"How accurate is the transcript?"** 11% of words wrong through the wrist microphone, on one recording. That is
  why the scam check reads the whole conversation instead of trusting single words.
- **"Why a wristband and not a phone?"** No screen, nothing to press, always on her. The trade-off is where it
  sits: for gait and balance the research says hip or ankle, not wrist.
