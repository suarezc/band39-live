"""Tests for care/server/watch.py (scam and fall / call-for-help alerts from the live transcript).

    .venv/bin/python care/tools/test_watch.py              # offline unit tests, then replays against the real Decisions API
    .venv/bin/python care/tools/test_watch.py --offline    # unit tests only (no network)

Part 1 uses a fake live object, a fake clock and an injected decide. Part 2 replays real-band phrases from
experiments/data/live/transcript.db (opened read-only; session 1114-151423) at 4x speed through the real API,
once with the voice labels as stored and once corrected, then 20-odd lines of ordinary chatter (ids 21-43).
Alerts are written to a temporary folder, never to the real data folder.
"""
import argparse
import os
import queue
import sqlite3
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'care', 'server'))
os.environ['BAND39_LIVE_DATA'] = tempfile.mkdtemp(prefix='watch-test-')
import watch  # noqa: E402

DB = os.path.join(ROOT, 'experiments', 'data', 'live', 'transcript.db')


class FakeLive:
    def __init__(self):
        self.clients, self.told = [], []

    def subscribe(self):
        q = queue.Queue()
        self.clients.append(q)
        return q

    def unsubscribe(self, q):
        if q in self.clients:
            self.clients.remove(q)

    def tell(self, event):
        self.told.append(event)
        for q in list(self.clients):
            q.put_nowait(event)

    def alerts(self):
        return [e for e in self.told if e.get('type') == 'alert']


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


class Decide:
    """Records each call; answers from a function of (text, questions)."""
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def __call__(self, text, questions):
        self.calls.append((text, dict(questions)))
        return self.answer(text, questions)


def final(i, at, text, voice='main', **kw):
    return dict({'type': 'final', 'id': i, 'text': text, 'voice': voice, 'at': at}, **kw)


def settle(w, secs=0.8):
    end = time.time() + secs
    while time.time() < end:
        time.sleep(0.05)
    deadline = time.time() + 5
    while w.busy and time.time() < deadline:
        time.sleep(0.05)
    time.sleep(0.3)


results = []


def check(name, ok, detail=''):
    results.append(ok)
    print('%-58s %s %s' % (name, 'OK ' if ok else 'FAIL', detail))


def low(text, q):
    return {k: 0.05 for k in q}


