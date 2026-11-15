"""Band 39 care · Ask Pip: Margaret asks a question out loud and hears a short answer drawn from her own transcript.

A daemon thread listens to the live events (live.Live.subscribe). A question is taken when a finished phrase
from Mom starts with the wake name ("Pip, ...", "hey Pip ...", and common mishearings: pipp, pep, pit, tip,
pipe), or when the page has armed it (arm(seconds)): then the next phrase(s) are the question. Phrases are
collected until 1.3 s pass with no new one (6 s at most), then one gemini-4-hydrogen call answers from the
retrieved transcript lines. The answer goes to every page as live.tell({'type': 'ask', 'state': 'answer', ...}),
is appended to <data>/asks.jsonl, and live.mute_until is set so the band's microphone hearing the laptop
speak the answer is not taken as a new question.

    import ask; ask.attach(live.get())       # idempotent: one asker per Live object
    ask.ask('When is Lisa coming?')          # typed question -> answer dict (route POST /api/ask)
    ask.arm(12)                              # route POST /api/ask/arm
Tests: care/tools/test_ask.py
"""
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
API = 'https://generativelanguage.googleapis.com/v1beta'
MODEL = 'gemini-3.5-flash-lite'   # measured on the demo day: about 0.8 s an answer, against 2 to 3.6 s for gemini-4-hydrogen, with answers as good

QUIET_SECONDS = 1.0       # a question ends after this long with no new phrase
MAX_COLLECT_SECONDS = 6.0
ARM_SECONDS = 12
WAKE_ALONE_ARM = 8
SPEAK_RATE = 11.0         # characters per second of spoken answer (for the mute window); slower than the voice, on purpose
SPEAK_PAD = 3.0
MAX_ANSWER = 240
TIMEOUT_SECONDS = 10
SORRY = "I'm sorry, I couldn't look that up just now."
BUSY = "I'm still thinking about your last question."

STRONG = ('pip', 'pipp', 'pep')           # clearly the name
WEAK = ('pit', 'tip', 'pipe')             # real words too: need a hey/comma/question word after them
QWORDS = r'(?:what|when|who|whom|where|why|how|which|did|do|does|is|are|was|were|will|can|could|should|have|has|tell)\b'
WAKE = re.compile(r'^\s*(?P<hey>(?:hey|hi|okay|ok|oh)[\s,.!]+)?(?P<name>pipp|pipe|pip|pep|pit|tip)(?P<sep>[,.!?:;]+\s*|\s+|$)(?P<rest>.*)$',
                  re.I | re.S)


def log(msg):
    print('ask: ' + msg, file=sys.stderr, flush=True)


def data_folder():
    d = os.environ.get('BAND39_LIVE_DATA') or os.path.join('experiments', 'data', 'live')
    return d if os.path.isabs(d) else os.path.join(ROOT, d)


def api_key():
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        try:
            from dotenv import dotenv_values
            key = (dotenv_values(os.path.join(ROOT, '.env')).get('GEMINI_API_KEY') or '').strip()
        except Exception:
            pass
    return key


def wake(text):
    """None if the phrase does not start with the wake name, else the rest of the phrase ('' if the name was said alone)."""
    m = WAKE.match(text or '')
    if not m:
        return None
    name, rest = m.group('name').lower(), m.group('rest').strip()
    if name in WEAK and not m.group('hey') and not re.match(r'[,.!?:;]', m.group('sep') or '') \
            and not (rest == '' and (text or '').strip().lower() == name) and not re.match(QWORDS, rest, re.I):
        return None                      # "the pipe burst" never starts here; "pipe burst in the kitchen" is not a question
    return re.sub(r'^[\s,.!?:;-]+', '', rest)


def when(at, now):
    """'today 3:05 pm', 'yesterday 9:10 am', or 'Friday 9:10 am'."""
    try:
        t, n = datetime.fromtimestamp(float(at)), datetime.fromtimestamp(float(now))
    except (TypeError, ValueError, OSError):
        return 'some time'
    clock = t.strftime('%I:%M %p').lstrip('0').lower()
    if t.date() == n.date():
        return 'today ' + clock
    if t.date() == (n - timedelta(days=1)).date():
        return 'yesterday ' + clock
    return t.strftime('%A ') + clock


