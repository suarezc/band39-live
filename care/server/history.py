"""Trends for Lisa: an AI summary of Margaret's history and a chat grounded in it.

summary(stats)                      "What changed": 3-5 changes, what's stable, 1-2 next steps
chat(question, turns, stats, today) answers only from the trend stats + today's facts, cites metrics

The browser sends computed per-metric stats (period value, prior period, change, weekly values, events),
never raw sensor data or keys. Same pattern as agents.py: OpenAI Responses + strict JSON schema, and a
rule-based fallback when there is no key or the call fails. Signals for family, never diagnoses.
"""
import re
import agents

_obj, S = agents._obj, agents.S

SUMMARY_SCHEMA = _obj({
    'headline': S('One calm sentence: the single most useful thing to know about this period.'),
    'changes': {'type': 'array', 'description': '3-5 notable changes, most important first.', 'items': _obj({
        'text': S('One short plain sentence with the numbers (e.g. "Steps averaged 3,100 a day, down 21% from the previous 30 days").'),
        'metric': S('The metric key from the stats this is about.'),
        'tone': {'type': 'string', 'enum': ['concern', 'good', 'neutral']},
    })},
    'stable': {'type': 'array', 'items': S(), 'description': '1-3 short notes on what stayed steady.'},
    'next_steps': {'type': 'array', 'items': S(), 'description': '1-2 concrete, gentle next steps for Lisa.'},
})
CHAT_SCHEMA = _obj({
    'answer': S('2-5 short sentences for Lisa, only from the data. Say plainly when the data does not cover the question.'),
    'used': {'type': 'array', 'items': S(), 'description': 'Metric keys from the data that the answer used.'},
    'covered': {'type': 'boolean', 'description': 'false when the data does not answer the question.'},
})

SUMMARY_INSTRUCTIONS = (
    "You write a short trend summary for Lisa about her mother Margaret, 78, who lives alone with early memory changes and wears "
    "a Vexo wrist band. You get per-metric stats for a period (value, previous period, change, weekly values, notable events) and "
    "today's live facts. Write: a one-sentence headline; 3-5 notable changes (biggest or most care-relevant first, with numbers "
    "and dates of events, e.g. connect restless nights to the new pill only as a timing observation); 1-3 things that stayed stable; "
    "1-2 gentle, concrete next steps (e.g. mention something to Dr. Patel, talk with Mom, ask Ruth to check in). Lisa reads this "
    "on her phone: call Margaret 'Mom', keep every item to one short sentence (under 25 words), round numbers sensibly (64%, not "
    "63.1%). Never diagnose, never suggest changing medicines, no alarmism. Use only the numbers given. Do not mention data_note "
    "or that data is sample history (the app labels it)."
)
CHAT_INSTRUCTIONS = (
    "Lisa is asking about trends in her mother Margaret's data (78, early memory changes, Vexo wrist band). Answer ONLY from the "
    "data JSON: per-metric period stats, daily or weekly values, events, and today's live facts. Use numbers and dates. Keep the "
    "conversation context from recent_turns. List the metric keys you used in 'used'. If the data does not cover the question "
    "(e.g. blood pressure, diet, what a doctor said), say so plainly and set covered=false, then mention what the data does show. "
    "When Lisa asks about causes or what lines up, point to marked events (e.g. a new pill, a fall, scam calls) and their dates as "
    "timing only, never as proof. Call Margaret 'Mom' or 'your mom'. Round numbers sensibly. Do not mention data_note or that data "
    "is sample history (the app labels it). Today's values are partial. No diagnoses, no medicine changes; suggest asking Dr. Patel "
    "when it is a medical question."
)


