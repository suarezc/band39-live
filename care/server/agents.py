"""AI agents for Band 39 (OpenAI Responses API, strict JSON schemas, store=false).

pip(said, context, history)   Pip, Margaret's companion: a short spoken reply + actions the app runs
recall_question(notes)        a gentle memory question drawn from her own recent conversations
recall_score(q, hint, answer) remembered / partial / forgot, with a kind reply
ask(question, facts)          Lisa asks about Mom; answered only from the logged facts
digest(facts)                 "Today with Mom": physical / memory / safety / care + one suggestion
doctor_draft(facts)           a clinician-facing note (SOAP-style) Lisa can edit and send

Every agent has an offline fallback so the app keeps working without a key. Outputs are signals
for family and clinicians, never diagnoses.
"""
import json, re

MODEL_DEFAULT = 'gpt-6-luna'


def _obj(props, required=None):
    return {'type': 'object', 'additionalProperties': False, 'required': required or list(props), 'properties': props}


S = lambda d='': {'type': 'string', 'description': d} if d else {'type': 'string'}

PIP_SCHEMA = _obj({
    'reply': S('What Pip says out loud: 1-2 short, warm, simple sentences. No medical advice beyond "let\'s ask Lisa / Dr. Patel".'),
    'actions': {'type': 'array', 'items': _obj({
        'type': {'type': 'string', 'enum': ['set_reminder', 'tell_lisa', 'scam_guard', 'need_help', 'log', 'none']},
        'text': S('Reminder text, message to Lisa, scam reason, or thing to log.'),
        'when': S('Time words for reminders, e.g. "tomorrow 10 am"; otherwise "".'),
    })},
    'mood': {'type': 'string', 'enum': ['calm', 'happy', 'worried', 'sleepy']},
})
RECALL_Q_SCHEMA = _obj({'question': S('One short, kind question about something she said earlier.'), 'hint': S('The expected answer, short.')})
RECALL_SCORE_SCHEMA = _obj({'result': {'type': 'string', 'enum': ['remembered', 'partial', 'forgot']}, 'reply': S('One warm sentence; if she forgot, gently tell her the answer.')})
ASK_SCHEMA = _obj({'answer': S('2-4 sentences for Lisa, only from the facts. Say plainly when the facts do not cover it.'),
                   'based_on': {'type': 'array', 'items': S()}})
DIGEST_SCHEMA = _obj({'headline': S('One calm sentence.'), 'physical': S(), 'memory': S(), 'safety': S(), 'care': S(),
                      'suggestion': S('One concrete thing Lisa could do today.')})
DOCTOR_SCHEMA = _obj({'subjective': S('What Margaret reported, quoted briefly.'), 'objective': S('Band measurements with numbers and times.'),
                      'assessment': S('Signals worth review, phrased as possibilities, not diagnoses.'), 'plan': S('Suggested follow-ups for the clinician to consider.')})

PIP_INSTRUCTIONS = (
    "You are Pip, a small friendly companion on the screen of Margaret, 78, who lives alone with early memory changes. "
    "Her daughter Lisa is her caregiver; Ruth is the neighbour; Dr. Patel is her doctor. Speak to Margaret in 1-2 short, warm, "
    "plain sentences (she may hear them read aloud). Use the context (time, day or night mode, next pill, recent messages). "
    "Choose actions only when clearly needed: set_reminder if she asks to be reminded or mentions an appointment/call; "
    "tell_lisa if she wants Lisa to know something or mentions a health worry; scam_guard if someone asked for money, gift cards, "
    "card/bank/Medicare numbers or tells an urgent family-trouble story (tell her not to pay and that Lisa will call); "
    "need_help if she says she fell, is hurt, can't get up, or asks for help; log for meals, water, mood, pain. At night, gently "
    "encourage rest. Never diagnose or change medicines."
)


