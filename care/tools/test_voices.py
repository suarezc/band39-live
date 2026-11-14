"""Who is speaking, tuned offline on stored phrases: runs the live transcript's own assignment code
(server/live.py: Voices, rebuild) over a transcript database's voice embeddings, in time order,
and shows how many people it finds and whether each phrase went to the right one.

    ../.venv/bin/python tools/test_voices.py COPY-OF-transcript.db [--sweep]

The database is opened read-only; nothing is written. Ground truth is session 1114-151423 (a script two
people followed on the real band): MAN = the main speaker, WOMAN = a second person close to the band.
"""
import itertools
import os
import sqlite3
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
import live  # noqa: E402

SESSION = '1114-151423'
MAN = {44, 45, 47, 48, 49, 50, 51, 52, 60, 61, 62, 63, 65}
WOMAN = {53, 54, 55, 56, 57, 58, 59, 64}
TRUTH = {**{i: 'man' for i in MAN}, **{i: 'woman' for i in WOMAN}}


def load(path, lo=21, hi=65):
    db = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
    rows = db.execute('select id, session, at, t0, t1, dg_speaker, loud_db, vemb, text from phrases where id between ? and ? order by at, id', (lo, hi)).fetchall()
    return [{'id': i, 'session': s, 'at': at, 't0': t0, 't1': t1, 'speaker': sp, 'loud_db': loud, 'seconds': t1 - t0, 'text': text,
             'vemb': None if b is None else np.frombuffer(b, dtype=np.float32).astype(np.float64)} for i, s, at, t0, t1, sp, loud, b, text in rows]


def online(phrases):
    """As the live server does it: one phrase at a time, merging as it goes."""
    eng, got, heard = live.Voices(), {}, []
    for ph in phrases:
        r = eng.assign(ph, heard)
        eng.merge_similar()
        got[ph['id']] = r
        heard.append(dict(ph, **r))
    for r in got.values():
        r['person_id'] = eng.resolve(r['person_id']) if r['person_id'] else None
    return eng, got


def table(eng, got, phrases):
    pids = sorted({r['person_id'] for i, r in got.items() if i in TRUTH and r['person_id']})
    name = lambda pid: live.display_name(pid, eng.people[pid].kind, None) if pid else 'Not sure'   # noqa: E731
    cols = [name(p) for p in pids] + ['Not sure']
    lines = ['%-7s ' % 'truth' + ''.join('%10s' % c for c in cols)]
    wrong = 0
    for who in ('man', 'woman'):
        ids = [i for i in TRUTH if TRUTH[i] == who]
        counts = [sum(1 for i in ids if got[i]['person_id'] == p) for p in pids] + [sum(1 for i in ids if not got[i]['person_id'])]
        lines.append('%-7s ' % who + ''.join('%10d' % c for c in counts))
    # wrong: a scripted phrase given to the person who is mostly the other speaker
    owner = {}
    for p in pids:
        m = sum(1 for i in MAN if got[i]['person_id'] == p)
        w = sum(1 for i in WOMAN if got[i]['person_id'] == p)
        owner[p] = 'man' if m > w else 'woman' if w > m else None
    wrong = [i for i in TRUTH if got[i]['person_id'] and owner.get(got[i]['person_id']) not in (None, TRUTH[i])]
    return '\n'.join(lines), wrong, owner


def report(title, eng, got, phrases, detail=False):
    print('== %s' % title)
    s = [ph for ph in phrases if ph['session'] == SESSION]
    print('session %s: %d people heard in it' % (SESSION, len({got[ph['id']]['person_id'] for ph in s if got[ph['id']]['person_id']})))
    t, wrong, owner = table(eng, got, phrases)
    print(t)
    print('scripted phrases given to the wrong person: %s' % (wrong or 'none'))
    sizes = {}
    for ph in phrases:
        pid = got[ph['id']]['person_id']
        sizes[pid] = sizes.get(pid, 0) + 1
    print('all real-band phrases (ids %d-%d): %d people; sizes %s; not sure %d' % (
        phrases[0]['id'], phrases[-1]['id'], len([p for p in sizes if p]),
        ', '.join('%s=%d' % (live.display_name(p, eng.people[p].kind, None), n) for p, n in sorted((p, n) for p, n in sizes.items() if p)), sizes.get(None, 0)))
    if detail:
        for ph in phrases:
            r = got[ph['id']]
            print('  %3d %-6s %4.1fs %6s dB dg%s  %-9s%s match %5s  %s' % (
                ph['id'], TRUTH.get(ph['id'], '?'), ph['seconds'], ph['loud_db'], ph['speaker'],
                live.display_name(r['person_id'], eng.people[r['person_id']].kind, None) if r['person_id'] else 'Not sure',
                '?' if r.get('inferred') else ' ', r['match'], ph['text'][:44]))
    return wrong, len([p for p in sizes if p])


def sweep(phrases):
    print('== threshold sweep (online / rebuild): wrong scripted, people in ids 21-65, unsure scripted')
    keep = {k: getattr(live, k) for k in ('JOIN', 'SOLID', 'MERGE')}
    for join, merge in itertools.product((0.20, 0.25, 0.30, 0.40, 0.50, 0.55, 0.60), (0.35, 0.40, 0.45, 0.50, 0.60, 0.70)):
        solid = max(join, 0.50)
        live.JOIN, live.SOLID, live.MERGE = join, solid, merge
        out = []
        for run in (online, lambda p: live.rebuild(p)):
            eng, got = run(phrases)
            _, wrong, _ = table(eng, got, phrases)
            unsure = sum(1 for i in TRUTH if not got[i]['person_id'])
            out.append('%d wrong %d people %2d unsure' % (len(wrong), len({r['person_id'] for r in got.values() if r['person_id']}), unsure))
        print('JOIN %.2f SOLID %.2f MERGE %.2f   online: %s   rebuild: %s' % (join, solid, merge, out[0], out[1]))
    for k, v in keep.items():
        setattr(live, k, v)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    phrases = load(sys.argv[1])
    print('thresholds: LONG %.1f s  JOIN %.2f  SOLID %.2f  SHORT %.2f (+%.2f margin)  NEW >= %.1f s and >= %.0f dB  MERGE %.2f  DG gap %.1f s' % (
        live.LONG_SECONDS, live.JOIN, live.SOLID, live.SHORT_JOIN, live.SHORT_MARGIN, live.NEW_MIN_SECONDS, live.NEW_MIN_DB, live.MERGE, live.DG_GAP))
    if '--sweep' in sys.argv:
        sweep(phrases)
    report('online (as phrases arrive)', *online(phrases), phrases, detail=True)
    report('rebuild (POST /api/live/recluster)', *live.rebuild(phrases), phrases, detail=True)
