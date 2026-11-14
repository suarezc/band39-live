"""Conversation insights from Margaret's voice-note transcripts.

analyze(transcript, history) -> one dict with five groups:
  risk:      scam, abuse                     (flag, level, evidence)
  medical:   reminders, side_effects, doctor_notes
  dementia:  cognitive, memory, language     (score 0-100 where higher = more concern, signals)
  lifestyle: tips
  track:     things to log (water, meals, mood, pain, sleep, social)

With OPENAI_API_KEY set, OpenAI does the reading (Responses API, strict JSON schema, store=false,
model OPENAI_MODEL or gpt-6-luna as in the Vexo kit). Without it, offline rules below give the
same shape, marked source="rules". Language metrics (type-token ratio, fillers, repeats) are
always computed locally and passed to the model as context. Signals for a family member and a
clinician to look at, never a diagnosis.
"""
import json, re

FILLERS = {'um', 'uh', 'er', 'erm', 'hmm', 'thingy', 'whatchamacallit', 'thingamajig'}
LEVELS = ['none', 'low', 'medium', 'high']


def _words(t):
    return re.findall(r"[a-z']+", t.lower())


def language_metrics(transcript, history):
    w = _words(transcript)
    n = len(w) or 1
    ttr = len(set(w)) / n if w else 0.0
    fillers = sum(1 for x in w if x in FILLERS) + len(re.findall(r"\bwhat'?s (it|the word) called\b|\bi can'?t (remember|think of) the word\b", transcript.lower()))
    sentences = [s.strip().lower() for s in re.split(r'[.?!]', transcript) if len(s.strip()) > 8]
    past = [s.strip().lower() for h in history for s in re.split(r'[.?!]', h) if len(s.strip()) > 8]
    repeats = sum(1 for s in sentences if s in past) + (len(sentences) - len(set(sentences)))
    return {'words': len(w), 'type_token_ratio': round(ttr, 2), 'fillers': fillers, 'repeated_sentences': repeats}


SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['risk', 'medical', 'dementia', 'lifestyle', 'track', 'summary'],
    'properties': {
        'summary': {'type': 'string', 'description': 'One calm sentence for Lisa about this voice note.'},
        'risk': {'type': 'object', 'additionalProperties': False, 'required': ['scam', 'abuse'], 'properties': {
            k: {'type': 'object', 'additionalProperties': False, 'required': ['level', 'evidence'], 'properties': {
                'level': {'type': 'string', 'enum': LEVELS}, 'evidence': {'type': 'string'}}} for k in ('scam', 'abuse')}},
        'medical': {'type': 'object', 'additionalProperties': False, 'required': ['reminders', 'side_effects', 'doctor_notes'], 'properties': {
            'reminders': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['what', 'when'], 'properties': {
                'what': {'type': 'string'}, 'when': {'type': 'string', 'description': 'Plain time words as said, e.g. "tomorrow 10 am", or "" if none.'}}}},
            'side_effects': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['symptom', 'condition'], 'properties': {
                'symptom': {'type': 'string'}, 'condition': {'type': 'string', 'enum': ['nausea', 'dizziness', 'tremor', 'sleep', 'pain', 'confusion', 'other']}}}},
            'doctor_notes': {'type': 'string', 'description': 'What a clinician should know from this note, or "".'}}},
        'dementia': {'type': 'object', 'additionalProperties': False, 'required': ['cognitive', 'memory', 'language'], 'properties': {
            k: {'type': 'object', 'additionalProperties': False, 'required': ['concern', 'signals'], 'properties': {
                'concern': {'type': 'integer', 'description': '0 (none) to 100 (strong) concern in this note.'},
                'signals': {'type': 'array', 'items': {'type': 'string'}}}} for k in ('cognitive', 'memory', 'language')}},
        'lifestyle': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 3 gentle, practical tips.'},
        'track': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['metric', 'value'], 'properties': {
            'metric': {'type': 'string', 'enum': ['water', 'meal', 'mood', 'pain', 'sleep', 'social', 'activity', 'other']}, 'value': {'type': 'string'}}}},
    },
}