def _call(post, key, model, instructions, payload, schema, name):
    body = {'model': model or MODEL_DEFAULT, 'store': False, 'instructions': instructions, 'input': json.dumps(payload)[:12000],
            'text': {'format': {'type': 'json_schema', 'name': name, 'strict': True, 'schema': schema}}}
    code, raw = post('https://api.openai.com/v1/responses', json.dumps(body).encode(), {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    if code != 200:
        raise RuntimeError('OpenAI status %d' % code)
    data = json.loads(raw)
    text = ''.join(p.get('text', '') for it in data.get('output', []) for p in (it.get('content') or []) if p.get('type') == 'output_text')
    out = json.loads(text); out['source'] = 'openai'
    return out


def _run(post, key, model, instructions, payload, schema, name, fallback):
    if key and post:
        try:
            return _call(post, key, model, instructions, payload, schema, name)
        except Exception as e:
            out = fallback(); out['source'] = 'rules (%s)' % str(e)[:50]; return out
    out = fallback(); out['source'] = 'rules'; return out


# ---- fallbacks -------------------------------------------------------------------------
def _pip_rules(said, ctx):
    t = said.lower(); acts = []
    if re.search(r'gift ?cards?|bail|wire money|medicare (number|card)|bank (details|account)|social security', t):
        acts.append({'type': 'scam_guard', 'text': 'Someone asked for money or private numbers.', 'when': ''})
        return {'reply': "That sounds like a trick, Margaret. Please don't pay anyone. I've told Lisa and she'll call you.", 'actions': acts, 'mood': 'worried'}
    if re.search(r"\bi fell\b|can'?t get up|help me|i'?m hurt", t):
        return {'reply': "I'm calling Lisa right now. Stay where you are if you can.", 'actions': [{'type': 'need_help', 'text': said[:120], 'when': ''}], 'mood': 'worried'}
    m = re.search(r'remind me to (.+?)(?: at | on | tomorrow|$)(.*)', t)
    if m:
        acts.append({'type': 'set_reminder', 'text': m.group(1).strip().capitalize(), 'when': m.group(2).strip()})
        return {'reply': "Of course. I'll remind you to %s." % m.group(1).strip(), 'actions': acts, 'mood': 'happy'}
    if re.search(r'tell lisa|let lisa know', t):
        return {'reply': "I'll tell Lisa.", 'actions': [{'type': 'tell_lisa', 'text': said[:200], 'when': ''}], 'mood': 'happy'}
    night = ctx.get('mode') == 'night'
    return {'reply': "It's night-time. Let's rest; I'm keeping watch." if night else "Thank you for telling me, Margaret. I'm right here.", 'actions': [], 'mood': 'sleepy' if night else 'calm'}


def pip(said, ctx, history, key=None, model=None, post=None):
    payload = {'margaret_said': said[:1500], 'context': ctx, 'recent_conversation': history[-6:]}
    return _run(post, key, model, PIP_INSTRUCTIONS, payload, PIP_SCHEMA, 'pip', lambda: _pip_rules(said, ctx))


def recall_question(notes, key=None, model=None, post=None):
    def fb():
        return {'question': 'What did you have for breakfast today?', 'hint': ''} if not notes else {'question': 'Earlier you told me something. Can you remember what it was about?', 'hint': notes[-1][:80]}
    ins = ("Make one gentle memory question for Margaret (78, early memory changes) about a concrete detail she said in the notes "
           "(a name, food, place, plan). Never a trick question. Give the expected answer as hint.")
    return _run(post, key, model, ins, {'notes': notes[-6:]}, RECALL_Q_SCHEMA, 'recall_q', fb)


def recall_score(question, hint, answer, key=None, model=None, post=None):
    def fb():
        a, h = set(re.findall(r'[a-z]+', answer.lower())), set(re.findall(r'[a-z]{4,}', hint.lower()))
        hit = len(a & h) / (len(h) or 1)
        res = 'remembered' if hit >= 0.5 else 'partial' if hit > 0 else ('forgot' if h else 'partial')
        return {'result': res, 'reply': 'Well remembered!' if res == 'remembered' else ('Close! It was %s.' % hint if hint else 'Thank you for sharing.')}
    ins = "Judge if Margaret's answer matches the expected answer (meaning, not exact words). Be kind; if she forgot, gently tell her."
    return _run(post, key, model, ins, {'question': question, 'expected': hint, 'answer': answer}, RECALL_SCORE_SCHEMA, 'recall_score', fb)


def ask(question, facts, key=None, model=None, post=None):
    def fb():
        return {'answer': 'The AI helper is offline. Here is what is logged: ' + '; '.join(facts.get('timeline', [])[:5]), 'based_on': ['timeline']}
    ins = ("Lisa is asking about her mother Margaret. Answer ONLY from the facts JSON (band measurements, alerts, timeline, voice-note "
           "insights, memory check-ins). Cite which fact groups you used in based_on. If the facts don't cover it, say so. No diagnoses.")
    return _run(post, key, model, ins, {'question': question[:500], 'facts': facts}, ASK_SCHEMA, 'ask', fb)


def digest(facts, key=None, model=None, post=None):
    def fb():
        L = facts.get('labels', {})
        return {'headline': 'Here is Mom’s day so far.', 'physical': 'Steps %s; tremor score %s/4; falls %s.' % (L.get('steps', 0), L.get('tremor', 0), L.get('falls', 0)),
                'memory': '%d voice notes, %d memory check-ins.' % (len(facts.get('notes', [])), len(facts.get('recall', []))),
                'safety': '%d open alerts.' % len([a for a in facts.get('alerts', []) if not a.get('ack')]), 'care': 'Pills: %s.' % facts.get('meds', {}), 'suggestion': 'Give Mom a call this evening.'}
    ins = ("Write Lisa's calm daily digest about her mother Margaret from the facts only: one headline, then one or two sentences each "
           "for physical (movement, falls, tremor, balance, sleep), memory (check-ins, language, wandering), safety (scams, alerts), "
           "care (pills, side effects, doctor), and one concrete suggestion. Plain words, no diagnoses, no alarmism.")
    return _run(post, key, model, ins, {'facts': facts}, DIGEST_SCHEMA, 'digest', fb)


def doctor_draft(facts, key=None, model=None, post=None):
    def fb():
        return {'subjective': '; '.join(facts.get('notes', [])[-3:]) or 'No reports.', 'objective': json.dumps(facts.get('labels', {})),
                'assessment': 'Signals for review; not diagnostic.', 'plan': 'Clinician to review.'}
    ins = ("Draft a brief clinician-facing note (SOAP) about Margaret, 78, from the facts only: subjective (her words), objective "
           "(wrist-band measurements with numbers/times; methods are research algorithms, not validated devices), assessment "
           "(possibilities worth review), plan (suggested follow-ups). Concise. No diagnoses.")
    return _run(post, key, model, ins, {'facts': facts}, DOCTOR_SCHEMA, 'doctor', fb)


# ---- report(facts): a written report about Margaret for Lisa (and to share with Dr. Patel) ---------------------------
REPORT_SCHEMA = _obj({
    'headline': S('One calm sentence: how Margaret is overall.'),
    'mental': {'type': 'array', 'items': S('One short finding: memory, speech, mood, isolation, abuse, sleep, wandering.')},
    'financial': {'type': 'array', 'items': S('One short finding: scams, fraud, bills, card.')},
    'physical': {'type': 'array', 'items': S('One short finding: falls, tremor, medicine, movement, band.')},
    'concerns': {'type': 'array', 'items': S('The most important things to act on, most urgent first.')},
    'next_steps': {'type': 'array', 'items': S('A concrete step for Lisa, short.')},
    'for_doctor': S('2-3 sentences Lisa could send to Dr. Patel. Possibilities, not diagnoses.'),
})


def report(facts, key=None, model=None, post=None):
    """facts = {events: [{time, area, event, alert, detail, level, sensor, band_reading, margaret_said}], card: {...}}"""
    evs = facts.get('events') or []

    def fb():
        by = {'mental': [], 'financial': [], 'physical': []}
        for e in evs:
            by.get(e.get('cat'), []).append('%s %s: %s' % (e.get('time', ''), e.get('event', ''), e.get('alert', '')))
        urgent = ['%s at %s' % (e.get('alert') or e.get('event'), e.get('time')) for e in evs if e.get('level') == 'urgent']
        return {'headline': 'Margaret had %d notable events today; %d needed a fast response.' % (len(evs), len(urgent)),
                'mental': by['mental'] or ['Nothing notable.'], 'financial': by['financial'] or ['Nothing notable.'], 'physical': by['physical'] or ['Nothing notable.'],
                'concerns': urgent[:5] or ['None urgent.'],
                'next_steps': ['Call Mom this evening.', 'Review the scam and card alerts together.', 'Book a check-in with Dr. Patel about memory and the fall.'],
                'for_doctor': 'Band 39 logged %d events for Margaret today, including %s. Sharing for review; these are signals, not diagnoses.' % (len(evs), ', '.join(urgent[:3]) or 'no urgent events')}
    ins = ("Write a short report about Margaret (78, lives alone, early memory changes) for her daughter Lisa, using ONLY the facts: the day's "
           "events from her Band 39 wristband and companion Pip (each with time, area, what was sensed and the alert). Group findings into mental, "
           "financial and physical health (1-4 short bullets each, with times), list the concerns that need action (most urgent first), 3-5 concrete "
           "next steps for Lisa, and a 2-3 sentence note Lisa could send to Dr. Patel. Plain words, warm but direct, no diagnoses, no invented facts.")
    return _run(post, key, model, ins, {'facts': facts}, REPORT_SCHEMA, 'report', fb)
