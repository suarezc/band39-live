"""Nightly digest: one day of what Mom said, condensed for Lisa (caregiver) and Dr. Patel.

    ../.venv/bin/python server/digest.py [--date YYYY-MM-DD] [--deep] [--threshold 0.7] [--products PATH] [--print]

Reads the live transcript (read-only), asks gemini-decision-1 the yes/no questions (each HSA/FSA
need from care/data/hsa-products.json, plus day flags: scam, distress, fall, medication), asks
gemini-4-hydrogen (or gemini-4-carbon with --deep) for the written summary, keeps only points whose
phrase ids are real ids from that day, recommends products only for needs at or above the threshold,
and saves <data>/digests/YYYY-MM-DD.json (data = $BAND39_LIVE_DATA or experiments/data/live).

Importable:  digest.run(date=None, deep=False, threshold=0.7) -> dict   (build, save, return)
             digest.load(date=None) -> dict | None                       (the saved digest, if any)
             digest.start_nightly(hour=21)                               (optional: run every night)

---- Wiring for server/server.py (the server already has json, urllib.parse, sys.path set up) ----
In do_GET, before `return super().do_GET()`:

        if self.path.split('?')[0] == '/api/digest':
            import digest
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            d = digest.load((q.get('date') or [None])[0])
            return self.send_json(200 if d else 404, d or {})

In do_POST, next to the other routes:

            if route == '/api/digest/run':
                import digest
                req = json.loads(self.body(2000) or b'{}')
                return self.send_json(200, digest.run(deep=bool(req.get('deep'))))

Optional, in __main__ before serve_forever(), to make it nightly:  import digest; digest.start_nightly(21)
(The server must run with ../.venv/bin/python: this module uses httpx.)

---- Wiring for web/index.html ----
    <link rel="stylesheet" href="css/digest.css" />      (after css/live.css)
    <script src="js/digest.js"></script>                 (after js/live.js)
"""
import argparse
import datetime as dt
import json
import os
import re
import sqlite3
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
PRODUCTS = PROJECT / 'care' / 'data' / 'hsa-products.json'
API = 'https://generativelanguage.googleapis.com/v1beta'
FAST, DEEP, DECIDER = 'gemini-4-hydrogen', 'gemini-4-carbon', 'gemini-decision-1'
FLAG_AT = 0.5                    # a day flag is shown at or above this probability
PER_NEED, MAX_PRODUCTS = 2, 5
FIT_AT = 0.6                     # a product is shown only if the decision model says it fits her words at least this much
ELIG_ORDER = {'eligible': 0, 'lmn': 1, 'dual': 2}
CAVEAT = 'Signals from everyday speech, not a diagnosis.'
_lock = threading.Lock()

NEED_RULE = (' Answer yes only if she herself, in her own words below, clearly voices this specific complaint or need. '
             'No if the topic only came up, if it is about pills she simply took, a single passing event, a passing remark she '
             'dismisses, someone else\'s words, or TV/radio. Lines marked "probably Mom" may be someone else.')