def unit_tests():
    print('== Part 1: offline unit tests ==')
    # window trimming to 45 s
    live, clock, d = FakeLive(), Clock(1060), Decide(low)
    w = watch.start(live, d, clock)
    live.tell(final(1, 1000, 'old line'))
    live.tell(final(2, 1010, 'still old'))
    live.tell(final(3, 1050, 'recent line'))
    settle(w)
    text = d.calls[0][0] if d.calls else ''
    check('window keeps only the last 45 s', len(d.calls) == 1 and 'recent line' in text and 'old line' not in text and 'still old' not in text)
    # nothing changed -> no call
    clock.t += 10
    settle(w)
    check('no evaluation while nothing has changed', len(d.calls) == 1)
    # debounce
    live.tell(final(4, 1070, 'a'))
    settle(w)
    n = len(d.calls)
    clock.t += 1
    live.tell(final(5, 1071, 'b'))
    settle(w)
    check('debounce: no second call within 3 s', len(d.calls) == n, 'calls=%d' % len(d.calls))
    clock.t += 3
    settle(w)
    check('debounce: pending phrases are judged after 3 s', len(d.calls) == n + 1 and "Mom: b" in d.calls[-1][0])
    check('scam not asked when only Mom spoke', all('scam' not in q for _, q in d.calls))
    w.stop()

    # labels, scam asked when someone else spoke, thresholds, alert shape
    live, clock = FakeLive(), Clock(2000)
    d = Decide(lambda t, q: {'scam': 0.69, 'help': 0.69, 'alarm': 0.69, 'fine': 0.9})
    w = watch.start(live, d, clock)
    live.tell(final(10, 1990, 'Hello dear.'))
    live.tell(final(11, 1992, 'This is your bank. Buy gift cards today and read me the numbers.', 'other'))
    live.tell(final(12, 1994, 'Who is this?', 'unsure'))
    live.tell(final(13, 1995, "Don't tell anyone.", 'other', person='Voice 2'))
    settle(w)
    check('0.69 everywhere: no alert', not live.alerts())
    d.answer = lambda t, q: {'scam': 0.7, 'help': 0.1, 'alarm': 0.1, 'fine': 0.9}
    clock.t += 3
    live.tell(final(14, 1997, 'Okay.'))
    settle(w)
    t, q = d.calls[-1]
    check('lines labelled Mom / Someone else / Not sure who / name',
          'Mom: Hello dear.' in t and 'Someone else: This is your bank' in t and 'Not sure who: Who is this?' in t and "Voice 2: Don't tell anyone." in t)
    check('scam asked when another voice is in the window', 'scam' in q and set(q) == {'scam', 'help', 'alarm', 'fine'})
    a = live.alerts()
    check('scam 0.70: one scam alert', len(a) == 1 and a[0]['kind'] == 'scam')
    if a:
        a = a[0]
        shape = {'type', 'id', 'kind', 'probability', 'probabilities', 'title', 'text', 'quote', 'evidence', 'at'} <= set(a)
        check('alert shape', shape and set(a['probabilities']) == {'scam', 'help', 'alarm', 'fine'} and a['probability'] == 0.7,
              'quote=%r evidence=%s' % (a['quote'], a['evidence']))
        check('scam quote only from non-Mom lines, <= 140 chars',
              'Hello dear' not in a['quote'] and 'gift cards' in a['quote'] and len(a['quote']) <= 140 and 10 not in a['evidence'])
        saved = open(os.path.join(os.environ['BAND39_LIVE_DATA'], 'alerts.jsonl')).read()
        check('alert appended to alerts.jsonl', a['id'] in saved)
    # cooldown
    clock.t += 30
    live.tell(final(15, 2025, 'Gift cards now!', 'other'))
    settle(w)
    check('cooldown: no second scam alert after 30 s', len(live.alerts()) == 1)
    clock.t += 31
    live.tell(final(16, 2056, 'Gift cards now, I said!', 'other'))
    settle(w)
    check('after 60 s a new scam alert is allowed', len(live.alerts()) == 2)
    # fine never suppresses help
    d.answer = lambda t, q: {'scam': 0.1, 'help': 0.9, 'alarm': 0.2, 'fine': 0.99}
    clock.t += 3
    live.tell(final(17, 2059, "Help, I've fallen.", 'other'))
    live.tell(final(18, 2060, "I'm fine."))
    settle(w)
    h = [x for x in live.alerts() if x['kind'] == 'help']
    check('help 0.9 + fine 0.99: help alert still raised, fine reported',
          len(h) == 1 and h[0]['probabilities']['fine'] == 0.99 and 'fallen' in h[0]['quote'], h[0]['quote'] if h else '')
    d.answer = lambda t, q: {'scam': 0.1, 'help': 0.1, 'alarm': 0.8, 'fine': 0.5}
    clock.t += 61
    live.tell(final(19, 2121, 'Oh my god, are you okay?', 'other'))
    settle(w)
    check('alarm 0.8 alone raises a help alert', len([x for x in live.alerts() if x['kind'] == 'help']) == 2)
    w.stop()

    # an erroring decide is survived
    live, clock = FakeLive(), Clock(3000)

    def boom(t, q):
        raise RuntimeError('status 503')
    d = Decide(boom)
    w = watch.start(live, d, clock)
    live.tell(final(20, 3000, 'hello'))
    settle(w)
    d.answer = lambda t, q: {'scam': 0.1, 'help': 0.95, 'alarm': 0.1, 'fine': 0.1}
    clock.t += 3
    live.tell(final(21, 3003, 'Help me!'))
    settle(w)
    check('an erroring decide is logged and survived', w.thread.is_alive() and w.stats['errors'] == 1 and len(live.alerts()) == 1)
    w.stop()

    # one call in flight
    live, clock, gate = FakeLive(), Clock(4000), threading.Event()

    def slow(t, q):
        gate.wait(5)
        return low(t, q)
    d = Decide(slow)
    w = watch.start(live, d, clock)
    live.tell(final(30, 4000, 'one'))
    time.sleep(0.5)
    for i in range(5):
        clock.t += 4
        live.tell(final(31 + i, clock.t, 'more %d' % i))
        time.sleep(0.3)
    check('slow call: one in flight, no pile-up', len(d.calls) == 1, 'calls=%d' % len(d.calls))
    gate.set()
    settle(w, 1.0)
    check('phrases that arrived meanwhile are judged when it returns', len(d.calls) == 2 and 'more 4' in d.calls[1][0], 'calls=%d' % len(d.calls))
    w.stop()


# ---- Part 2: replays against the real Decisions API -------------------------------------------
WEARER = {44, 45, 47, 48, 49, 50, 51, 52, 60, 61, 62, 63, 65}
SECOND = {53, 54, 55, 56, 57, 58, 59, 64}
# The labels the DB held when the scene was first studied (the server re-assigns voices later, so the DB changes):
ORIGINAL = {48: 'main', 49: 'unsure', 50: 'main', 51: 'main', 52: 'unsure', 60: 'unsure', 61: 'main', 62: 'unsure', 63: 'other', 64: 'other', 65: 'other'}


