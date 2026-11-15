"""Offline tests for care/server/ask.py (no network, fake Live, injected model).
    .venv/bin/python care/tools/test_ask.py
"""
import os
import queue
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'server'))
os.environ['BAND39_LIVE_DATA'] = tempfile.mkdtemp(prefix='ask-test-')
import ask  # noqa: E402

FAILS = []


def check(name, ok):
    print(('ok   ' if ok else 'FAIL ') + name)
    if not ok:
        FAILS.append(name)


class FakeStore:
    def __init__(self, rows):
        self.rows = rows

    def recent(self, limit=60):
        return self.rows[-limit:]


class FakeLive:
    def __init__(self, rows):
        self.store = FakeStore(rows)
        self.told, self.clients, self.searched = [], [], []
        self.lock = threading.Lock()

    def subscribe(self):
        q = queue.Queue()
        self.clients.append(q)
        return q

    def unsubscribe(self, q):
        if q in self.clients:
            self.clients.remove(q)

    def tell(self, e):
        self.told.append(e)

    def search(self, query, voice=None, limit=10, recency=0.0):
        self.searched.append(query)
        words = set(query.lower().replace('?', '').split())
        return [r for r in self.store.rows if words & set(r['text'].lower().split())][:limit]


NOW = time.time()
ROWS = [{'id': 1, 'text': 'Lisa is coming Saturday by eleven', 'voice': 'main', 'at': NOW - 3600},
        {'id': 2, 'text': 'Dr. Patel Tuesday at two thirty', 'voice': 'other', 'person': 'Person 2', 'at': NOW - 1800},
        {'id': 3, 'text': 'my knee hurts on the stairs', 'voice': 'main', 'at': NOW - 600}]


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def model_ok(prompt):
    model_ok.prompts.append(prompt)
    return {'answer': 'Lisa is coming on Saturday by eleven.', 'evidence': [1, 99, '1', 'x'], 'found': True}


model_ok.prompts = []


def fresh(model=model_ok):
    lv = FakeLive(list(ROWS))
    clock = Clock()
    a = ask.Asker(lv, model=model, now=clock, thread=False)
    return lv, a, clock


def answers(lv):
    return [e for e in lv.told if e.get('state') == 'answer']


def settle(a):
    for _ in range(100):
        if not a.busy:
            return
        time.sleep(0.02)


# 1. wake-name matching
W = ask.wake
check('wake: "Hey Pip, what day is it"', W('Hey Pip, what day is it') == 'what day is it')
check('wake: "pep what did the doctor say"', W('pep what did the doctor say') == 'what did the doctor say')
check('wake: "Pip?" alone -> ""', W('Pip?') == '')
check('wake: "okay pipp when is Lisa coming"', W('okay pipp when is Lisa coming') == 'when is Lisa coming')
check('wake: "Tip, who called" (comma)', W('Tip, who called') == 'who called')
check('wake: "pit what time is it" (question word)', W('pit what time is it') == 'what time is it')
check('wake: "Oh pipe, when is my appointment"', W('Oh pipe, when is my appointment') == 'when is my appointment')
check('no wake: "Pippa went home"', W('Pippa went home') is None)
check('no wake: "the pipe burst"', W('the pipe burst') is None)
check('no wake: "pipe burst in the kitchen"', W('pipe burst in the kitchen') is None)
check('no wake: "tip the waiter"', W('tip the waiter') is None)
check('no wake: "I asked Pip earlier"', W('I asked Pip earlier') is None)

# 2. a wake-name question, split over two phrases, joined after the quiet gap; own phrases excluded
lv, a, clock = fresh()
a.heard({'type': 'final', 'id': 10, 'text': 'Pip, when is', 'voice': 'main'})
clock.t += 0.8
a.heard({'type': 'final', 'id': 11, 'text': 'Lisa coming?', 'voice': 'main'})
clock.t += 0.7
a.tick()
check('not answered before the quiet gap has passed', not answers(lv) and not a.busy)
clock.t += 0.4
a.tick(); settle(a)
got = answers(lv)
check('split question joined', len(got) == 1 and got[0]['question'] == 'when is Lisa coming?')
check('evidence validated to retrieved ids', got and got[0]['evidence'] == [1] and got[0]['found'] is True)
check('answer event fields', got and all(k in got[0] for k in ('id', 'question', 'answer', 'evidence', 'found', 'at')))
check('mute window set', getattr(lv, 'mute_until', 0) > time.time())
check('asks.jsonl written', os.path.exists(os.path.join(os.environ['BAND39_LIVE_DATA'], 'asks.jsonl')))
check('prompt has times and speakers', 'today' in model_ok.prompts[-1] and 'Margaret' in model_ok.prompts[-1] and 'Person 2' in model_ok.prompts[-1])