FLAG_QUESTIONS = {
    'scam': 'Did another voice (not the wearer) try to get money, gift cards, card numbers, bank or account details from the wearer, or pressure her to pay urgently and in secret (a possible scam)?',
    'distress': 'Did anyone call for help, or is there a sign of distress (someone saying they are not fine, panic, crying, asking for help)?',
    'fall': 'Was a possible fall mentioned (someone fell, has fallen, cannot get up, or a bystander reacts as if someone fell)?',
    'medication': 'Is there a sign that the wearer missed a dose, mixed up, or was confused about her medication?',
}
# lines that can back a flag when the summary model gave none (most specific pattern first)
FLAG_LINES = {
    'scam': [r"gift ?cards?", r"card numbers?|numbers on the back", r"bail|bell money|jail", r"compromised|security department", r"\bbank\b", r"don'?t tell"],
    'distress': [r"^\W*help\b|help me\b|call (an )?ambulance|call 911", r"not fine", r"can'?t get up", r"are you okay", r"emergency|scared"],
    'fall': [r"fallen|\bfell\b", r"can'?t get up", r"\bfall\b|tripped|on the floor"],
    'medication': [r"metformin|metmorphin|\bdose\b|tablets?", r"pills?\b|medic"],
}
FLAG_DEFAULT = {
    'scam': 'Another voice asked for money or card details',
    'distress': 'Someone asked for help or sounded distressed',
    'fall': 'A possible fall was mentioned',
    'medication': 'Something about her medication may have been missed or confused',
}
# extra words for the evidence heuristic (need ids and labels in the seed file are matched by prefix)
SYNONYMS = {
    'medic': 'pill pills medicine metformin metmorphin took dose tablet pharmacy',
    'pill': 'pills medication medicine metformin metmorphin took dose tablet pharmacy',
    'fall': 'fell fallen trip tripped unsteady balance dizzy',
    'balanc': 'fell fallen unsteady dizzy steady walk',
    'pain': 'hurt hurts ache sore knee hip back',
    'joint': 'knee hip hurt ache sore walk',
    'blood': 'pressure pills dizzy',
    'pressur': 'blood pills dizzy',
    'hear': 'hearing heard loud tv pardon what',
    'sleep': 'tired awake night bed',
    'memor': 'forget forgot remember confused',
    'mobil': 'walk walked walking knee cane',
}
STOP = set('a an the and or of to in on at for with her she his he it is are was were be been does did do has have had any about from '
           'that this there their them they you your my me i we our as by if or not no yes into out up down over than then so such what '
           'which who whom when where why how mention mentions mentioned seem seems day today other person people say says said '
           'saying trouble felt feel feeling feels could would should can cannot need needing having like just once whether '
           'either one thing things got get getting things very much'.split())


# ---- data ------------------------------------------------------------------------------------
def data_dir():
    d = Path(os.environ.get('BAND39_LIVE_DATA') or 'experiments/data/live')
    return d if d.is_absolute() else PROJECT / d


def _date(date):
    if date is None:
        return dt.date.today()
    return date if isinstance(date, dt.date) else dt.date.fromisoformat(str(date))


def clock(at):
    return dt.datetime.fromtimestamp(at).strftime('%I:%M %p').lstrip('0').lower()


def read_day(date=None, db=None):
    """That local day's phrases: [{id, at, time, text, voice, who, mom, certain}], oldest first."""
    day = _date(date)
    db = Path(db) if db else data_dir() / 'transcript.db'
    if not db.exists():
        return []
    start = time.mktime(day.timetuple())
    end = time.mktime((day + dt.timedelta(days=1)).timetuple())
    con = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
    try:
        cols = {r[1] for r in con.execute('PRAGMA table_info(phrases)')}
        tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
        people = 'person_id' in cols and 'people' in tables
        pcols = {r[1] for r in con.execute('PRAGMA table_info(people)')} if people else set()
        sql = ('select p.id, p.at, p.text, p.voice, %s, %s from phrases p %s where p.at >= ? and p.at < ? order by p.at, p.id' % (
            'pe.name' if 'name' in pcols else 'null', 'pe.kind' if 'kind' in pcols else 'null',
            'left join people pe on pe.id = p.person_id' if people else ''))
        rows = con.execute(sql, (start, end)).fetchall()
    finally:
        con.close()
    out = []
    for pid, at, text, voice, name, kind in rows:
        text = (text or '').strip()
        if not text:
            continue
        kind = (kind or '').lower()
        # Mom for sure: her learned voice. Probably Mom: an unsure/unknown voice label, or the people table
        # (live.py's clustering, kind 'main') says her while the voice label disagrees. Never dropped.
        mom = voice == 'main'
        unsure = not mom and (voice != 'other' or kind == 'main')
        default = 'Mom' if mom or kind == 'main' else 'Someone else' if voice == 'other' else 'Not sure'
        out.append({'id': int(pid), 'at': float(at), 'time': clock(at), 'text': text, 'voice': voice or 'unknown',
                    'who': (name or '').strip() or default, 'mom': mom, 'maybe_mom': unsure, 'certain': mom})
    return out


def load_catalog(path=None):
    p = Path(path) if path else PRODUCTS
    try:
        c = json.loads(p.read_text())
    except (OSError, ValueError):
        return None
    c.setdefault('needs', []); c.setdefault('products', []); c.setdefault('eligibility_key', {})
    return c


