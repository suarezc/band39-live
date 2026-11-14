"""Offline test of server/digest.py: a made-up day in a temporary SQLite DB, fake model answers, no API calls.

    ../.venv/bin/python tools/test_digest.py        (from care/)
"""
import datetime as dt
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'server'))
import digest  # noqa: E402

DAY = dt.date(2026, 3, 2)
LINES = [  # id, voice, text, person_id
    (1, 'main', 'I forgot my blood pressure pills again this morning.', 1),
    (2, 'unsure', 'My knee hurts when I walk to the shop.', 1),
    (3, 'other', 'This is your bank. Buy gift cards and read me the numbers.', 2),
    (4, 'main', 'Lisa is coming on Saturday.', 1),
    (5, 'unknown', 'The weather is nice.', None),
]
CATALOG = {
    'updated': 'test', 'about': 'test', 'eligibility_key': {'eligible': 'HSA/FSA eligible', 'lmn': 'Needs LMN', 'dual': 'Dual use'},
    'needs': [{'id': 'medication', 'label': 'Medication routine', 'question': 'Does she forget her pills?'},
              {'id': 'joint_pain', 'label': 'Joint pain', 'question': 'Does she mention knee pain?'},
              {'id': 'hearing', 'label': 'Hearing', 'question': 'Does she mention trouble hearing?'}],
    'products': [
        {'id': 'm_dual_cheap', 'name': 'M dual', 'category': 'x', 'needs': ['medication'], 'eligibility': 'dual', 'price_usd': [5, 9], 'why': 'w', 'source': 's'},
        {'id': 'm_lmn', 'name': 'M lmn', 'category': 'x', 'needs': ['medication'], 'eligibility': 'lmn', 'price_usd': [50, 90], 'why': 'w', 'source': 's'},
        {'id': 'm_elig_dear', 'name': 'M elig dear', 'category': 'x', 'needs': ['medication'], 'eligibility': 'eligible', 'price_usd': [40, 60], 'why': 'w', 'source': 's'},
        {'id': 'm_elig_cheap', 'name': 'M elig cheap', 'category': 'x', 'needs': ['medication'], 'eligibility': 'eligible', 'price_usd': [20, 30], 'why': 'w', 'source': 's'},
        {'id': 'j1', 'name': 'J1', 'category': 'x', 'needs': ['joint_pain'], 'eligibility': 'eligible', 'price_usd': [10, 20], 'why': 'w', 'source': 's'},
        {'id': 'j2', 'name': 'J2', 'category': 'x', 'needs': ['joint_pain'], 'eligibility': 'eligible', 'price_usd': [11, 20], 'why': 'w', 'source': 's'},
        {'id': 'j3', 'name': 'J3', 'category': 'x', 'needs': ['joint_pain'], 'eligibility': 'eligible', 'price_usd': [12, 20], 'why': 'w', 'source': 's'},
        {'id': 'h1', 'name': 'H1', 'category': 'x', 'needs': ['hearing'], 'eligibility': 'eligible', 'price_usd': [100, 200], 'why': 'w', 'source': 's'},
        {'id': 'h2', 'name': 'H2', 'category': 'x', 'needs': ['hearing'], 'eligibility': 'eligible', 'price_usd': [100, 200], 'why': 'w', 'source': 's'},
    ]}

fails = 0


def check(name, ok):
    global fails
    fails += not ok
    print('%-62s %s' % (name, 'ok' if ok else 'FAIL'))


def make_db(path, with_people):
    con = sqlite3.connect(path)
    con.execute('create table phrases (id integer primary key, session text, at real, t0 real, t1 real, text text, dg_speaker integer, voice text, '
                'match real, loud_db real, confidence real%s)' % (', person_id integer' if with_people else ''))
    if with_people:
        con.execute('create table people (id integer primary key, name text, kind text)')
        con.executemany('insert into people values (?,?,?)', [(1, 'Margaret', 'main'), (2, '', 'other')])
    base = time.mktime(DAY.timetuple()) + 9 * 3600
    for i, voice, text, pid in LINES:
        cols = (i, 's', base + i * 60, 0, 1, text, 0, voice, 0.5, -30, 0.9) + ((pid,) if with_people else ())
        con.execute('insert into phrases values (%s)' % ','.join('?' * len(cols)), cols)
    con.execute('insert into phrases (id, at, text, voice%s) values (99, ?, ?, ?%s)' % ((', person_id', ', 1') if with_people else ('', '')),
                (base - 86400, 'Yesterday I fell.', 'main'))   # another day: must not count
    con.commit(); con.close()