# ---- helpers ------------------------------------------------------------------------------------
def _num(v, d=0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _fmt(m, v):
    if v is None:
        return 'no data'
    u = m.get('unit', '')
    if u == '$':
        return '$%s' % format(int(round(_num(v))), ',')
    if u == '%':
        return '%d%%' % round(_num(v))
    n = _num(v)
    s = format(int(round(n)), ',') if abs(n) >= 100 or float(n).is_integer() else ('%.1f' % n)
    return s + ((' ' + u) if u and not u.startswith('/') else u)


def _metrics(stats):
    return {k: v for k, v in (stats.get('metrics') or {}).items() if isinstance(v, dict)}


def _change_words(m):
    v, p = m.get('value'), m.get('prior')
    if v is None or p is None:
        return None, 0
    v, p = _num(v), _num(p)
    if m.get('unit') == '%' or m.get('unit') == '/100':
        d = v - p
        return ('up %d points' % round(d) if d > 0 else 'down %d points' % round(-d)), d / 100.0
    if m.get('agg') == 'sum' and p == 0:
        return ('new this period (none before)' if v > 0 else None), (1.0 if v > 0 else 0)
    if p == 0:
        return None, 0
    c = (v - p) / abs(p)
    return ('up %d%%' % round(c * 100) if c > 0 else 'down %d%%' % round(-c * 100)), c


def _tone(m, rel):
    g = m.get('good')
    if not g or abs(rel) < 0.05:
        return 'neutral'
    return 'good' if (rel > 0) == (g == 'up') else 'concern'


def _period(stats):
    return stats.get('period_label') or 'this period'


def _event_text(e):
    return '%s (%s)' % (e.get('label', 'event'), e.get('date', ''))


# ---- offline fallbacks ------------------------------------------------------------------------
def _summary_rules(stats):
    M, period = _metrics(stats), _period(stats)
    prior = stats.get('prior_label') or 'the period before'
    rows = []
    for k, m in M.items():
        words, rel = _change_words(m)
        if not words:
            continue
        weight = abs(rel) * (1.6 if m.get('care_priority') else 1.0)
        rows.append((weight, k, m, words, rel))
    rows.sort(key=lambda r: -r[0])
    changes, stable = [], []
    for w, k, m, words, rel in rows:
        tone = _tone(m, rel)
        if tone == 'neutral' or abs(rel) < 0.08:
            continue
        if len(changes) >= 4:
            break
        changes.append({'text': '%s: %s, %s from %s (%s).' % (m.get('label', k), _fmt(m, m.get('value')), words, prior, _fmt(m, m.get('prior'))),
                        'metric': k, 'tone': tone})
    ev = [e for e in (stats.get('events') or []) if isinstance(e, dict)]
    if ev:
        changes.append({'text': 'Marked events %s: %s.' % (period, ', '.join(_event_text(e) for e in ev[:4])), 'metric': 'events', 'tone': 'neutral'})
    for k, m in M.items():
        words, rel = _change_words(m)
        if m.get('value') is not None and abs(rel) < 0.06 and len(stable) < 3:
            stable.append('%s steady at %s.' % (m.get('label', k), _fmt(m, m.get('value'))))
    if not changes:
        changes = [{'text': 'No big changes %s compared with %s.' % (period, prior), 'metric': 'all', 'tone': 'good'}]
    steps = []
    concern = {c['metric'] for c in changes if c['tone'] == 'concern'}
    pill = next((e for e in ev if e.get('kind') == 'pill'), None)
    if concern & {'restless', 'restless_nights', 'sleep', 'wander', 'balance', 'falls'}:
        steps.append('Mention the sleep and balance changes%s to Dr. Patel at the next visit.' % (' since the new pill on %s' % pill.get('date') if pill else ''))
    if concern & {'scam', 'declines'} or any(e.get('kind') == 'scam' for e in ev):
        steps.append('Have a calm chat with Mom about the scam calls; her card limits blocked the risky payments.')
    if concern & {'recall', 'concern'} and len(steps) < 2:
        steps.append('Keep the daily memory moments going and note any new confusion for Dr. Patel.')
    if concern & {'steps'} and len(steps) < 2:
        steps.append('Suggest a short walk together or ask Ruth to join her for one this week.')
    if not steps:
        steps.append('Keep the usual check-in call; nothing needs action right now.')
    first = changes[0]['text'] if changes else ''
    headline = 'Mostly steady %s, with a few changes worth a look.' % period if concern else 'A steady stretch for Mom %s.' % period
    return {'headline': headline, 'changes': changes[:5], 'stable': stable[:3] or ['Shaking score stayed about the same.'], 'next_steps': steps[:2], '_first': first}


TOPICS = [
    (r'sleep|night|rest|tired|bed|wak', ['sleep', 'restless', 'restless_nights', 'wander'], 'sleep and nights'),
    (r'walk|step|move|activ|exercis|balanc|fall|steady|unsteady|dizz', ['steps', 'balance', 'falls'], 'walking and balance'),
    (r'shak|tremor|parkinson|hand', ['tremor'], 'shaking'),
    (r'money|card|spend|scam|fraud|call|pay|bank|gift', ['scam', 'spend', 'declines'], 'money and scams'),
    (r'memor|forget|remember|recall|confus|dementia|word|languag', ['recall', 'concern'], 'memory'),
    (r'mood|sad|lonely|happy|depress|down|upset|feel', ['mood'], 'mood'),
    (r'pill|med|dose|tablet|prescri', ['missed'], 'pills'),
    (r'alert|urgent|warn|emergenc', ['alerts_urgent', 'alerts_warn', 'falls'], 'alerts'),
]
UNCOVERED = r'blood pressure|heart rate|pulse|weight|diet|eat|food|oxygen|sugar|glucose|temperature|doctor said|diagnos'


def _chat_rules(question, stats, today):
    q, M = question.lower(), _metrics(stats)
    period, prior = _period(stats), stats.get('prior_label') or 'the period before'
    if re.search(UNCOVERED, q) and not re.search(r'sleep|walk|step|memor|money|card|pill|mood', q):
        have = ', '.join(t[2] for t in TOPICS[:6])
        return {'answer': "The band and Mom's conversations don't track that, so I can't say. I can tell you about %s." % have, 'used': [], 'covered': False}
    picked = []
    for pat, keys, name in TOPICS:
        if re.search(pat, q):
            picked += [k for k in keys if k in M and k not in picked]
    if not picked:
        picked = [k for k in ('steps', 'restless_nights', 'recall', 'scam') if k in M]
    parts = []
    for k in picked[:4]:
        m = M[k]
        words, rel = _change_words(m)
        s = '%s %s: %s' % (m.get('label', k), period, _fmt(m, m.get('value')))
        if words:
            s += ', %s from %s' % (words, prior)
        if m.get('last_week') is not None and m.get('agg') != 'sum':
            s += '; last 7 days %s' % _fmt(m, m.get('last_week'))
        parts.append(s + '.')
    ev = [e for e in (stats.get('events') or []) if isinstance(e, dict)]
    rel_ev = [e for e in ev if (e.get('kind') == 'fall' and set(picked) & {'falls', 'balance', 'steps'}) or
              (e.get('kind') == 'scam' and set(picked) & {'scam', 'spend', 'declines'}) or
              (e.get('kind') == 'pill' and set(picked) & {'sleep', 'restless', 'restless_nights', 'missed', 'wander', 'balance'})]
    if rel_ev:
        parts.append('Marked: %s.' % ', '.join(_event_text(e) for e in rel_ev[:3]))
    if today and any(k in picked for k in ('steps',)) and today.get('steps') is not None:
        parts.append('Today so far: %s steps.' % format(int(_num(today.get('steps'))), ','))
    return {'answer': ' '.join(parts) or 'The trend data does not cover that yet.', 'used': picked[:4] + (['events'] if rel_ev else []), 'covered': bool(parts)}


# ---- agents -------------------------------------------------------------------------------------
def _clean_stats(stats):
    return stats if isinstance(stats, dict) else {}


def summary(stats, key=None, model=None, post=None):
    stats = _clean_stats(stats)
    def fb():
        out = _summary_rules(stats); out.pop('_first', None); return out
    out = agents._run(post, key, model, SUMMARY_INSTRUCTIONS, {'stats': stats}, SUMMARY_SCHEMA, 'trend_summary', fb)
    out.pop('_first', None)
    return out


def chat(question, turns, stats, today, key=None, model=None, post=None):
    stats = _clean_stats(stats)
    question = str(question or '')[:500]
    turns = [{'role': 'lisa' if t.get('role') in ('user', 'lisa') else 'assistant', 'text': str(t.get('text', ''))[:500]}
             for t in (turns or []) if isinstance(t, dict)][-16:]
    payload = {'question': question, 'recent_turns': turns, 'data': {'stats': stats, 'today': today if isinstance(today, dict) else {}}}
    return agents._run(post, key, model, CHAT_INSTRUCTIONS, payload, CHAT_SCHEMA, 'trend_chat', lambda: _chat_rules(question, stats, today or {}))


def handle(route, req, key=None, model=None, post=None):
    req = req if isinstance(req, dict) else {}
    if route == '/api/trend-summary':
        return summary(req.get('stats') or {}, key=key, model=model, post=post)
    return chat(req.get('question', ''), req.get('turns') or [], req.get('stats') or {}, req.get('today') or {}, key=key, model=model, post=post)