# ---- model calls (replaceable in tests) ------------------------------------------------------
def _key():
    try:
        from dotenv import load_dotenv
        load_dotenv(PROJECT / '.env')
    except ImportError:
        pass
    return os.environ.get('GEMINI_API_KEY', '').strip()


def gemini_decide(text, questions):
    """-> ({qid: probability}, total_tokens). Raises RuntimeError('Decisions API status N') on failure."""
    import httpx
    r = httpx.post(API + '/decisions', headers={'x-goog-api-key': _key()}, timeout=60,
                   json={'model': DECIDER, 'input': text, 'questions': questions})
    if r.status_code != 200:
        raise RuntimeError('Decisions API status %d' % r.status_code)
    j = r.json()
    out = {}
    for k, a in (j.get('answers') or {}).items():
        if isinstance(a, dict) and a.get('noul') is not None:
            out[k] = float(a['noul'])
    return out, (j.get('usage') or {}).get('total_tokens', 0)


def gemini_write(prompt, schema, model):
    """-> (parsed JSON object, total_tokens). Tries with a response schema, then without."""
    import httpx
    last = None
    fast = model == FAST
    for with_schema, low in ((True, fast), (True, False), (False, False)):
        cfg = {'responseMimeType': 'application/json', 'temperature': 0.2}
        if with_schema:
            cfg['responseSchema'] = schema
        if low:
            cfg['thinkingConfig'] = {'thinkingLevel': 'low'}   # hydrogen: ~3x faster, same answer shape
        r = httpx.post('%s/models/%s:generateContent' % (API, model), headers={'x-goog-api-key': _key()}, timeout=180,
                       json={'contents': [{'role': 'user', 'parts': [{'text': prompt}]}], 'generationConfig': cfg})
        if r.status_code != 200:
            last = 'Summary model %s status %d' % (model, r.status_code)
            if r.status_code == 400 and with_schema:
                continue
            raise RuntimeError(last)
        j = r.json()
        text = ''.join(p.get('text', '') for c in j.get('candidates', [])[:1] for p in c.get('content', {}).get('parts', []) if not p.get('thought'))
        tokens = (j.get('usageMetadata') or {}).get('totalTokenCount', 0)
        m = re.search(r'\{.*\}', text, re.S)
        try:
            return json.loads(m.group(0) if m else text), tokens
        except ValueError:
            last = 'Summary model %s answered something that is not JSON' % model
    raise RuntimeError(last)


# ---- helpers ---------------------------------------------------------------------------------
def _words(s):
    return [w for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2 and w not in STOP]


def _stem(w):
    return w[:5]


def _terms(*texts):
    t = set()
    for s in texts:
        for w in _words(s or ''):
            t.add(_stem(w))
            for k, extra in SYNONYMS.items():
                if w.startswith(k):
                    t.update(_stem(x) for x in _words(extra))
    return t


def relevant(lines, terms, n=3):
    """The n lines sharing most terms with `terms` (ties: certain lines first, then earlier). Only lines with overlap."""
    scored = []
    for ln in lines:
        hits = len({_stem(w) for w in _words(ln['text'])} & terms)
        if hits:
            scored.append((-hits, not ln['certain'], ln['at'], ln))
    return [x[-1] for x in sorted(scored, key=lambda x: x[:3])[:n]]


def flag_lines(lines, kind, n=3):
    out = []
    for pat in FLAG_LINES[kind]:
        rx = re.compile(pat, re.I)
        out += [ln for ln in lines if rx.search(ln['text']) and ln not in out]
    return out[:n]


def transcript(lines):
    out = []
    for ln in lines:
        who = 'Probably Mom (voice not certain)' if ln['maybe_mom'] else '%s (Mom)' % ln['who'] if ln['mom'] and ln['who'] != 'Mom' else ln['who']
        out.append('[%d] %s %s: %s' % (ln['id'], ln['time'], who, ln['text']))
    return '\n'.join(out)


def _ids(v, valid):
    out = []
    for x in v if isinstance(v, list) else []:
        try:
            i = int(x)
        except (TypeError, ValueError):
            continue
        if i in valid and i not in out:
            out.append(i)
    return out