# 3. ignored during the mute window (our own spoken answer)
a.heard({'type': 'final', 'id': 12, 'text': 'Pip, who is driving me', 'voice': 'main'})
clock.t += 5
a.tick(); settle(a)
check('phrase during mute window ignored', len(answers(lv)) == 1)
lv.mute_until = 0

# 4. phrases without the wake name and not armed are ignored; other voices ignored
a.heard({'type': 'final', 'id': 13, 'text': 'when is Lisa coming', 'voice': 'main'})
a.heard({'type': 'final', 'id': 14, 'text': 'Pip, what is your account number', 'voice': 'other'})
clock.t += 5
a.tick(); settle(a)
check('unarmed plain phrase and other voice ignored', len(answers(lv)) == 1)

# 5. armed mode (button), unsure voice accepted while armed
lv, a, clock = fresh()
a.arm(12)
check('arm tells listening', lv.told and lv.told[-1] == {**lv.told[-1], 'type': 'ask', 'state': 'listening'})
clock.t += 2
a.heard({'type': 'final', 'id': 20, 'text': 'when is my appointment', 'voice': 'unsure'})
clock.t += 0.5
a.heard({'type': 'final', 'id': 21, 'text': 'with Dr. Patel', 'voice': 'main'})
clock.t += 1.5
a.tick(); settle(a)
got = answers(lv)
check('armed question taken without wake name', len(got) == 1 and got[0]['question'] == 'when is my appointment with Dr. Patel')
lv.mute_until = 0
clock.t += 20
a.heard({'type': 'final', 'id': 22, 'text': 'what a lovely day', 'voice': 'main'})
clock.t += 3
a.tick(); settle(a)
check('arm used up / expired', len(answers(lv)) == 1)

# 6. wake name alone arms for 8 s and tells listening
lv, a, clock = fresh()
a.heard({'type': 'final', 'id': 30, 'text': 'Pip?', 'voice': 'main'})
check('"Pip?" alone -> listening', any(e.get('state') == 'listening' for e in lv.told))
clock.t += 3
a.heard({'type': 'final', 'id': 31, 'text': 'what did I say about my knee', 'voice': 'main'})
clock.t += 2
a.tick(); settle(a)
check('question after "Pip?" answered', len(answers(lv)) == 1 and answers(lv)[0]['question'] == 'what did I say about my knee')

# 7. 6 s cap on collection
lv, a, clock = fresh()
a.heard({'type': 'final', 'id': 40, 'text': 'Pip what', 'voice': 'main'})
for i in range(7):
    clock.t += 1.0
    a.heard({'type': 'final', 'id': 41 + i, 'text': 'and', 'voice': 'main'})
    a.tick()
settle(a)
check('collection capped at 6 s', len(answers(lv)) == 1)

# 8. model failure -> gentle line, found false
lv, a, clock = fresh(model=lambda p: (_ for _ in ()).throw(RuntimeError('status 500')))
r = a.ask('When is Lisa coming?')
check('failure line', r['answer'] == ask.SORRY and r['found'] is False and r['evidence'] == [])

# 9. not found -> no evidence; long answers capped
lv, a, clock = fresh(model=lambda p: {'answer': 'I am not sure. Maybe ask Lisa. ' * 20, 'evidence': [1, 2], 'found': False})
r = a.ask('What is the capital of France?')
check('found false -> evidence emptied', r['evidence'] == [] and r['found'] is False)
check('answer capped ~240', len(r['answer']) <= 241)
lv, a, clock = fresh(model=lambda p: {'answer': 'Yes.', 'evidence': [77], 'found': True})
r = a.ask('anything')
check('found true with no valid evidence -> found false', r['found'] is False and r['evidence'] == [])

# 10. one in flight
gate = threading.Event()


def slow(p):
    gate.wait(2)
    return {'answer': 'Saturday.', 'evidence': [1], 'found': True}


lv, a, clock = fresh(model=slow)
t = threading.Thread(target=a.ask, args=('When is Lisa coming?',))
t.start()
time.sleep(0.1)
r2 = a.ask('Who is driving me?')
a.heard({'type': 'final', 'id': 50, 'text': 'Pip, what day is it', 'voice': 'main'})
clock.t += 2
a.tick()
gate.set(); t.join()
check('second question while busy dropped', r2.get('state') == 'busy' and len(answers(lv)) == 1 and a.stats['dropped'] == 2)

# 11. attach is idempotent; module ask()/arm()
lv = FakeLive(list(ROWS))
ask.attach(lv); ask.attach(lv)
check('attach idempotent', sum(1 for k in ask._askers if k == id(lv)) == 1 and len(lv.clients) == 1)
ask._askers[id(lv)].stop()

print('\n%d failed' % len(FAILS) if FAILS else '\nall passed')
sys.exit(1 if FAILS else 0)
