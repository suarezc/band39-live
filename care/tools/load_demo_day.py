"""Load the fictional demo day (care/data/demo-day.json) into a SEPARATE data folder, so the app and the
nightly digest can run on it without a live recording.

    ../.venv/bin/python tools/load_demo_day.py [--date YYYY-MM-DD] [--data experiments/data/demo] [--file data/demo-day.json] [--reset]

Run from care/. Defaults: --date today (local time), --data <project root>/experiments/data/demo (git-ignored,
like all of experiments/data/), --file care/data/demo-day.json. A relative --data is taken from the project
root (as server/digest.py does). It refuses any folder named "live": that is the real band's data.

The database is created by live.Store (whatever schema the current server code makes); rows are then
inserted with plain SQL using only the columns that exist. There is no audio: vemb stays NULL, temb (the
text embedding that powers search by meaning) comes from live.TextEmbedder.
--reset deletes the demo database first; without it, a date that already has phrases is refused.
"""
import argparse
import datetime as dt
import importlib
import json
import os
import random
import sqlite3
import sys
import time
import traceback
from pathlib import Path

CARE = Path(__file__).resolve().parent.parent
ROOT = CARE.parent
SERVER = CARE / 'server'
DEFAULT_DATA = ROOT / 'experiments' / 'data' / 'demo'
DEFAULT_FILE = CARE / 'data' / 'demo-day.json'

# plausible voice match (cosine to the person's voiceprint) and loudness at the wrist, by kind of voice
LOUD = {'mom': (-24.0, -17.0), 'visitor': (-29.0, -23.0), 'phone': (-31.0, -26.0), 'tv': (-34.0, -29.0), 'unknown': (-33.0, -29.0)}
MATCH = {'mom': (0.52, 0.78), 'visitor': (0.42, 0.66), 'phone': (0.40, 0.60), 'tv': (0.40, 0.55)}


def import_live(tries=3, wait=60):
    """live.py may be mid-edit by someone else: wait and retry, then give up with the error."""
    if str(SERVER) not in sys.path:
        sys.path.insert(0, str(SERVER))
    for n in range(tries):
        try:
            if 'live' in sys.modules:
                return importlib.reload(sys.modules['live'])
            return importlib.import_module('live')
        except Exception:
            err = traceback.format_exc()
            if n + 1 < tries:
                print('importing server/live.py failed (attempt %d of %d); retrying in %d s:\n%s' % (n + 1, tries, wait, err.strip().splitlines()[-1]))
                time.sleep(wait)
    sys.exit('Could not import server/live.py after %d attempts:\n%s' % (tries, err))


def resolve_data(arg):
    p = Path(arg).expanduser() if arg else DEFAULT_DATA
    if not p.is_absolute():
        p = ROOT / p
    p = p.resolve()
    if 'live' in p.parts:
        sys.exit('Refusing to write into %s: a folder named "live" holds the real band data. Use a demo folder.' % p)
    return p


def resolve_file(arg):
    if not arg:
        return DEFAULT_FILE
    p = Path(arg).expanduser()
    if p.is_absolute() or p.exists():
        return p.resolve()
    return (CARE / p).resolve()