INSTRUCTIONS = (
    "You read a voice note from Margaret, 78, who lives alone with early memory problems, for her daughter Lisa "
    "and her doctor. Fill every field from what she said only; do not invent. Risk: scam = someone asking for money, "
    "gift cards, bank/Medicare details, prize or 'grandchild in trouble' stories; abuse = signs someone hurts, threatens, "
    "neglects, isolates or takes money from her. Medical: reminders she mentions (appointments, pills, calls), possible "
    "medicine side effects, and short doctor notes. Dementia: concern 0-100 for cognitive (confusion about time/place, "
    "reasoning), memory (forgetting recent events, repeating herself; use the earlier notes given), language (word-finding, "
    "fillers, empty phrases; use the given metrics). These are signals for a clinician, never a diagnosis. Lifestyle: up to "
    "3 kind, practical tips. Track: anything worth logging. Keep evidence to short quotes."
)


def analyze_openai(transcript, history, metrics, key, model, post):
    body = {
        'model': model, 'store': False, 'instructions': INSTRUCTIONS,
        'input': json.dumps({'voice_note': transcript, 'earlier_notes': history[-8:], 'language_metrics': metrics}),
        'text': {'format': {'type': 'json_schema', 'name': 'insights', 'strict': True, 'schema': SCHEMA}},
    }
    code, raw = post('https://api.openai.com/v1/responses', json.dumps(body).encode(),
                     {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    if code != 200:
        raise RuntimeError('OpenAI status %d' % code)
    data = json.loads(raw)
    text = ''.join(p.get('text', '') for item in data.get('output', []) for p in item.get('content', []) or [] if p.get('type') == 'output_text')
    out = json.loads(text)
    out['source'] = 'openai:' + model
    return out


# ---- offline rules (no key) --------------------------------------------------------------
SCAM = [r'gift ?cards?', r'wire (the )?money', r'social security number', r'medicare (number|card)', r'bank (details|account|password)',
        r"you('ve| have) won", r'\bprize\b', r'grand(son|daughter|child).{0,40}(jail|trouble|bail|accident)', r'irs', r'bitcoin', r'verify your account',
        r'(he|she|they|man|woman|caller) (asked|wanted) (me )?(for )?(money|my card|my pin)']
ABUSE = [r'(hit|hurt|slapped|pushed|grabbed) me', r'yell(s|ed|ing) at me', r'took my (money|card|check|pills)', r"won'?t let me (call|see|leave|eat)",
         r'(scared|afraid) of (him|her|them)', r'locked me', r'threaten(ed|s)']
REMIND = [(r'(appointment|doctor|dentist|clinic).{0,30}?(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|at \d{1,2}( ?[ap]m)?)', 'Doctor appointment'),
          (r'(call|phone) (the )?(pharmacy|doctor|lisa|bank)\b.{0,25}?(tomorrow|today|tonight|later|at \d{1,2}( ?[ap]m)?)?', None),
          (r'(refill|pick up) (my )?(pills|prescription|medicine)', 'Prescription refill')]
SIDE = [(r'nause(a|ous)|feel(ing)? sick|threw up|vomit', 'nausea'), (r'dizz(y|iness)|light-?headed|room (is )?spinning', 'dizziness'),
        (r'(hands?|arm) (is |are )?shak(ing|y)|tremor|trembl', 'tremor'), (r"can'?t sleep|couldn'?t sleep|awake all night|insomnia", 'sleep'),
        (r'\bpain\b|hurts|ache', 'pain'), (r'confus(ed|ing)|mixed up|foggy', 'confusion')]
COG = [r'what (day|year|month) is it', r"(don'?t|didn'?t) know where i (am|was)", r'got lost', r'is it (morning|night)', r'who are you']
MEM = [r"(i )?(forgot|can'?t remember|don'?t remember)", r'did i (already )?(take|eat|call)', r'where (did i put|are) my (keys|glasses|purse|pills)']
TRACK = [(r'(drank|had) (a |some |two |three )?(glass(es)?|cups?) of (water|tea)', 'water'), (r'(ate|had) (breakfast|lunch|dinner|soup|toast|a sandwich)', 'meal'),
         (r'(happy|lonely|sad|tired|cheerful|worried|bored)', 'mood'), (r'(walk(ed)?|garden(ed|ing)?)', 'activity'), (r'(visited|called|saw) (ruth|lisa|a friend|my neighbou?r)', 'social')]


def _find(pats, t):
    for p in pats:
        m = re.search(p, t)
        if m:
            return m.group(0)
    return ''


def analyze_rules(transcript, history, metrics):
    t = transcript.lower()
    scam, abuse = _find(SCAM, t), _find(ABUSE, t)
    reminders = []
    for p, label in REMIND:
        m = re.search(p, t)
        if m:
            when = re.search(r'tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|at \d{1,2}( ?[ap]m)?', m.group(0))
            reminders.append({'what': label or m.group(0).split(' tomorrow')[0].capitalize(), 'when': when.group(0) if when else ''})
    side = [{'symptom': re.search(p, t).group(0), 'condition': c} for p, c in SIDE if re.search(p, t)]
    cog_hits = [m.group(0) for p in COG for m in [re.search(p, t)] if m]
    mem_hits = [m.group(0) for p in MEM for m in [re.search(p, t)] if m]
    lang_signals, lang = [], 0
    if metrics['words'] >= 12 and metrics['type_token_ratio'] < 0.45:
        lang += 35; lang_signals.append('low word variety (%.2f)' % metrics['type_token_ratio'])
    if metrics['fillers'] >= 3:
        lang += 35; lang_signals.append('%d fillers / word-finding pauses' % metrics['fillers'])
    if metrics['repeated_sentences']:
        mem_hits.append('repeated %d sentence(s) from earlier notes' % metrics['repeated_sentences'])
    tracks = [{'metric': k, 'value': re.search(p, t).group(0)} for p, k in TRACK if re.search(p, t)]
    tips = []
    if any(s['condition'] == 'dizziness' for s in side): tips.append('Stand up slowly and sit on the bed edge for a minute first.')
    if any(s['condition'] == 'sleep' for s in side): tips.append('Keep the same bedtime and skip tea after 4 pm.')
    if not any(x['metric'] == 'water' for x in tracks): tips.append('A glass of water with each pill helps.')
    if not any(x['metric'] == 'social' for x in tracks): tips.append('A short call with a friend today would be lovely.')
    notes = '; '.join(filter(None, ['reports ' + ', '.join(s['symptom'] for s in side) if side else '', 'disorientation: ' + ', '.join(cog_hits) if cog_hits else '']))
    level = lambda hit, strong: ('high' if strong else 'medium') if hit else 'none'
    return {
        'summary': 'Voice note of %d words%s.' % (metrics['words'], '; worth a look' if (scam or abuse or side or cog_hits) else ''),
        'risk': {'scam': {'level': level(scam, bool(re.search(r'gift ?cards?|wire|bail|social security', t))), 'evidence': scam},
                 'abuse': {'level': level(abuse, bool(re.search(r'hit|hurt|slapped|threaten', t))), 'evidence': abuse}},
        'medical': {'reminders': reminders, 'side_effects': side, 'doctor_notes': notes},
        'dementia': {'cognitive': {'concern': min(100, 40 * len(cog_hits)), 'signals': cog_hits},
                     'memory': {'concern': min(100, 30 * len(mem_hits)), 'signals': mem_hits},
                     'language': {'concern': min(100, lang), 'signals': lang_signals}},
        'lifestyle': tips[:3], 'track': tracks, 'source': 'rules',
    }


def analyze(transcript, history, key=None, model='gpt-6-luna', post=None):
    transcript = (transcript or '')[:6000]
    history = [str(h)[:2000] for h in (history or [])][-8:]
    metrics = language_metrics(transcript, history)
    out = None
    if key and post:
        try:
            out = analyze_openai(transcript, history, metrics, key, model, post)
        except Exception as e:  # fall back, but say why (status only)
            out = analyze_rules(transcript, history, metrics); out['source'] = 'rules (%s)' % str(e)[:60]
    else:
        out = analyze_rules(transcript, history, metrics)
    out['metrics'] = metrics
    return out
