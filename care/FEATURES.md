# Band 39 Care: features by health area

Margaret (78) wears Vexo band 39. Pip is her voice companion. Her daughter Lisa follows along in the caregiver portal.
Every feature below falls under **mental**, **physical** or **financial** health. The last section covers the shared platform.

Sensor key: **Motion** = band accelerometer + gyro at 50 Hz (`web/js/motion-lab.js`) · **Voice** = always-on mic → Deepgram → OpenAI
(`server/insights.py`, `server/agents.py`) · **Band** = the band's own events (taps, LED, battery, stillness) · **App** = portal actions.
Status: ✅ built and runs locally · 🧪 simulated (no real-world integration yet) · 🔑 needs a key that isn't set yet · 🚧 in progress.

---

## 🧠 Mental health: memory, thinking, mood, sleep

| Feature | What it does | Sensor | Who sees it | Status |
|---|---|---|---|---|
| Repetition detection | Flags when the same question is asked twice in a short span, which raises the memory signal | Voice | Lisa (Memory tab) | ✅ |
| Word-finding / language score | Counts fillers, "thingy" and empty words to score language concern 0–100 | Voice | Lisa | ✅ |
| Orientation check | Notices confusion about day, time or place; Pip gently says what day it is | Voice | Margaret + Lisa | ✅ |
| Memory moments | Pip asks about Margaret's own week (from recent transcripts) and scores "remembered" or "forgot"; Lisa sees the trend | Voice | Margaret + Lisa | ✅ |
| Low mood and loneliness | Pip comforts her and can tell Lisa; low-mood mentions are logged | Voice | Margaret + Lisa | ✅ |
| Withdrawal (no movement for 3 h) | Check-in on her screen; no answer in 25 s and Lisa is told ("Quiet spell, no answer") | Band | Margaret + Lisa | ✅ |
| Night wandering | Walking at night opens "Up at night?" on her screen; escalates to Lisa after 20 min | Motion | Margaret + Lisa | ✅ |
| Restless sleep | Sleep movement scored per 30 s epoch; counts restless epochs | Motion | Lisa | ✅ |
| Night mode | Turns on sleep scoring, the wandering watch, night prompts and a calm dark theme; only urgent alerts notify | App | Both | ✅ |
| Dementia signals summary | OpenAI rates cognitive, memory and language concern per transcript (signals, not diagnoses) | Voice | Lisa + doctor note | ✅ (offline rules without key) |
| Pip companion chat | Answers when she says "Pip", taps Talk, or speaks within 20 s of Pip; anything else is "heard nearby" and analysed quietly | Voice | Margaret | ✅ |
| Pip talks back out loud | Replies spoken in an ElevenLabs voice, hands-free; Deepgram Aura is the fallback; "Tap to hear Pip" if the browser blocks sound | Voice | Margaret | ✅ |
| Lisa's messages read aloud | "Read it to me" speaks Lisa's messages and on-screen prompts | App | Margaret | ✅ |

## 🏃‍♀️ Physical health: movement, falls, pills, symptoms, band

| Feature | What it does | Sensor | Who sees it | Status |
|---|---|---|---|---|
| Fall detection | Free fall, then impact, then stillness. "Did you fall?" for 20 s, then an urgent alert with Call Mom / Ruth / 911 | Motion | Both (full-screen for Lisa) | ✅ |
| Hand tremor ("Parkinson shaking") | Shaking score 0–4 from 3.5–7.5 Hz gyro power | Motion | Lisa (Physical tab) | ✅ |
| Steps and cadence | Step count, cadence and a daily step goal, with celebration | Motion | Both | ✅ |
| Balance and gait | Balance score from step regularity and sway on walks; drops on an unsteady walk | Motion | Lisa | ✅ |
| Seizure-like movement | Rhythmic 2–7 Hz shaking for 10+ s: urgent, Lisa is called | Motion | Both | ✅ |
| Pill reminders | The band glows and her screen asks "Pills taken?" | Band | Margaret | ✅ |
| Pills taken (tap the band) | A tap clears the reminder; Lisa sees "pills taken" | Band | Both | ✅ |
| Pills missed | No answer within 45 min: Lisa sees "pills not confirmed" | Band | Lisa | ✅ |
| Side effects | Nausea, dizziness and similar are logged, matched care items are suggested, and they go into the doctor note | Voice | Lisa | ✅ |
| Chest pain | Pip treats it as urgent and calls for help | Voice | Both | ✅ |
| SOS / "I need help" | Band press or the big Help button: "Mom pressed HELP", with the call chain Lisa → Ruth → 911 | Band / App | Both | ✅ |
| "Call me" double-tap | Lisa sees "Mom would like a call" | Band | Lisa | ✅ |
| Band off the wrist | Perfectly still for 2 h: "Band may be off Mom's wrist" | Band | Lisa | ✅ |
| Low battery / link lost | Margaret and Lisa are reminded to charge the band; "Band lost touch with the tablet" | Band | Both | ✅ |
| Reminders from speech | "Remind me to call the pharmacy at 10" becomes a reminder | Voice | Margaret + Lisa | ✅ |
| Note for Dr. Patel | AI drafts a clinic note from the band data and her conversations; Lisa edits it and sends it to the clinic inbox | App | Lisa → doctor | ✅ (inbox is in-memory) |
| HSA/FSA care shop | Equipment matched to what was detected (grab bars, pill organiser, etc.), paid via Stripe Checkout | App | Lisa | 🔑 Stripe key missing (demo mode) |