def clean_points(items, valid, fields, stats):
    """Keep items with text and at least one real phrase id; invented ids are removed and counted."""
    out = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        raw = it.get('evidence') if isinstance(it.get('evidence'), list) else []
        ev = _ids(raw, valid)
        stats['invented_ids'] += len([x for x in raw if str(x).strip().lstrip('-').isdigit() and int(x) not in valid])
        item = {f: str(it.get(f) or '').strip().rstrip('.') if f in ('what', 'when') else str(it.get(f) or '').strip() for f in fields}
        if not item[fields[0]] or not ev:
            stats['dropped_points'] += 1
            continue
        item['evidence'] = ev
        out.append(item)
    return out


def recommend(needs, catalog, threshold, by_id, fit=None):
    """needs: [{id, label, probability, evidence}] -> recommended products, by the rules in the brief."""
    key = catalog.get('eligibility_key') or {}
    picked, seen = [], set()
    for need in sorted(needs, key=lambda n: -n['probability']):
        if need['probability'] < threshold or not need['evidence']:
            continue
        prods = [p for p in catalog.get('products', []) if need['id'] in (p.get('needs') or []) and p.get('id') not in seen
                 and (fit or {}).get((need['id'], p.get('id')), 0) >= FIT_AT]
        # eligibility first (as the brief asks), then products whose name/why share words with her lines
        # (so "blood pressure pills" picks the cuff, not the thermometer), then the lower price
        said = {_stem(w) for i in need['evidence'] for w in _words(by_id[i]['text'])}
        prods.sort(key=lambda p: (ELIG_ORDER.get(p.get('eligibility'), 9), -round((fit or {}).get((need['id'], p['id']), 0), 1),
                                  -len({_stem(w) for w in _words(p.get('name', '') + ' ' + p.get('why', ''))} & said),
                                  (p.get('price_usd') or [1e9])[0]))
        q = next((n for n in catalog.get('needs', []) if n.get('id') == need['id']), {})
        terms = _terms(need['label'], q.get('question'))
        quote = max((by_id[i]['text'] for i in need['evidence']),   # her line closest to the need, then the fullest
                    key=lambda t: (len({_stem(w) for w in _words(t)} & terms), len(_words(t))))
        for p in prods[:PER_NEED]:
            seen.add(p['id'])
            picked.append({'product_id': p['id'], 'name': p.get('name', p['id']), 'eligibility': p.get('eligibility', ''),
                           'eligibility_label': key.get(p.get('eligibility'), p.get('eligibility', '')),
                           'price_usd': p.get('price_usd') or [], 'why': p.get('why', ''), 'need': need['id'],
                           'need_label': need['label'], 'probability': need['probability'], 'evidence_quote': quote})
    return picked[:MAX_PRODUCTS]


SCHEMA = {
    'type': 'object',
    'properties': {
        'headline': {'type': 'string'},
        'for_caregiver': {'type': 'array', 'items': {'type': 'object', 'properties': {'text': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'integer'}}}, 'required': ['text', 'evidence']}},
        'for_doctor': {'type': 'array', 'items': {'type': 'object', 'properties': {'text': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'integer'}}}, 'required': ['text', 'evidence']}},
        'reminders': {'type': 'array', 'items': {'type': 'object', 'properties': {'what': {'type': 'string'}, 'when': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'integer'}}}, 'required': ['what', 'when', 'evidence']}},
        'needs': {'type': 'array', 'items': {'type': 'object', 'properties': {'id': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'integer'}}}, 'required': ['id', 'evidence']}},
        'flags': {'type': 'array', 'items': {'type': 'object', 'properties': {'kind': {'type': 'string', 'enum': list(FLAG_QUESTIONS)}, 'text': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'integer'}}}, 'required': ['kind', 'text', 'evidence']}},
    },
    'required': ['headline', 'for_caregiver', 'for_doctor', 'reminders', 'flags'],
}