def who(p):
    v = p.get('voice')
    if v == 'main':
        return 'Margaret'
    if v in ('unsure', 'unknown', None):
        return 'not sure who'
    return p.get('person') or 'someone else'


INSTRUCTION = (
    'You are Pip, a gentle helper for Margaret, who is 78. She just asked you a question out loud. '
    'Answer ONLY from the transcript lines below: things said near her today and recently, picked up by her band. '
    'Each line has an id, a time (like "today 3:05 pm" or "yesterday"), and who said it ("Margaret" is her). '
    'Speech recognition makes small mistakes. Reply in 1 or 2 short, warm, plain sentences, speaking to her as "you". '
    'If the lines mention something she should remember for it (what to bring, who picks her up), include it briefly. For a phone call, say what the caller wanted and what she said back. '
    'No lists, no medical advice, no diagnosis. If the lines do not contain the answer, say gently that you are not sure '
    'and suggest asking Lisa (her daughter). Never invent anything, and never say something happened if the lines only show '
    'she was unsure about it. If the question is not about her day (general knowledge), say you can only help with things '
    'from her day, with found false and no evidence. '
    'Return JSON: {"answer": "...", "evidence": [ids of the lines the answer rests on], "found": true or false}.')
SCHEMA = {'type': 'object', 'properties': {'answer': {'type': 'string'}, 'evidence': {'type': 'array', 'items': {'type': 'integer'}},
                                           'found': {'type': 'boolean'}}, 'required': ['answer', 'evidence', 'found']}