## 💰 Financial health: scams, exploitation, bills, spending

| Feature | What it does | Sensor | Who sees it | Status |
|---|---|---|---|---|
| Scam call detection | Grandchild-in-jail, fake bank asking for a PIN or code, prize-with-a-fee, doorstep repair pressure: an urgent "Possible scam call" alert. Pip stays quiet during the call | Voice | Lisa (+ calm banner for Margaret) | ✅ |
| Exploitation / abuse | "My nephew took my bank card…": exploitation flagged; Pip tells Lisa | Voice | Lisa | ✅ |
| Missed bills | Logged for Lisa; counts as a memory signal; Pip offers a reminder | Voice | Both | ✅ |
| Mom's safe card | Card with limits: $50 a purchase, $200 a week, no wires or crypto. Approvals and declines go to the timeline | App | Lisa (Money tab) | 🧪 simulated card (from suarezc/band39-live) |
| Scam-alert freeze | Any "Possible scam" alert freezes the card automatically; only Lisa can unfreeze it | Voice → App | Lisa | 🧪 |
| Margaret's calm frozen-card screen | "Your card is taking a short rest. You did nothing wrong." No limits, no declines, no word "scam" | App | Margaret | 🧪 |
| One-time card for care items | A card for one medical-shop order that closes itself after paying; a second charge is declined | App | Lisa | 🧪 |
| Card spend and declines in the snapshot | Spend this week, declined count and card status in the simulator's financial column | App | Simulator | ✅ |
| Real card controls | The same rules on real cards through Stripe Issuing (`experiments/cards/card_demo.py` in band39-live) | — | — | 🔑 blocked on Stripe's financial account |

---

## Shared platform (used by all three areas)

| Feature | Notes | Status |
|---|---|---|
| Two portals + landing | Margaret's portal (Today · Talk · Messages · Help) and Lisa's portal (Home · Trends · Physical · Memory · Safety · Money · Care · Circle) | ✅ |
| Always-on mic + mic button | Band mic when connected (blue LED), else the device mic. **Mic on/off button** in Margaret's header and the simulator's top bar | ✅ |
| Household sync | Margaret's device is the hub; Lisa joins with a 6-letter code (`/api/state`, `/api/actions`) | ✅ |
| AI digest + "Ask about Mom" | Calm daily summary and Q&A grounded in the logged facts (OpenAI, offline fallback) | ✅ |
| Trends tab | 30-day history, trend charts, AI "what changed" summary and a chatbot about Mom's trends | 🚧 being built |
| Severe-event alert | Full-screen urgent alert on Lisa's portal, optional phone notification + chime | ✅ |
| "?" explainer sheets | Every signal tile explains how it works, how to trigger it, and a demo | ✅ |
| Event simulator (`#/sim`) | 35 events in the three groups, sent down the real paths. Blocky voxel grandma acts each one out, with the band LED on her wrist; bracelet panel; Lisa's phone; health snapshot; "Play the day" | ✅ (3D stage 🚧) |
| Day / Night toggle | In both portals and the simulator | ✅ |
| Real band | Web Bluetooth to Vexo-HACK-39; iOS app bridge in `../band39-app` | ✅ built, not yet tested on a real band |
| Deploy | Superserve sandbox (`tools/deploy_superserve.py --update`) | ⏸ paused: trial out, needs a card |

Signals, not diagnoses. Simulated card: no real money moves.