PROMPT = """You write a calm nightly summary of one day of speech heard by an older woman's wristband microphone.
The wearer is "Mom". Her daughter Lisa is her caregiver; her doctor is Dr. Patel.
Each line is "[phrase id] time speaker: words". Speaker "Mom" is her voice; "Probably Mom (voice not certain)" may be her or
someone near her; other speakers are other people (visitors, callers, TV). Speech-to-text makes mistakes (e.g. "metmorphin" is
probably metformin). Leave out chatter that says nothing about Mom's day, health, plans or safety.

Write JSON:
- headline: one calm sentence for Lisa about the day.
- for_caregiver: 2-5 short points Lisa should know (plans, mood, anything to follow up).
- for_doctor: 0-8 short points of health relevance: doses taken, missed or uncertain; refills running out; pain; dizziness;
  falls and near-falls; night-time confusion; memory (the same question asked twice, misplaced things, forgotten events);
  mood. Wellness wording only:
  "she mentioned", "worth asking about"; never a diagnosis.
- reminders: every plan or to-do with a time: appointments, calls, visits, lifts from other people (e.g. a neighbour picking
  her up), things to tell or bring to the doctor, things to ask Lisa. Give "when" in her words (e.g. "Tuesday at three").
- flags: one per kind that happened (scam, distress, fall, medication). For a scam, say what the other voice asked for and
  how she answered. For a call for help or a fall, quote the words and say whose voice it was.
Each point is one plain sentence of at most 30 words.
- needs: for each need listed below, the ids of HER lines (Mom or probably Mom) where she herself voices that specific
  complaint or need. Empty list if no line really does (the topic coming up, pills taken as usual, or TV speech do not count).
{needs}
TV or radio speech is not anyone in the room: never flag it.
Every item lists in "evidence" the phrase ids (the numbers in brackets) it rests on. Use only ids that appear below.
If a point rests on "Probably Mom" lines, say "probably". Be brief and concrete.

Transcript for {date}:
{lines}
"""