def rows(lo, hi):
    c = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
    out = [dict(zip(('id', 'at', 't0', 't1', 'text', 'voice', 'match'), r)) for r in
           c.execute('select id, at, t0, t1, text, voice, match from phrases where id between ? and ? order by at', (lo, hi))]
    c.close()
    return out


def replay(name, phrases, speed=4.0):
    print('\n== %s (%d phrases, %.0f s of talk at %gx) ==' % (name, len(phrases), phrases[-1]['at'] - phrases[0]['at'], speed))
    live = FakeLive()
    base, start = phrases[0]['at'], time.time()
    w = watch.start(live, None, lambda: base + (time.time() - start) * speed)
    print('  labels: ' + ' '.join('%d:%s' % (p['id'], p['voice']) for p in phrases))
    told = {}
    for p in phrases:
        delay = start + (p['at'] - base) / speed - time.time()
        if delay > 0:
            time.sleep(delay)
        live.tell(dict(p, type='final'))
        told[p['id']] = p
    time.sleep(1.0)
    deadline = time.time() + 30
    while (w.busy or w.dirty) and time.time() < deadline:
        time.sleep(0.2)
    w.stop()
    f = lambda v: '  -  ' if v is None else '%.2f' % v
    print('  t(s)  last id  scam  help alarm  fine  latency  fired')
    for e in w.stats['log']:
        pr = e['probabilities']
        print('  %5.1f  %7s  %s  %s  %s  %s   %5.2fs  %s' % (e['at'] - base, e['ids'][-1], f(pr['scam']), f(pr['help']), f(pr['alarm']), f(pr['fine']),
                                                           e['latency'], ','.join(e['fired']) or ''))
    for a in live.alerts():
        print('  ALERT %-4s p=%.2f at t=%.1f s (after id %s): %s | "%s"' % (a['kind'], a['probability'], a['at'] - base,
              max(i for i, p in told.items() if p['at'] <= a['at']), a['title'], a['quote']))
    lat = w.stats['latencies']
    minutes = (phrases[-1]['at'] - base) / 60
    print('  calls=%d errors=%d alerts=%d  latency mean %.2fs max %.2fs  calls per minute of talk %.1f' % (
        w.stats['calls'], w.stats['errors'], w.stats['alerts'], sum(lat) / max(1, len(lat)), max(lat or [0]), w.stats['calls'] / minutes))
    return live.alerts(), w


def first_alert_after(alerts, phrases, kind):
    a = [x for x in alerts if x['kind'] == kind]
    if not a:
        return None
    return max(p['id'] for p in phrases if p['at'] <= a[0]['at'])


def real_tests():
    print('\n== Part 2: replays against the real Decisions API ==')
    scene = rows(48, 65)
    for label, phrases in (('labels as first stored', [dict(p, voice=ORIGINAL.get(p['id'], 'other')) for p in scene]),
                           ('labels in the DB now', scene),
                           ('corrected labels', [dict(p, voice='main' if p['id'] in WEARER else 'other') for p in scene])):
        alerts, w = replay('Scene 48-65, ' + label, phrases)
        scams = [a for a in alerts if a['kind'] == 'scam']
        s_at, h_at = first_alert_after(alerts, phrases, 'scam'), first_alert_after(alerts, phrases, 'help')
        early = [e for e in w.stats['log'] if e['ids'][-1] <= 52 and e['fired']]
        check('%s: no alert during 48-52' % label, not early)
        check('%s: scam alert during 54-59' % label, s_at is not None and 54 <= s_at <= 59, 'fired after id %s' % s_at)
        check('%s: help alert at 63 or 64' % label, h_at in (63, 64), 'fired after id %s' % h_at)
        check('%s: one scam alert (cooldown)' % label, len(scams) == 1, 'scam alerts=%d' % len(scams))
    alerts, w = replay('Ordinary chatter 21-43, labels in the DB now', rows(21, 43))
    check('ordinary chatter: no false alarm', not alerts, ', '.join('%s %.2f' % (a['kind'], a['probability']) for a in alerts))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--offline', action='store_true', help='unit tests only')
    args = ap.parse_args()
    unit_tests()
    if not args.offline:
        real_tests()
    print('\n%d checks, %d failed.' % (len(results), results.count(False)))
    sys.exit(0 if all(results) else 1)
