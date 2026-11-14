/* Vexo Companion: "A day with Margaret" scenario.
 * Pure data. Story beats follow vexo/research/03_product_directions.md §5.1 and
 * the cognitive design in 04_cognitive_deep_dive.md (cue-before-reveal, escalation
 * ladder, calm mode, nightly recap). Sensor/BLE payloads are ILLUSTRATIVE: the real
 * Vexo SDK, sample rates and packet formats still need confirmation with Vexo.
 */
(function (root) {
  // F(from, to, label, payload): one hop of data. Anchors:
  //   cube (where Margaret is), bracelet, phone, cloud, cal, mail, notion, sms, family
  const F = (from, to, label, payload) => ({ from, to, label, payload });

  const SPEAKERS = {
    margaret: { name: 'Margaret', icon: 'M', color: 'var(--violet)', side: 'left' },
    vexo: { name: 'Vexo, earbud', icon: 'V', color: 'var(--violet2)', side: 'right' },
    vexoPhone: { name: 'Vexo, phone screen', icon: 'V', color: 'var(--violet2)', side: 'right' },
    patel: { name: 'Dr. Patel', icon: 'P', color: 'var(--rest)', side: 'left' },
    caller: { name: 'Unknown caller', icon: '?', color: 'var(--safety)', side: 'left' },
    joan: { name: 'Joan (neighbor)', icon: 'J', color: 'var(--social)', side: 'left' },
    lisa: { name: 'Lisa (daughter)', icon: 'L', color: 'var(--family)', side: 'left' },
    neighbor: { name: 'Neighbor', icon: 'N', color: 'var(--activity)', side: 'left' },
    narrator: { name: '', icon: '', color: 'transparent', side: 'center' },
  };

  const CATS = {
    rest: { label: 'Rest & routine', color: '#6C8BD8' },
    health: { label: 'Health', color: '#3FB3A3' },
    memory: { label: 'Memory', color: '#8B6CF0' },
    social: { label: 'Social', color: '#F2A65A' },
    safety: { label: 'Safety', color: '#E8646A' },
    activity: { label: 'Activity', color: '#73BF5F' },
    family: { label: 'Family', color: '#EE7DB0' },
  };

  const STAGES = {
    mci: { label: 'Mild cognitive impairment', short: 'MCI', note: 'Mostly independent. Vexo gives light cues and lets her do the remembering.' },
    mild: { label: "Early Alzheimer's", short: 'Early AD', note: 'Prompts escalate step by step. Cue before reveal. Family gets summaries.' },
    moderate: { label: "Moderate Alzheimer's", short: 'Moderate AD', note: 'More direct answers, picture cues, and earlier soft flags to family.' },
  };

  const METRICS = [
    { key: 'meds', icon: '💊', label: 'Medications taken correctly', of: 2, good: 'high' },
    { key: 'instr', icon: '🩺', label: "Doctor's instructions remembered", of: 3, good: 'high' },
    { key: 'lost', icon: '🛡️', label: 'Money lost to scams', money: true, good: 'low' },
    { key: 'calls', icon: '📞', label: 'Worried calls to Lisa at work', good: 'low' },
    { key: 'alone', icon: '😟', label: 'Confused moments, alone', good: 'low' },
    { key: 'family', icon: '💌', label: 'Updates & messages shared with family', good: 'high' },
  ];

  const SEED_MEMORY = [
    { id: 'margaret', type: 'self', label: 'Margaret', quote: 'Wearer · 78 · lives alone' },
    { id: 'lisa', type: 'person', label: 'Lisa', quote: 'Daughter · lives 400 mi away · added at onboarding' },
    { id: 'ethan', type: 'person', label: 'Ethan', quote: 'Grandson · plays soccer · added at onboarding' },
    { id: 'lisinopril', type: 'med', label: 'Lisinopril', quote: 'Blood pressure · 10 mg every morning · added by Lisa at onboarding' },
  ];

  const EVENTS = [
    {
      id: 'wake', time: '07:00', title: 'Wake up', icon: '🌅', cat: 'rest', place: 'Home', emote: '😴',
      summary: 'Orientation each morning: what day it is and what is coming up.',
      beats: [
        { say: ['narrator', 'Margaret sits up in bed. The motion sensor notices she is awake, and last night’s sleep gets summarized.'],
          sensors: ['acc', 'hr', 'temp'],
          flows: [F('bracelet', 'phone', '😴 sleep batch', { kind: 'sensor_batch', window: '22:30–07:00', accel: 'activity counts @25 Hz → 1/min', hr_bpm: '58–64', skin_temp_c: 33.1 }),
                  F('phone', 'cloud', '📈 sleep summary', { sleep_h: 6.7, night_wakes: 2, vs_baseline: '-0.4 h' })] },
        { say: ['vexo', 'Good morning, Margaret. It’s Thursday, November 13th. You see Dr. Patel at 10:30, and Lisa calls at 7 tonight.'],
          haptic: 1, level: 'L1',
          flows: [F('cloud', 'phone', '🗓 today', { orientation: { day: 'Thu Nov 13', next: ['Dr. Patel 10:30', 'Lisa call 19:00'] } })] },
        { say: ['margaret', 'Thursday… the doctor. Good. Thank you.'] },
      ],
      without: {
        beats: [{ say: ['narrator', 'Margaret wakes up unsure what day it is. She checks the wall calendar and still can’t tell whether the doctor is today.'] }],
      },
      impact: { with: {}, without: { alone: 1 } },
    },
    {
      id: 'meds', time: '08:00', title: 'Morning pills', icon: '💊', cat: 'health', place: 'Kitchen', emote: '💊',
      summary: 'Escalating reminders confirmed by her voice and hand motion, not a button press.',
      beats: [
        { say: ['vexo', 'Time for your lisinopril, the white pill in the blue box.'], haptic: 1, level: 'L1',
          flows: [F('cloud', 'phone', '⏰ med schedule', { reminder: 'lisinopril 10mg', due: '08:00', policy: 'escalation_ladder' })] },
        { at: '08:15', skip: ['mci'], say: ['narrator', '08:15: no “took it” and no hand-to-mouth motion. Vexo tries again with simpler words.'], sensors: ['acc'] },
        { skip: ['mci'], say: ['vexo', 'Pill time. Blue box, kitchen counter.'], haptic: 1, level: 'L1' },
        { only: ['moderate'], at: '08:16', say: ['vexoPhone', '📷 The phone shows a photo of the blue pill box: “Take 1 white pill.”'], level: 'L1',
          flows: [F('cloud', 'phone', '🖼 picture cue', { card: 'photo_pillbox', text: 'Take 1 white pill' })] },
        { at: '08:17', say: ['margaret', 'Took it!'], sensors: ['mic', 'acc'], haptic: 2, level: 'L2',
          flows: [F('bracelet', 'phone', '✋ hand-to-mouth', { kind: 'event', motion: 'hand_to_mouth', conf: 0.86, voice: '“took it”' }),
                  F('phone', 'cloud', '✅ dose logged', { med: 'lisinopril 10mg', status: 'taken', at: '08:17', evidence: ['voice', 'motion'] })],
          mem: [{ id: 'lisinopril', type: 'med', label: 'Lisinopril', quote: '“Took it!”, 08:17 (voice + motion)' }] },
        { flows: [F('cloud', 'family', '💊 meds update', { push: 'Morning meds taken', at: '08:17' })],
          family: { cat: 'meds', icon: '💊', title: 'Morning meds taken', body: 'Lisinopril at 8:17 AM, confirmed by voice and motion.' },
          actions: [{ icon: '💊', text: 'Dose logged 08:17' }] },
      ],
      without: {
        beats: [{ say: ['narrator', 'No reminder. Margaret walks past the blue box twice. By noon she can’t remember whether she took it, so she skips it.'] }],
      },
      impact: { with: { meds: 1, family: 1 }, without: {} },
    },
    {
      id: 'breakfast', time: '09:00', title: 'Breakfast · “Did I already…?”', icon: '🥣', cat: 'memory', place: 'Kitchen', emote: '❓',
      summary: 'Repeated questions answered from her own day, with a source.',
      beats: [
        { say: ['margaret', 'Did I take my pill this morning?'], sensors: ['mic'],
          flows: [F('bracelet', 'phone', '🎙 audio 3s', { kind: 'audio_chunk', ms: 3000, codec: 'opus 16 kbps', vad: true }),
                  F('phone', 'cloud', '❓ did-I-already', { intent: 'did_i_already', query: 'take pill', transcript_only: true })] },
        { say: ['vexo', 'Yes. You took your lisinopril at 8:17. You said, “Took it!”'], level: 'L1',
          flows: [F('cloud', 'phone', '💬 answer + source', { answer: 'yes', source: { at: '08:17', quote: 'Took it!' } })] },
        { say: ['narrator', 'The answer cites its source, so there is no guessing. Lisa doesn’t get a worried call at work.'] },
      ],
      without: {
        beats: [
          { say: ['margaret', 'Lisa? Did I take my pill this morning?'] },
          { say: ['lisa', 'Mom, I’m in a meeting… I don’t know. Check the box?'],
            family: { cat: 'alerts', icon: '📞', title: 'Mom called (during meeting)', body: '“Did I take my pill?” Her third call like that this week.', without: true } },
        ],
      },
      impact: { with: {}, without: { calls: 1 } },
    },
    {
      id: 'doctor', time: '10:30', title: 'Cardiology visit · Dr. Patel', icon: '🩺', cat: 'health', place: 'Clinic', emote: '🩺',
      summary: 'Instructions captured, turned into calendar events, reminders, and a summary for Lisa.',
      beats: [
        { say: ['vexoPhone', 'Visit mode: “Is it OK if Margaret’s Vexo takes notes for her today?”'], level: 'L3' },
        { say: ['patel', 'Of course. Margaret, start metoprolol, 25 milligrams every morning. Blood test in two weeks. Come back in six weeks.'], sensors: ['mic'],
          flows: [F('bracelet', 'phone', '🎙 audio 5s ×9', { kind: 'audio_chunk', ms: 5000, chunks: 9, codec: 'opus 16 kbps', link: 'BLE 5 LE, AES-CCM' })] },
        { say: ['narrator', 'The phone transcribes and deletes the raw audio. Only text goes to the Vexo cloud.'],
          flows: [F('phone', 'cloud', '📝 transcript', { transcript_chars: 1240, speakers: 2, raw_audio: 'deleted after STT' })] },
        { say: ['narrator', 'The agent pulls out structured facts, each linked to the exact quote it came from.'],
          flows: [F('cloud', 'cloud', '🧠 extract', { medications: [{ name: 'metoprolol', dose: '25 mg', freq: 'every morning', source: '“start metoprolol, 25 milligrams every morning”' }], appointments: [{ type: 'blood test', due: 'Thu Nov 27' }, { type: 'follow-up', due: 'Tue Dec 23' }] })],
          mem: [
            { id: 'patel', type: 'person', label: 'Dr. Patel', quote: 'Cardiologist · met 10:30 today' },
            { id: 'metoprolol', type: 'med', label: 'Metoprolol', quote: '“start metoprolol, 25 milligrams every morning”' },
            { id: 'labtest', type: 'appt', label: 'Blood test · Nov 27', quote: '“Blood test in two weeks”' },
            { id: 'followup', type: 'appt', label: 'Follow-up · Dec 23', quote: '“Come back in six weeks”' },
          ] },
        { say: ['vexo', 'Got it. I saved Dr. Patel’s instructions and added two appointments.'], haptic: 2, level: 'L2',
          flows: [F('cloud', 'cal', '📅 2 events', { events: ['Blood test · Thu Nov 27 9:00', 'Cardiology follow-up · Tue Dec 23'] }),
                  F('cloud', 'notion', '📓 care binder', { page: 'Visits / 2026-11-13 Dr. Patel', blocks: 6 }),
                  F('cloud', 'mail', '✉️ visit summary', { to: 'lisa@…', subject: 'Mom’s cardiology visit: summary', contains: 'summary, not transcript' }),
                  F('mail', 'family', '✉️ to Lisa', { delivered: true })],
          actions: [{ icon: '📅', text: 'Blood test · Nov 27' }, { icon: '📅', text: 'Follow-up · Dec 23' }, { icon: '💊', text: 'Metoprolol reminder · daily 8 AM' }, { icon: '📓', text: 'Care binder updated' }, { icon: '✉️', text: 'Summary emailed to Lisa' }],
          family: { cat: 'appts', icon: '🩺', title: 'Visit summary · Dr. Patel', body: 'New: metoprolol 25 mg every morning (starts tomorrow). Blood test Nov 27. Follow-up Dec 23. Added to Mom’s calendar.' } },
      ],
      without: {
        beats: [{ say: ['narrator', 'Margaret nods along. By the time she reaches the parking lot she remembers “a new pill,” but not the dose and not the blood test. (Patients forget 40–80% of what clinicians tell them.)'] }],
      },
      impact: { with: { instr: 3, family: 1 }, without: { instr: 1 } },
    },
    {
      id: 'lunch', time: '12:30', title: 'Lunch with Joan', icon: '🥪', cat: 'social', place: 'Joan’s porch', emote: '😊',
      summary: 'Names, relationships, and promises saved quietly, without interrupting the conversation.',
      beats: [
        { say: ['joan', 'Your roses look lovely! Emily’s coming home for Thanksgiving.'], sensors: ['mic'] },
        { say: ['margaret', 'Oh, wonderful! I’ll bring you tomatoes on Saturday.'], sensors: ['mic'], level: 'L0',
          flows: [F('bracelet', 'phone', '🎙 conversation', { kind: 'audio_chunk', minutes: 38, diarized_speakers: 2 }),
                  F('phone', 'cloud', '👥 people + promise', { people: [{ name: 'Joan', rel: 'neighbor', topics: ['roses', 'daughter Emily → Thanksgiving'] }], commitments: [{ what: 'bring Joan tomatoes', due: 'Sat 10:00', source: '“I’ll bring you tomatoes on Saturday”' }] })],
          mem: [
            { id: 'joan', type: 'person', label: 'Joan', quote: 'Neighbor · roses · daughter Emily home for Thanksgiving' },
            { id: 'tomatoes', type: 'promise', label: 'Tomatoes → Joan (Sat)', quote: '“I’ll bring you tomatoes on Saturday”' },
          ] },
        { say: ['vexo', '(after Joan leaves) Saved: tomatoes for Joan on Saturday.'], haptic: 2, level: 'L2',
          actions: [{ icon: '⏰', text: 'Reminder · Sat 10:00 tomatoes for Joan' }] },
        { say: ['narrator', 'Vexo held its prompt until the conversation ended. It doesn’t interrupt unless something is urgent.'] },
      ],
      without: {
        beats: [{ say: ['narrator', 'A lovely lunch. By Saturday the promise is gone, and Joan waits for tomatoes that never come.'] }],
      },
      impact: { with: {}, without: {} },
    },
    {
      id: 'scam', time: '14:00', title: 'Phone call from “Ethan”', icon: '📞', cat: 'safety', place: 'Living room', emote: '😰',
      summary: 'A scam script recognized in real time: 3 long pulses and Lisa alerted.',
      beats: [
        { say: ['caller', 'Grandma, it’s me, Ethan. I’m in trouble and I need $2,000 in gift cards. Please don’t tell Mom.'], sensors: ['mic'],
          flows: [F('bracelet', 'phone', '🎙 live stream', { kind: 'audio_stream', mode: 'realtime', window: '10 s rolling' })] },
        { say: ['narrator', 'The scam classifier on the phone checks a rolling 10-second window.'],
          flows: [F('phone', 'cloud', '🚩 risk 0.94', { signals: ['gift cards', 'urgency', 'secrecy', 'family impersonation'], score: 0.94, threshold: 0.8 })] },
        { say: ['vexo', 'This sounds like a scam. Hang up, and I can call Lisa for you.'], haptic: 3, level: 'L4' },
        { say: ['margaret', 'I’m going to hang up now.'],
          flows: [F('cloud', 'sms', '💬 SMS alert', { to: 'Lisa', text: 'Possible scam call to Mom blocked 2:03 PM' }),
                  F('sms', 'family', '🛡️ alert', { priority: 'high' })],
          family: { cat: 'alerts', icon: '🛡️', title: 'Scam call blocked', body: '2:03 PM. “Grandson in jail” script asking for $2,000 in gift cards. Mom hung up.' },
          mem: [{ id: 'scamcall', type: 'episode', label: 'Scam call blocked', quote: 'Caller claimed to be Ethan · gift cards · 14:03' }],
          actions: [{ icon: '🛡️', text: 'Scam warning · 3 long pulses' }, { icon: '💬', text: 'Lisa alerted by SMS' }] },
      ],
      without: {
        beats: [
          { say: ['caller', 'Grandma, it’s me, Ethan. I need $2,000 in gift cards. Please don’t tell Mom.'] },
          { say: ['narrator', 'Scared for Ethan, Margaret drives to the pharmacy and buys $2,000 in gift cards. (People 60+ reported $4.9B in fraud losses in 2024.)'] },
        ],
      },
      impact: { with: { family: 1 }, without: { lost: 2000 } },
    },
    {
      id: 'walk', time: '15:00', title: 'Afternoon walk', icon: '🚶', cat: 'activity', place: 'Elm Street', emote: '🌳',
      summary: 'Steps and routes tracked. A gentle wayfinding cue when she drifts off her usual route.',
      beats: [
        { say: ['narrator', 'Margaret heads out on her usual loop.'], sensors: ['acc', 'hr'],
          flows: [F('bracelet', 'phone', '🏃 activity batch', { kind: 'sensor_batch', steps: 1840, cadence_spm: 96, hr_avg: 88 })] },
        { only: ['mci'], say: ['narrator', 'She finishes the loop without help. Vexo stays quiet and just logs the walk.'] },
        { skip: ['mci'], say: ['narrator', 'At the corner of Elm Street she stops, turns twice, and heads the wrong way, off her usual route.'], sensors: ['acc'],
          flows: [F('phone', 'cloud', '🧭 off-route', { gps: 'off usual route by 180 m', pause_s: 45, heading_changes: 3 })] },
        { skip: ['mci'], say: ['vexo', 'You’re on Elm Street. Home is back to the left, past the blue mailbox.'], haptic: 1, level: 'L1' },
        { only: ['moderate'], say: ['narrator', 'At this stage, Lisa’s location sharing turns on automatically because Margaret left her usual route.'], level: 'L4',
          flows: [F('cloud', 'family', '📍 location', { share: 'temporary', reason: 'off usual route', expires: 'when home' })],
          family: { cat: 'location', icon: '📍', title: 'Mom went off her usual route', body: 'Elm St, 3:12 PM. Wayfinding cue given. She’s heading home now.' } },
        { skip: ['mci'], say: ['margaret', 'Blue mailbox… yes, there it is.'] },
        { at: '15:40', say: ['narrator', 'Home again: 2,340 steps.'],
          mem: [{ id: 'walk', type: 'episode', label: 'Walk · Elm St', quote: '2,340 steps · 15:00–15:40' }] },
      ],
      without: {
        beats: [{ say: ['narrator', 'At Elm Street she turns the wrong way and walks for 20 minutes until a neighbor recognizes her and drives her home, shaken.'] },
                { say: ['neighbor', 'Margaret? You’re a long way from home. Hop in.'] }],
      },
      impact: { with: {}, without: { alone: 1 } },
    },
    {
      id: 'recall', time: '16:00', title: '“Who was that doctor?”', icon: '🧠', cat: 'memory', place: 'Armchair', emote: '🤔',
      summary: 'Cue before reveal: the least help that works keeps her memory in use.',
      beats: [
        { say: ['margaret', 'Who was that man this morning? The doctor?'], sensors: ['mic'],
          flows: [F('bracelet', 'phone', '🎙 audio 2s', { kind: 'audio_chunk', ms: 2000 }),
                  F('phone', 'cloud', '🔎 who-was', { intent: 'who_was', when: 'this morning', policy: 'cue_before_reveal' })] },
        { skip: ['moderate'], say: ['vexo', 'It was at the heart doctor’s office.'], level: 'L1' },
        { skip: ['moderate'], say: ['margaret', 'Oh… what was his name?'] },
        { skip: ['moderate'], say: ['vexo', 'It starts with “P”…'], level: 'L1' },
        { skip: ['moderate'], say: ['margaret', 'Patel! Dr. Patel. He gave me a new pill.'], haptic: 2 },
        { only: ['moderate'], say: ['vexo', 'That was Dr. Patel, your heart doctor. He started you on a new morning pill.'], level: 'L1',
          flows: [F('cloud', 'phone', '💬 full answer', { answer: 'Dr. Patel, cardiologist', source: '10:30 visit', reason: 'late day + stage → direct answer' })] },
        { say: ['narrator', 'Vexo gives a context clue, then a partial cue, then the full answer. Late in the day, or at later stages, it answers directly.'] },
      ],
      without: {
        beats: [{ say: ['narrator', 'She can’t place him, and it frightens her. She calls Lisa again, the second time today.'],
                  family: { cat: 'alerts', icon: '📞', title: 'Mom called again', body: '“Who was the doctor this morning?” She sounded upset.', without: true } }],
      },
      impact: { with: {}, without: { calls: 1 } },
    },
    {
      id: 'message', time: '17:30', title: 'A message to Lisa', icon: '💌', cat: 'family', place: 'Kitchen', emote: '💌',
      summary: 'Two-way family messages: speak to send, and replies arrive as a gentle pulse plus a voice.',
      beats: [
        { say: ['margaret', 'Vexo, tell Lisa I loved the photos from Ethan’s game.'], sensors: ['mic'], level: 'L3',
          flows: [F('bracelet', 'phone', '🎙 voice note', { kind: 'audio_chunk', intent: 'send_message', to: 'Lisa' })] },
        { say: ['vexo', 'Send to Lisa: “I loved the photos from Ethan’s game”? Tap twice to send.'], haptic: 1, level: 'L3' },
        { say: ['narrator', 'The motion sensor picks up her double tap on the band.'], sensors: ['acc'],
          flows: [F('bracelet', 'phone', '👆 double-tap', { kind: 'gesture', type: 'double_tap', conf: 0.97 }),
                  F('phone', 'cloud', '💌 message', { msg: 'I loved the photos from Ethan’s game ❤️', voice_note_s: 4 }),
                  F('cloud', 'family', '💌 to Lisa', { push: 'Message from Mom' })],
          family: { cat: 'messages', icon: '💌', title: 'Message from Mom', body: '“I loved the photos from Ethan’s game ❤️” (voice note, 0:04)' } },
        { say: ['lisa', 'Love you, Mom! I’m visiting Saturday 🌷'],
          flows: [F('family', 'cloud', '💬 reply', { from: 'Lisa', msg: 'Love you, Mom! I’m visiting Saturday 🌷' }),
                  F('cloud', 'cloud', '🧠 extract', { commitments: [{ who: 'Lisa', what: 'visit', due: 'Sat' }] }),
                  F('cloud', 'phone', '🔈 read aloud', { tts: true, haptic: '1x' })],
          mem: [{ id: 'lisavisit', type: 'promise', label: 'Lisa visits (Sat)', quote: 'Lisa: “I’m visiting Saturday 🌷”' }] },
        { say: ['vexo', 'Lisa says: “Love you, Mom! I’m visiting Saturday.” I’ll remind you Saturday morning.'], haptic: 1, level: 'L2' },
      ],
      without: {
        beats: [{ say: ['narrator', 'Margaret wants to text Lisa about the photos, but the tiny keyboard defeats her. By dinner the thought is gone.'] }],
      },
      impact: { with: { family: 2 }, without: {} },
    },
    {
      id: 'dinner', time: '18:30', title: 'Dinner · late-day restlessness', icon: '🍲', cat: 'rest', place: 'Kitchen', emote: '😣',
      summary: 'Sundowning detected from heart rate and pacing. Calm mode: fewer prompts, shorter words.',
      beats: [
        { say: ['narrator', 'Late afternoon is hard for many people with Alzheimer’s (“sundowning”). Her heart rate is 22% above baseline and she’s pacing.'], sensors: ['hr', 'acc'],
          flows: [F('bracelet', 'phone', '❤️ HR + motion', { hr_bpm: 96, baseline: 79, motion: 'pacing', minutes: 12 }),
                  F('phone', 'cloud', '🌀 agitation', { state: 'agitated', policy: 'calm_mode', non_urgent_prompts: 'held' })] },
        { say: ['vexo', 'You’re at home, Margaret, and everything is okay. Lisa calls at 7. Shall we put the kettle on?'], haptic: 1, level: 'L1' },
        { say: ['margaret', 'Tea would be nice.'] },
        { only: ['moderate'], say: ['narrator', 'At this stage, a gentle note goes to Lisa’s trends. It isn’t an alarm.'],
          flows: [F('cloud', 'family', '📈 soft flag', { kind: 'trend', severity: 'low' })],
          family: { cat: 'trends', icon: '📈', title: 'Restless early evening', body: 'About 12 min of pacing around 6:30 PM. She settled after tea. Third evening this week.' } },
        { at: '18:50', say: ['narrator', 'Ten minutes later her heart rate is back near baseline. Calm mode ends.'], sensors: ['hr'] },
      ],
      without: {
        beats: [{ say: ['narrator', 'Margaret paces the kitchen, anxious and unsure why. Dinner goes cold. Nobody knows.'] }],
      },
      impact: { with: {}, without: { alone: 1 } },
    },
    {
      id: 'call', time: '19:00', title: 'Video call with Lisa', icon: '📱', cat: 'family', place: 'Living room', emote: '🥰',
      summary: 'Lisa already knows the day, so the call is about life, not logistics.',
      beats: [
        { say: ['lisa', 'Mom! I heard Dr. Patel started you on a new pill. How are the roses?'] },
        { say: ['vexo', '(quietly) Topics you saved: tomatoes for Joan on Saturday.'], level: 'L1' },
        { say: ['margaret', 'Joan loved them! I’m bringing her tomatoes on Saturday, and you’re visiting too!'] },
        { say: ['narrator', 'Lisa read summaries, not transcripts, and Margaret chose what to share. The call feels like family, not a check-up.'] },
      ],
      without: {
        beats: [{ say: ['lisa', 'Did you take your pills? What did the doctor say? Did you eat?'] },
                { say: ['narrator', 'The call turns into a quiz. Margaret feels tested and gets upset. Both hang up worried.'] }],
      },
      impact: { with: {}, without: {} },
    },
    {
      id: 'recap', time: '20:30', title: 'Evening recap · bedtime pill', icon: '🌙', cat: 'memory', place: 'Bedroom', emote: '📖',
      summary: 'A 2-minute “Today you…” recap, spaced recall practice, and the bedtime dose.',
      beats: [
        { say: ['vexo', 'Today you saw Dr. Patel, had lunch with Joan, and walked to Elm Street. Joan’s daughter Emily is coming for Thanksgiving.'], haptic: 1, level: 'L1' },
        { say: ['vexo', 'Who’s visiting you on Saturday?'], level: 'L1' },
        { say: ['margaret', 'Lisa!'], haptic: 2 },
        { say: ['vexo', 'And it’s time for donepezil, the small yellow pill.'], level: 'L1' },
        { at: '20:41', say: ['margaret', 'Took it.'], sensors: ['mic', 'acc'], haptic: 2, level: 'L2',
          flows: [F('bracelet', 'phone', '✋ hand-to-mouth', { kind: 'event', motion: 'hand_to_mouth', conf: 0.91 }),
                  F('phone', 'cloud', '✅ dose logged', { med: 'donepezil 10mg', status: 'taken', at: '20:41' })],
          mem: [{ id: 'donepezil', type: 'med', label: 'Donepezil', quote: 'Bedtime · “Took it.” 20:41' }],
          actions: [{ icon: '💊', text: 'Donepezil logged 20:41' }] },
      ],
      without: {
        beats: [{ say: ['narrator', 'She takes her bedtime pill. Ten minutes later, unsure, she takes another one.'] }],
      },
      impact: { with: { meds: 1 }, without: {} },
    },
    {
      id: 'sleep', time: '21:30', title: 'Charge band · daily digest', icon: '🔋', cat: 'rest', place: 'Bedside', emote: '🔋',
      summary: 'The band charges as part of the bedtime routine. Lisa gets one calm daily digest.',
      beats: [
        { say: ['narrator', 'The band goes on the charger at bedtime. Tying charging to a routine means it doesn’t get forgotten.'], sensors: ['ble'],
          flows: [F('bracelet', 'phone', '🔄 sync', { kind: 'sync', battery: '34% → charging', backlog: 'uploaded' })] },
        { say: ['narrator', 'Lisa’s daily digest goes out, built only from the categories Margaret chose to share.'],
          flows: [F('cloud', 'mail', '📋 digest', { kind: 'daily_digest', format: 'summary', transcripts: false }),
                  F('mail', 'family', '📋 to Lisa', { delivered: true })],
          family: { cat: 'digest', dynamic: 'digest' },
          actions: [{ icon: '📋', text: 'Daily digest sent to Lisa' }] },
        { say: ['lisa', '(reading) Meds done, scam blocked, lunch with Joan… Okay. She had a good day.'] },
      ],
      without: {
        beats: [{ say: ['narrator', 'Lisa lies awake wondering how Mom’s day really went. She thinks about moving her into assisted living.'] }],
      },
      impact: { with: { family: 1 }, without: {} },
    },
    {
      id: 'night', time: '02:40', title: 'Night wake', icon: '🌌', cat: 'safety', place: 'Hallway', emote: '🚪',
      summary: 'Night motion toward the door: a gentle redirect first, escalating to family only if the door opens.',
      beats: [
        { say: ['narrator', '2:40 AM: motion out of bed, heading toward the front door.'], sensors: ['acc', 'hr'],
          flows: [F('bracelet', 'phone', '🌙 night motion', { motion: 'walking', path: 'bed → hallway → front door', hr_bpm: 84 })] },
        { say: ['vexo', 'It’s the middle of the night, Margaret, and it’s dark outside. Let’s go back to bed.'], haptic: 1, level: 'L1' },
        { say: ['margaret', 'Oh… right. Bed.'] },
        { only: ['moderate'], say: ['narrator', 'At this stage the night wake is shared with Lisa in the morning. If the door had opened, Lisa’s phone would ring right away (L4).'],
          flows: [F('cloud', 'family', '🌙 morning note', { deliver_at: '07:30', severity: 'low' })],
          family: { cat: 'trends', icon: '🌙', title: 'Night wake at 2:40 AM', body: 'Walked toward the front door and went back to bed after one prompt. Door stayed closed.' } },
        { say: ['narrator', 'She goes back to bed. No alarm was needed, and the night wake is logged for the weekly trend.'],
          flows: [F('phone', 'cloud', '📈 trend', { night_wakes: 1, door: 'not opened', week_trend: 'night activity ↑ 2 of 7 nights' })] },
      ],
      without: {
        beats: [{ say: ['narrator', 'She unlocks the front door and steps out into the cold, confused. (6 in 10 people with dementia wander at least once.)'] }],
      },
      impact: { with: {}, without: { alone: 1 } },
    },
  ];

  const SCENARIO = {
    persona: { name: 'Margaret', age: 78, condition: "Early-stage Alzheimer's", home: 'Lives alone', family: 'Daughter Lisa lives 400 miles away' },
    start: '06:45', end: '03:30', date: 'Thursday, Nov 13',
    speakers: SPEAKERS, cats: CATS, stages: STAGES, metrics: METRICS, seedMemory: SEED_MEMORY, events: EVENTS,
  };

  root.VEXO_SCENARIO = SCENARIO;
  if (typeof module !== 'undefined') module.exports = SCENARIO;
})(typeof window !== 'undefined' ? window : globalThis);