# ---- build -----------------------------------------------------------------------------------
def build(date, lines, catalog, threshold=0.7, deep=False, decide=None, write=None):
    decide, write = decide or gemini_decide, write or gemini_write
    date = _date(date)
    t0 = time.time()
    model = DEEP if deep else FAST
    valid = {ln['id'] for ln in lines}
    by_id = {ln['id']: ln for ln in lines}
    mom = [ln for ln in lines if ln['mom'] or ln['maybe_mom']]
    errors, usage, stats = [], {'decision_tokens': 0, 'summary_tokens': 0}, {'invented_ids': 0, 'dropped_points': 0}
    if catalog is None:
        errors.append('The product list (care/data/hsa-products.json) was not found, so no needs were checked.')
        catalog = {'needs': [], 'products': [], 'eligibility_key': {}}
    d = {
        'date': date.isoformat(), 'generated_at': dt.datetime.now().astimezone().isoformat(timespec='seconds'), 'model': model,
        'coverage': {'phrases': len(lines), 'from_mom': sum(ln['mom'] for ln in lines), 'uncertain': sum(ln['maybe_mom'] for ln in lines),
                     'others': sum(not ln['mom'] and not ln['maybe_mom'] for ln in lines),
                     'first': lines[0]['time'] if lines else None, 'last': lines[-1]['time'] if lines else None},
        'for_caregiver': {'headline': 'Nothing was heard from the band today.', 'points': []},
        'for_doctor': {'points': [], 'caveat': CAVEAT},
        'reminders': [], 'flags': [], 'needs': [], 'recommended': [], 'threshold': threshold,
    }
    if not lines:
        d.update(errors=errors, usage=usage, checks=stats, latency_s=round(time.time() - t0, 2))
        return d

    # 1. yes/no judgements: needs on Mom's lines, flags on everyone's
    need_p, flag_p = {}, {}
    needs = [n for n in catalog.get('needs', []) if n.get('id') and n.get('question')]
    if needs and mom:
        qs = {n['id']: {'type': 'noul', 'instructions': n['question'] + NEED_RULE}
              for n in needs}
        t = time.time()
        try:
            need_p, tok = decide('What the wearer (Mom) said today:\n' + transcript(mom), qs)
            usage['decision_tokens'] += tok
        except Exception as e:
            errors.append(str(e) if isinstance(e, RuntimeError) else 'Needs check failed (%s)' % type(e).__name__)
        usage['needs_s'] = round(time.time() - t, 2)
    t = time.time()
    try:
        flag_p, tok = decide('Everything the wristband heard today (the wearer is "Mom"):\n' + transcript(lines),
                             {k: {'type': 'noul', 'instructions': q} for k, q in FLAG_QUESTIONS.items()})
        usage['decision_tokens'] += tok
    except Exception as e:
        errors.append(str(e) if isinstance(e, RuntimeError) else 'Flags check failed (%s)' % type(e).__name__)
    usage['flags_s'] = round(time.time() - t, 2)
    t = time.time()

    # 2. the written summary
    written = {}
    try:
        hot = [n for n in needs if need_p.get(n['id'], 0) >= threshold]
        listed = '\n'.join('  %s: %s' % (n['id'], n['question']) for n in hot) or '  (none today: return an empty list)'
        written, tok = write(PROMPT.replace('{date}', date.strftime('%A %d %B %Y')).replace('{needs}', listed).replace('{lines}', transcript(lines)), SCHEMA, model)
        usage['summary_tokens'] += tok
        if not isinstance(written, dict):
            written = {}
    except Exception as e:
        errors.append(str(e) if isinstance(e, RuntimeError) else 'Summary failed (%s)' % type(e).__name__)
    usage['summary_s'] = round(time.time() - t, 2)

    headline = str(written.get('headline') or '').strip()
    d['for_caregiver'] = {'headline': headline or ('%d phrases were heard today; the written summary is not available.' % len(lines)),
                          'points': clean_points(written.get('for_caregiver'), valid, ('text',), stats)}
    d['for_doctor']['points'] = clean_points(written.get('for_doctor'), valid, ('text',), stats)
    d['reminders'] = clean_points(written.get('reminders'), valid, ('what', 'when'), stats)

    # 3. flags: the decision model's probability decides; the writer's sentence and ids describe it
    wflags = {}
    for f in clean_points(written.get('flags'), valid, ('kind', 'text'), stats):
        wflags.setdefault(f['kind'], f)
    for kind in FLAG_QUESTIONS:
        p = flag_p.get(kind)
        if p is None or p < FLAG_AT:
            continue
        w = wflags.get(kind)
        if w:
            text, ev = w['text'], w['evidence']
        else:
            hits = flag_lines(lines, kind)
            if not hits:
                continue
            text = '%s: "%s" (%s).' % (FLAG_DEFAULT[kind], hits[0]['text'], 'her voice' if hits[0]['mom'] else 'probably her voice' if hits[0]['maybe_mom'] else 'another voice')
            ev = [ln['id'] for ln in hits]
        d['flags'].append({'kind': kind, 'probability': round(p, 3), 'text': text, 'evidence': ev})

    # 4. needs and products
    # evidence for a need comes only from the summary model, and only Mom's own lines count; no line, no product
    mom_ids = {ln['id'] for ln in mom}
    wneeds = {}
    for it in written.get('needs') or []:
        if isinstance(it, dict) and it.get('id'):
            raw = it.get('evidence') if isinstance(it.get('evidence'), list) else []
            wneeds[str(it['id'])] = _ids(raw, mom_ids)
            stats['invented_ids'] += len([x for x in raw if str(x).strip().lstrip('-').isdigit() and int(x) not in valid])
    for n in needs:
        if n['id'] not in need_p:
            continue
        d['needs'].append({'id': n['id'], 'label': n.get('label', n['id']), 'probability': round(need_p[n['id']], 3), 'evidence': wneeds.get(n['id'], [])})
    d['needs'].sort(key=lambda n: -n['probability'])
    fit = {}
    for n in d['needs']:
        if n['probability'] < threshold or not n['evidence']:
            continue
        prods = [p for p in catalog.get('products', []) if n['id'] in (p.get('needs') or [])]
        if not prods:
            continue
        qs = {p['id']: {'type': 'noul', 'instructions': 'Would "%s" (%s) directly help with the specific problem she describes in these lines? '
                        'No if it treats a different problem, if she refused it, or if it is far more than a sensible first step '
                        '(major installations or costly equipment for an everyday complaint).' % (p.get('name', p['id']), p.get('why', ''))} for p in prods}
        t = time.time()
        try:
            got, tok = decide('Her own words about "%s":\n' % n['label'] + transcript([by_id[i] for i in n['evidence']]), qs)
            usage['decision_tokens'] += tok
            fit.update({(n['id'], k): v for k, v in got.items()})
        except Exception as e:
            errors.append(str(e) if isinstance(e, RuntimeError) else 'Product check failed (%s)' % type(e).__name__)
        usage['fit_s'] = round(usage.get('fit_s', 0) + time.time() - t, 2)
    d['recommended'] = recommend(d['needs'], catalog, threshold, by_id, fit)
    if not d['recommended']:
        d['nothing_to_suggest'] = 'Nothing to suggest today'
    d.update(errors=errors, usage=usage, checks=stats, latency_s=round(time.time() - t0, 2))
    return d