def fake_decide(need_p):
    def decide(text, questions):
        if any(k in questions for k in ('m_elig_cheap', 'j1', 'h1')):          # product-fit check: all fit except m_lmn
            return {k: (0.1 if k == 'm_lmn' else 0.9) for k in questions}, 10
        if 'scam' in questions:
            return {'scam': 0.9, 'distress': 0.1, 'fall': 0.2, 'medication': 0.6}, 10
        return {k: need_p.get(k, 0.0) for k in questions}, 10
    return decide


def fake_write(prompt, schema, model):
    return {'headline': 'A calm day.',
            'for_caregiver': [{'text': 'She mentioned Lisa coming Saturday.', 'evidence': [4]},
                              {'text': 'Invented point.', 'evidence': [777]},
                              {'text': 'Mixed ids.', 'evidence': [1, 888]},
                              {'text': 'Yesterday id.', 'evidence': [99]}],
            'for_doctor': [{'text': 'She mentioned forgetting her pills; worth asking about.', 'evidence': [1]}, {'text': 'No evidence.', 'evidence': []}],
            'reminders': [{'what': 'Lisa visits', 'when': 'Saturday', 'evidence': [4]}, {'what': 'Fake', 'when': 'Never', 'evidence': [12345]}],
            'flags': [{'kind': 'scam', 'text': 'A voice said it was her bank and asked for gift card numbers.', 'evidence': [3, 4242]},
                      {'kind': 'fall', 'text': 'Invented fall.', 'evidence': [3]}],
            'needs': [{'id': 'medication', 'evidence': [1, 3, 555]},     # 3 is another voice, 555 invented: both removed
                      {'id': 'joint_pain', 'evidence': [2]}, {'id': 'hearing', 'evidence': [1]}]}, 20


tmp = Path(tempfile.mkdtemp())
os.environ['BAND39_LIVE_DATA'] = str(tmp / 'data')
cat_path = tmp / 'products.json'
cat_path.write_text(json.dumps(CATALOG))