def kind_of(key, who_kind, tags):
    if key == 'mom' or who_kind == 'main':
        return 'mom'
    if key == 'unknown' or who_kind == 'unknown':
        return 'unknown'
    if key == 'tv':
        return 'tv'
    return 'phone' if 'phone' in (tags or []) else 'visitor'


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--date', help='YYYY-MM-DD the day is placed on (default today, local time)')
    ap.add_argument('--data', help='demo data folder (default %s)' % DEFAULT_DATA)
    ap.add_argument('--file', help='the day file (default %s)' % DEFAULT_FILE)
    ap.add_argument('--reset', action='store_true', help='delete the demo database first')
    args = ap.parse_args()

    day = dt.date.fromisoformat(args.date) if args.date else dt.date.today()
    data = resolve_data(args.data)
    src = resolve_file(args.file)
    doc = json.loads(src.read_text())
    people = doc['people']
    phrases = doc['phrases']
    pkind = {p['key']: p.get('kind', 'voice') for p in people}
    pname = {p['key']: p.get('name') or p['key'] for p in people}
    bad = sorted({ph['who'] for ph in phrases} - set(pkind))
    if bad:
        sys.exit('Phrases name people not in "people": %s' % ', '.join(bad))

    live = import_live()
    np = live.np
    db_path = data / 'transcript.db'
    if args.reset:
        for suffix in ('', '-wal', '-shm', '-journal'):
            f = Path(str(db_path) + suffix)
            if f.exists():
                f.unlink()
    data.mkdir(parents=True, exist_ok=True)
    store = live.Store(str(db_path))         # creates whatever schema the current server code makes
    db = store.db

    cols = {r[1] for r in db.execute('pragma table_info(phrases)')}
    has_people = db.execute("select 1 from sqlite_master where type = 'table' and name = 'people'").fetchone() is not None
    pcols = {r[1] for r in db.execute('pragma table_info(people)')} if has_people else set()
    person_col = next((c for c in ('person_id', 'person', 'people_id') if c in cols), None)
    midnight = time.mktime(day.timetuple())                          # local midnight of --date
    end = time.mktime((day + dt.timedelta(days=1)).timetuple())
    session = day.isoformat()

    if db.execute('select count(*) from phrases where at >= ? and at < ?', (midnight, end)).fetchone()[0]:
        sys.exit('%s already has phrases for %s. Use --reset to start over, or another --date.' % (db_path, session))

    def at_of(hms):
        h, m, s = (int(x) for x in hms.split(':'))
        return midnight + h * 3600 + m * 60 + s       # the 2 am wake is the early hours of the same date

    # people (main person first), if this schema has them
    pid = {}
    if has_people and person_col:
        first = {}
        last = {}
        for ph in phrases:
            first.setdefault(ph['who'], at_of(ph['time']))
            last[ph['who']] = at_of(ph['time'])
        order = sorted((p for p in people if pkind[p['key']] != 'unknown'), key=lambda p: pkind[p['key']] != 'main')
        for p in order:
            k = p['key']
            if k not in first:
                continue
            row = {'name': p.get('name'), 'kind': 'main' if pkind[k] == 'main' else 'voice',
                   'centroid': np.zeros(512, dtype=np.float64).tobytes(),   # no audio: an empty voiceprint
                   'n': 0, 'created': first[k], 'last_heard': last[k]}
            row = {c: v for c, v in row.items() if c in pcols}
            cur = db.execute('insert into people (%s) values (%s)' % (', '.join(row), ', '.join('?' * len(row))), list(row.values()))
            pid[k] = cur.lastrowid

    print('Embedding %d phrases ...' % len(phrases))
    embedder = live.TextEmbedder()
    temb = embedder.embed([ph['text'] for ph in phrases])

    rnd = random.Random(day.toordinal())
    speaker_no = {}
    rows = []
    for i, ph in enumerate(phrases):
        k = ph['who']
        kind = kind_of(k, pkind[k], ph.get('tags'))
        at = at_of(ph['time'])
        words = max(1, len(ph['text'].split()))
        t0 = at - midnight + round(rnd.uniform(0.0, 0.6), 2)
        t1 = t0 + round(0.25 + words * rnd.uniform(0.28, 0.38), 2)
        conf = rnd.uniform(0.86, 0.97)
        if ph.get('misheard'):
            conf = rnd.uniform(0.55, 0.72)
        elif kind in ('phone', 'tv', 'unknown'):
            conf -= 0.05
        lo, hi = LOUD[kind]
        match = None if kind == 'unknown' else round(rnd.uniform(*MATCH[kind]), 2)
        voice = 'main' if kind == 'mom' else 'unsure' if kind == 'unknown' else 'other'
        row = {'session': session, 'at': at, 't0': round(t0, 2), 't1': round(t1, 2), 'text': ph['text'],
               'dg_speaker': speaker_no.setdefault(k, len(speaker_no)), 'voice': voice, 'match': match,
               'loud_db': round(rnd.uniform(lo, hi), 1), 'confidence': round(conf, 2), 'vemb': None,
               'temb': temb[i].astype('float32').tobytes()}
        if person_col:
            row[person_col] = pid.get(k)
        if 'inferred' in cols:
            row['inferred'] = 0
        rows.append({c: v for c, v in row.items() if c in cols})

    names = list(rows[0])
    with store.lock:
        db.executemany('insert into phrases (%s) values (%s)' % (', '.join(names), ', '.join('?' * len(names))),
                       [[r[c] for c in names] for r in rows])
        db.commit()

    # report
    counts = {}
    for ph in phrases:
        counts[ph['who']] = counts.get(ph['who'], 0) + 1
    fmt = lambda t: dt.datetime.fromtimestamp(t).strftime('%Y-%m-%d %H:%M:%S')   # noqa: E731
    ats = [r['at'] for r in rows]
    print('\nLoaded %d phrases for %s into %s' % (len(rows), session, db_path))
    print('  time range: %s to %s' % (fmt(min(ats)), fmt(max(ats))))
    for k, n in sorted(counts.items(), key=lambda x: -x[1]):
        print('  %-28s %4d  (voice %s%s)' % (pname[k], n, 'main' if pkind[k] == 'main' else 'unsure' if pkind[k] == 'unknown' else 'other',
                                             ', person id %s' % pid[k] if k in pid else ''))
    if not (has_people and person_col):
        print('  (this schema has no people table / person column: only the voice label was set)')
    print('  columns written: %s' % ', '.join(names))
    print('\nBrowse it (a second server, not the one on 8039):')
    print('  cd %s && BAND39_LIVE_DATA=%s ../.venv/bin/python server/server.py 8040' % (CARE, data))
    print('Nightly summary for that day:')
    print('  cd %s && BAND39_LIVE_DATA=%s ../.venv/bin/python server/digest.py --date %s --print' % (CARE, data, session))
    if not (SERVER / 'digest.py').exists():
        print('  (server/digest.py does not exist yet)')


if __name__ == '__main__':
    main()