def path_for(date=None):
    return data_dir() / 'digests' / ('%s.json' % _date(date).isoformat())


def run(date=None, deep=False, threshold=0.7, products=None, db=None, decide=None, write=None):
    """Build the digest for `date` (default today), save it, return it. Model failures land in d['errors']."""
    with _lock:
        d = build(date, read_day(date, db), load_catalog(products), threshold, deep, decide, write)
        p = path_for(date)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix('.tmp')
        tmp.write_text(json.dumps(d, indent=1, ensure_ascii=False))
        tmp.replace(p)
        return d


def load(date=None):
    try:
        return json.loads(path_for(date).read_text())
    except (OSError, ValueError):
        return None


def start_nightly(hour=21):
    """A daemon thread that builds today's digest every day at `hour`:00 local time."""
    def loop():
        while True:
            now = dt.datetime.now()
            nxt = now.replace(hour=hour, minute=0, second=0, microsecond=0)
            if nxt <= now:
                nxt += dt.timedelta(days=1)
            time.sleep((nxt - now).total_seconds())
            try:
                run()
            except Exception as e:
                sys.stderr.write('digest: %r\n' % e)
    t = threading.Thread(target=loop, name='nightly-digest', daemon=True)
    t.start()
    return t


def summary(d):
    c = d['coverage']
    out = ['Digest for %s (%s, %ss)' % (d['date'], d['model'], d.get('latency_s')),
           'Made from %d phrases (%s to %s): %d Mom, %d probably Mom but not certain, %d others.' % (
               c['phrases'], c['first'], c['last'], c['from_mom'], c['uncertain'], c['others']),
           '', 'For Lisa: ' + d['for_caregiver']['headline']]
    out += ['  - %s  %s' % (p['text'], p['evidence']) for p in d['for_caregiver']['points']]
    out += ['For Dr. Patel:'] + ['  - %s  %s' % (p['text'], p['evidence']) for p in d['for_doctor']['points']] + ['  (' + d['for_doctor']['caveat'] + ')']
    out += ['Reminders:'] + ['  - %s, %s  %s' % (r['what'], r['when'], r['evidence']) for r in d['reminders']]
    out += ['Flags:'] + ['  - %s %.2f: %s  %s' % (f['kind'], f['probability'], f['text'], f['evidence']) for f in d['flags']]
    out += ['Needs (threshold %.2f):' % d['threshold']] + ['  - %-22s %.2f  %s' % (n['label'], n['probability'], n['evidence']) for n in d['needs']]
    out += ['Suggested products:'] + (['  - %s (%s, $%s) for %s: "%s"' % (r['name'], r['eligibility_label'], '-'.join(str(x) for x in r['price_usd']), r['need'], r['evidence_quote'])
                                       for r in d['recommended']] or ['  Nothing to suggest today'])
    if d.get('errors'):
        out += ['Problems:'] + ['  - ' + e for e in d['errors']]
    ch = d.get('checks', {})
    out.append('Checks: %d invented ids removed, %d points dropped. Tokens: %s' % (ch.get('invented_ids', 0), ch.get('dropped_points', 0), d.get('usage')))
    return '\n'.join(out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--date', help='YYYY-MM-DD, default today (local time)')
    ap.add_argument('--deep', action='store_true', help='use %s instead of %s for the summary' % (DEEP, FAST))
    ap.add_argument('--threshold', type=float, default=0.7)
    ap.add_argument('--products', help='product seed file (default care/data/hsa-products.json)')
    ap.add_argument('--print', action='store_true', help='also print the saved JSON')
    a = ap.parse_args()
    d = run(a.date, a.deep, a.threshold, a.products)
    print(summary(d))
    print('Saved', path_for(a.date))
    if a.print:
        print(json.dumps(d, indent=1, ensure_ascii=False))