def gemini(prompt):
    """One generateContent call -> parsed JSON dict. Raises RuntimeError with a short reason (never the key)."""
    key = api_key()
    if not key:
        raise RuntimeError('no GEMINI_API_KEY')
    cfg = {'responseMimeType': 'application/json', 'responseSchema': SCHEMA, 'temperature': 0.2}
    if 'gemini-4' in MODEL:
        cfg['thinkingConfig'] = {'thinkingLevel': 'low'}
    body = json.dumps({'contents': [{'role': 'user', 'parts': [{'text': prompt}]}], 'generationConfig': cfg}).encode()
    req = urllib.request.Request('%s/models/%s:generateContent' % (API, MODEL), data=body, method='POST',
                                 headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            j = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError('status %d' % e.code) from None
    except Exception as e:
        raise RuntimeError(type(e).__name__) from None
    text = ''.join(p.get('text', '') for c in (j.get('candidates') or [])[:1]
                   for p in (c.get('content') or {}).get('parts', []) if not p.get('thought'))
    m = re.search(r'\{.*\}', text, re.S)
    try:
        return json.loads(m.group(0) if m else text)
    except ValueError:
        raise RuntimeError('not JSON') from None


def short(text, n=MAX_ANSWER):
    text = ' '.join((text or '').split())
    if len(text) <= n:
        return text
    cut = text[:n]
    end = max(cut.rfind('. '), cut.rfind('! '), cut.rfind('? '))
    return cut[:end + 1] if end > n // 3 else cut.rstrip() + '…'


class Asker:
    def __init__(self, live, model=None, now=time.time, quiet=QUIET_SECONDS, total=MAX_COLLECT_SECONDS, thread=True):
        self.live, self.model, self.now = live, model or gemini, now
        self.quiet, self.total = quiet, total
        self.armed_until = 0.0
        self.pending = []               # phrases of the question being collected
        self.first = self.last = 0.0
        self.busy = False
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.stats = {'answers': 0, 'errors': 0, 'dropped': 0, 'latencies': []}
        if not hasattr(live, 'mute_until'):
            try:
                live.mute_until = 0.0
            except Exception:
                pass
        self.q = live.subscribe()
        self.thread = None
        if thread:
            self.thread = threading.Thread(target=self._run, daemon=True, name='ask')
            self.thread.start()

    def stop(self):
        self.stopped.set()
        self.live.unsubscribe(self.q)
        if self.thread:
            self.thread.join(timeout=2)

    def muted(self):
        return False   # there is no mute window any more: see own_speech in live.py

    # -- listening
    def _run(self):
        while not self.stopped.is_set():
            try:
                event = self.q.get(timeout=0.1)
            except queue.Empty:
                event = None
            try:
                if isinstance(event, dict) and event.get('type') == 'final':
                    self.heard(event)
                self.tick()
            except Exception as e:      # never let the asker die
                log('error %s' % type(e).__name__)

    def heard(self, p):
        """One finished phrase from the live transcript."""
        text = (p.get('text') or '').strip()
        voice = p.get('voice')
        if not text or voice not in ('main', 'unsure'):
            return
        if self.muted():
            return                      # our own spoken answer coming back through the band
        now, tell = self.now(), False
        with self.lock:
            armed = now < self.armed_until
            if self.pending:            # the rest of a question split over phrases
                self.pending.append(dict(p))
                self.last = now
                return
            rest = wake(text)
            if voice == 'unsure' and not armed:
                return
            if rest is not None:
                if rest:
                    self.pending, self.first, self.last = [dict(p, text=rest)], now, now
                    self.armed_until = 0.0
                    return
                self.armed_until = now + WAKE_ALONE_ARM
                tell = True
            elif armed:
                self.pending, self.first, self.last = [dict(p)], now, now
                self.armed_until = 0.0
                return
            else:
                return
        if tell:
            self.live.tell({'type': 'ask', 'state': 'listening', 'at': time.time()})

    def tick(self):
        """Send the collected question once it has ended."""
        now = self.now()
        with self.lock:
            if not self.pending or (now - self.last < self.quiet and now - self.first < self.total):
                return
            phrases, self.pending = self.pending, []
        question = ' '.join((p.get('text') or '').strip() for p in phrases).strip()
        ids = [p.get('id') for p in phrases if p.get('id') is not None]
        if self.muted():
            return
        if not self._claim():
            log('question dropped: still answering the last one')
            self.stats['dropped'] += 1
            return
        threading.Thread(target=self._answer_and_release, args=(question, ids), daemon=True, name='ask-call').start()

    def _claim(self):
        with self.lock:
            if self.busy:
                return False
            self.busy = True
            return True

    def _answer_and_release(self, question, ids):
        try:
            self.answer(question, exclude=ids, publish=True)
        except Exception as e:
            log('answer failed: %s' % type(e).__name__)
        finally:
            with self.lock:
                self.busy = False

    def arm(self, seconds=ARM_SECONDS):
        seconds = max(1.0, min(float(seconds or ARM_SECONDS), 60.0))
        with self.lock:
            self.armed_until = self.now() + seconds
        self.live.tell({'type': 'ask', 'state': 'listening', 'at': time.time()})
        return {'ok': True, 'armed_for': seconds}

    def ask(self, question):
        """A typed question: answered now, the same way (and told to the pages)."""
        question = ' '.join(str(question or '').split())[:300]
        if not question:
            return {'error': 'empty question'}
        if not self._claim():
            log('typed question dropped: still answering the last one')
            self.stats['dropped'] += 1
            return {'type': 'ask', 'state': 'busy', 'question': question, 'answer': BUSY, 'evidence': [], 'found': False}
        try:
            return self.answer(question, publish=True)
        finally:
            with self.lock:
                self.busy = False

    # -- answering
    def retrieve(self, question, exclude=()):
        skip = set(exclude)
        lines, seen = [], set()
        try:
            hits = self.live.search(question, limit=8)
        except Exception as e:
            log('search failed: %s' % type(e).__name__)
            hits = []
        hits = list(hits) + self.around(hits[:5])
        try:
            hits = hits + list(self.live.store.recent(6))
        except Exception as e:
            log('recent failed: %s' % type(e).__name__)
        for p in hits:
            i = p.get('id')
            if i is None or i in seen or i in skip or not (p.get('text') or '').strip():
                continue
            if wake(p.get('text')) is not None and (p.get('at') or 0) >= time.time() - 120:
                continue                # a question just asked (stored as a phrase), not an answer
            seen.add(i)
            lines.append(p)
        lines.sort(key=lambda p: p.get('at') or 0)
        return lines

    def around(self, hits, before=1, after=12):
        """The phrases just around the best hits: a phone call's answer is usually a few lines after the word that matched."""
        store = getattr(self.live, 'store', None)
        db, lock = getattr(store, 'db', None), getattr(store, 'lock', None)
        ids = sorted({j for p in hits if isinstance(p.get('id'), int) for j in range(p['id'] - before, p['id'] + after + 1)})
        if db is None or lock is None or not ids:
            return []
        try:
            with lock:
                rows = db.execute('select %s where p.id in (%s)' % (store.COLS, ','.join('?' * len(ids))), ids).fetchall()
            return [store._row(r) for r in rows]
        except Exception as e:
            log('context failed: %s' % type(e).__name__)
            return []

    def answer(self, question, now=None, exclude=(), publish=True):
        started = time.time()
        now = time.time() if now is None else now
        lines = self.retrieve(question, exclude)
        text = '\n'.join('[%s] %s, %s: %s' % (p['id'], when(p.get('at'), now), who(p), (p.get('text') or '').strip()) for p in lines)
        prompt = '%s\n\nTranscript lines:\n%s\n\nMargaret asks: "%s"' % (INSTRUCTION, text or '(none)', question)
        valid = {p['id'] for p in lines}
        try:
            out = self.model(prompt)
            if not isinstance(out, dict) or not str(out.get('answer') or '').strip():
                raise RuntimeError('empty answer')
            ans = short(out.get('answer'))
            found = bool(out.get('found'))
            ev = []
            for i in out.get('evidence') or []:
                try:
                    i = int(i)
                except (TypeError, ValueError):
                    continue
                if i in valid and i not in ev:
                    ev.append(i)
            if not found:
                ev = []                 # "I'm not sure" rests on nothing
            if found and not ev:
                found = False
        except Exception as e:
            self.stats['errors'] += 1
            log('model call failed: %s' % (str(e)[:60] or type(e).__name__))
            ans, ev, found = SORRY, [], False
        latency = round(time.time() - started, 2)
        result = {'type': 'ask', 'state': 'answer', 'id': 'ask-%d-%s' % (int(time.time()), uuid.uuid4().hex[:6]),
                  'question': question, 'answer': ans, 'evidence': ev, 'found': found, 'at': time.time(), 'latency': latency}
        self.stats['answers'] += 1
        self.stats['latencies'].append(latency)
        if publish:
            try:
                # No dead period: the band keeps listening while the laptop speaks, so she can interrupt. live.py
                # recognises the answer's own words coming back through the microphone and leaves them out.
                now_ = time.time()
                self.live.own_speech = {'from': now_, 'until': now_ + len(ans) / 9.0 + 8.0,
                                        'words': set(''.join(c.lower() if c.isalnum() else ' ' for c in ans).split())}
            except Exception:
                pass
            self.live.tell(result)
            try:
                folder = data_folder()
                os.makedirs(folder, exist_ok=True)
                with open(os.path.join(folder, 'asks.jsonl'), 'a') as f:
                    f.write(json.dumps(result) + '\n')
            except OSError as e:
                log('could not save the answer: %s' % type(e).__name__)
            log('answered in %.2fs (found=%s)' % (latency, found))
        return result


_askers, _make = {}, threading.Lock()


def attach(live):
    """Start exactly one asker per Live object (safe to call on every request). Returns the Live object."""
    with _make:
        if id(live) not in _askers:
            try:
                _askers[id(live)] = Asker(live)
            except Exception as e:
                log('could not start: %s' % type(e).__name__)
                _askers[id(live)] = None
    return live


def _one(live=None):
    if live is not None:
        attach(live)
        return _askers.get(id(live))
    return next((a for a in _askers.values() if a is not None), None)


def ask(question, live=None):
    a = _one(live)
    return a.ask(question) if a else {'error': 'Ask Pip is not running.'}


def arm(seconds=ARM_SECONDS, live=None):
    a = _one(live)
    return a.arm(seconds) if a else {'error': 'Ask Pip is not running.'}


def answer(question, now=None, live=None):
    """Answer without telling the pages (used by tests and scripts). Builds an asker without a listening thread if needed."""
    a = _one(live) if live is None else (_askers.get(id(live)) or Asker(live, thread=False))
    if a is None:
        raise RuntimeError('no Live object: pass live=')
    return a.answer(question, now=now, publish=False)