for with_people in (False, True):
    tag = 'people' if with_people else 'no people'
    db = tmp / ('t_%s.db' % with_people)
    make_db(db, with_people)
    lines = digest.read_day(DAY, db)
    check('[%s] reads only that day (5 lines)' % tag, [l['id'] for l in lines] == [1, 2, 3, 4, 5])
    names = {l['id']: l['who'] for l in lines}
    want = {1: 'Margaret', 3: 'Someone else', 5: 'Not sure'} if with_people else {1: 'Mom', 3: 'Someone else', 5: 'Not sure'}
    check('[%s] speaker names %s' % (tag, want), all(names[k] == v for k, v in want.items()))
    check('[%s] unsure line kept as "probably Mom"' % tag, any(l['id'] == 2 and l['maybe_mom'] and not l['certain'] for l in lines))

    d = digest.run(DAY, threshold=0.7, products=cat_path, db=db, decide=fake_decide({'medication': 0.95, 'joint_pain': 0.8, 'hearing': 0.75}), write=fake_write)
    valid = {l['id'] for l in lines}
    texts = [l['text'] for l in lines]
    ev = [i for sec in (d['for_caregiver']['points'], d['for_doctor']['points'], d['reminders'], d['flags'], d['needs']) for p in sec for i in p['evidence']]
    check('[%s] every evidence id is a real id from that day' % tag, ev and all(i in valid for i in ev))
    check('[%s] invented-only points dropped, mixed point keeps real ids' % tag,
          [p['text'] for p in d['for_caregiver']['points']] == ['She mentioned Lisa coming Saturday.', 'Mixed ids.']
          and d['for_caregiver']['points'][1]['evidence'] == [1])
    check('[%s] point with no evidence dropped' % tag, len(d['for_doctor']['points']) == 1 and len(d['reminders']) == 1)
    check('[%s] flags: scam (0.9) and medication (0.6) only, by probability' % tag, [f['kind'] for f in d['flags']] == ['scam', 'medication'])
    check('[%s] scam flag keeps writer text, drops invented id' % tag, d['flags'][0]['evidence'] == [3] and 'gift card' in d['flags'][0]['text'])
    check('[%s] quotes are verbatim stored phrases' % tag, d['recommended'] and all(any(r['evidence_quote'] in t for t in texts) for r in d['recommended'])
          and d['recommended'][0]['evidence_quote'] == LINES[0][2])
    ids = [r['product_id'] for r in d['recommended']]
    check('[%s] at most 5 in total' % tag, len(ids) == 5)
    check('[%s] at most 2 per need' % tag, all(sum(r['need'] == n for r in d['recommended']) <= 2 for n in ('medication', 'joint_pain', 'hearing')))
    check('[%s] order: eligible before lmn before dual, then cheaper' % tag, ids[:2] == ['m_elig_cheap', 'm_elig_dear'] and ids[2:4] == ['j1', 'j2'])
    check('[%s] saved and load() returns it' % tag, digest.load(DAY) == d)

    d = digest.run(DAY, threshold=0.7, products=cat_path, db=db, decide=fake_decide({'medication': 0.69, 'joint_pain': 0.2}), write=fake_write)
    check('[%s] threshold respected (0.69 < 0.7): nothing to suggest' % tag, d['recommended'] == [] and d['nothing_to_suggest'] == 'Nothing to suggest today')
    d = digest.run(DAY, threshold=0.6, products=cat_path, db=db, decide=fake_decide({'medication': 0.69}), write=fake_write)
    check('[%s] lower threshold 0.6 -> 2 medication products' % tag, [r['product_id'] for r in d['recommended']] == ['m_elig_cheap', 'm_elig_dear'])

    def broken(*a):
        raise RuntimeError('Summary model x status 503')
    d = digest.run(DAY, products=cat_path, db=db, decide=fake_decide({'medication': 0.9}), write=broken)
    check('[%s] summary failure: reported, needs and flags still there' % tag, 'status 503' in ' '.join(d['errors']) and d['needs'] and d['recommended'])
    check('[%s] summary failure: fallback flag evidence is real' % tag, d['flags'] and all(i in valid for f in d['flags'] for i in f['evidence']))

d = digest.run(dt.date(2026, 3, 9), products=cat_path, db=tmp / 't_True.db', decide=fake_decide({}), write=fake_write)
check('empty day: no model calls needed, calm headline', d['coverage']['phrases'] == 0 and d['recommended'] == [])
d = digest.run(DAY, products=tmp / 'missing.json', db=tmp / 't_True.db', decide=fake_decide({}), write=fake_write)
check('missing product file: reported, no recommendations', d['recommended'] == [] and any('product list' in e for e in d['errors']))
cat2 = json.loads(json.dumps(CATALOG)); cat2['products'] = [p for p in cat2['products'] if p['id'] in ('m_lmn', 'j1')]
cat2_path = tmp / 'products2.json'; cat2_path.write_text(json.dumps(cat2))
w_noev = lambda *a: ({**fake_write(*a)[0], 'needs': [{'id': 'medication', 'evidence': [1]}, {'id': 'joint_pain', 'evidence': []}]}, 1)
d = digest.run(DAY, products=cat2_path, db=tmp / 't_True.db', decide=fake_decide({'medication': 0.95, 'joint_pain': 0.95}), write=w_noev)
n = {x['id']: x for x in d['needs']}
check('need evidence: only Mom lines the model picked, invented/other dropped', n['medication']['evidence'] == [1])
check('need above threshold but no supporting line: no product', not any(r['need'] == 'joint_pain' for r in d['recommended']))
check('product that does not fit her words (fit 0.1) is not shown', not any(r['product_id'] == 'm_lmn' for r in d['recommended']))
print('\n%s' % ('ALL PASSED' if not fails else '%d FAILED' % fails))
sys.exit(1 if fails else 0)
