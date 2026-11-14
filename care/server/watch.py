"""Band 39 care · the watcher: scam calls and falls / calls for help, heard in the live transcript.

One daemon thread listens to the live events (live.Live.subscribe) and keeps the finished phrases of the
last 45 seconds. When new phrases have arrived it asks the Decisions API (gemini-decision-1) a few yes/no
questions about the whole window (at most once every 3 s, one call in flight), and raises an alert with
live.tell({'type': 'alert', ...}) that every open page receives. Alerts are also appended to alerts.jsonl.

The window is judged as a whole on purpose: on the real band, scam fragments judged one by one looked
innocent ("I need you to buy for" ~0.1) while the three scam lines together scored 0.98.
Mom saying "I'm fine" never cancels or suppresses an alert: its probability is shown so a person can judge.

    import watch; watch.attach(live.get())     # idempotent: starts one watcher per Live object
Tests: care/tools/test_watch.py
"""
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import queue

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
URL = 'https://generativelanguage.googleapis.com/v1beta/decisions'
MODEL = 'gemini-decision-1'

WINDOW_SECONDS = 45       # phrases kept (by their 'at')
DEBOUNCE_SECONDS = 3      # at most one evaluation this often
COOLDOWN_SECONDS = 60     # per alert kind: one conversation raises one alert
SCAM_AT = 0.7
HELP_AT = 0.7
ALARM_AT = 0.7
TIMEOUT_SECONDS = 15
QUOTE_CHARS = 140

PREAMBLE = ('This is a live transcript from a microphone worn by an older woman, called Mom. Each line is one phrase, '
            'oldest first, labelled with who a voice detector thinks spoke; the labels can be wrong, and speech '
            'recognition makes mistakes. Phrases may also come from the other end of a phone call.')
QUESTIONS = {
    'scam': 'Is a voice other than Mom asking her for money, gift cards, a card number, bank or account details, '
            'or pressing her to act urgently or to keep it secret, as in a scam call?',
    'help': 'Does anyone in this transcript say they have fallen, are hurt, cannot get up, or call for help?',
    'alarm': 'Does someone react with alarm to a person being hurt or having fallen (for example "oh my god, are you okay?")?',
    'fine': 'Does Mom herself clearly say that she is fine or all right?',
}
TITLES = {'scam': 'Possible scam call', 'help': 'Possible fall or call for help heard'}
TEXTS = {'scam': 'A voice other than Mom’s asked her for money or account details and pressed her to act; call her before she pays or tells anyone anything.',
         'help': 'Someone near Mom’s band said they had fallen or called for help; check on her now.'}
SCAM_WORDS = re.compile(r'gift|card|bank|account|money|pay|wire|transfer|numbers?|social security|password|pin\b|urgent|right now|today|'
                        r'immediately|don.t tell|secret|compromised|security|police|arrest|refund|bitcoin', re.I)
HELP_WORDS = re.compile(r'help|fall|fell|fallen|hurt|get up|okay\?|ok\?|oh my god|ambulance|911|bleeding|don.t move|pain', re.I)


def log(msg):
    print('watch: ' + msg, file=sys.stderr, flush=True)


def data_folder():
    return os.environ.get('BAND39_LIVE_DATA') or os.path.join(ROOT, 'experiments', 'data', 'live')


def api_key():
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        try:
            from dotenv import dotenv_values
            key = (dotenv_values(os.path.join(ROOT, '.env')).get('GEMINI_API_KEY') or '').strip()
        except Exception:
            pass
    return key


def decide_api(text, questions):
    """One call to the Decisions API: {key: probability of yes}. Raises RuntimeError with a short reason."""
    key = api_key()
    if not key:
        raise RuntimeError('no GEMINI_API_KEY')
    body = json.dumps({'model': MODEL, 'input': text,
                       'questions': {k: {'type': 'noul', 'instructions': q} for k, q in questions.items()}}).encode()
    req = urllib.request.Request(URL, data=body, method='POST', headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:
            answers = json.loads(r.read())['answers']
    except urllib.error.HTTPError as e:
        raise RuntimeError('status %d' % e.code) from None
    except Exception as e:
        raise RuntimeError(type(e).__name__) from None
    return {k: float(answers[k]['noul']) for k in questions if k in answers}


def who(p):
    voice = p.get('voice')
    if voice == 'main':
        return 'Mom'
    if voice in ('unsure', 'unknown', None):
        return 'Not sure who'
    return p.get('person') or 'Someone else'


def pick_quote(lines, words):
    """The most telling lines, in order, verbatim, joined, at most QUOTE_CHARS. Returns (quote, ids)."""
    if not lines:
        return '', []
    hits = [p for p in lines if words.search(p.get('text') or '')] or lines[-2:]
    ranked = sorted(hits, key=lambda p: -len(words.findall(p.get('text') or '')))
    chosen, size = [], 0
    for p in ranked:
        t = (p.get('text') or '').strip()
        if chosen and size + len(t) + 1 > QUOTE_CHARS:
            continue
        chosen.append(p)
        size += len(t) + 1
    chosen.sort(key=lambda p: p.get('at') or 0)
    quote = ' '.join((p.get('text') or '').strip() for p in chosen)
    if len(quote) > QUOTE_CHARS:
        quote = quote[:QUOTE_CHARS - 1].rstrip() + '…'
    return quote, [p.get('id') for p in chosen]


class Watcher:
    def __init__(self, live, decide=None, now=time.time):
        self.live, self.decide, self.now = live, decide or decide_api, now
        self.lines = []                 # finals in the window, oldest first
        self.dirty = False              # phrases arrived since the last evaluation started
        self.busy = False               # a decide call is in flight
        self.last_eval = None           # when the last evaluation started (self.now())
        self.last_alert = {}            # kind -> when
        self.lock = threading.Lock()
        self.stopped = threading.Event()
        self.stats = {'calls': 0, 'errors': 0, 'alerts': 0, 'last': None, 'last_latency': None, 'latencies': [], 'log': []}
        self.q = live.subscribe()
        self.thread = threading.Thread(target=self._run, daemon=True, name='watch')
        self.thread.start()

    def stop(self):
        self.stopped.set()
        self.live.unsubscribe(self.q)
        self.thread.join(timeout=2)

    def _run(self):
        while not self.stopped.is_set():
            try:
                event = self.q.get(timeout=0.2)
            except queue.Empty:
                event = None
            try:
                if isinstance(event, dict) and event.get('type') == 'final' and (event.get('text') or '').strip():
                    with self.lock:
                        self.lines.append(dict(event))
                        self.lines.sort(key=lambda p: p.get('at') or 0)
                        self.dirty = True
                self._maybe_evaluate()
            except Exception as e:      # never let the watcher die
                log('error %s' % type(e).__name__)

    def _maybe_evaluate(self):
        with self.lock:
            now = self.now()
            if not self.dirty or self.busy:
                return
            if self.last_eval is not None and now - self.last_eval < DEBOUNCE_SECONDS:
                return
            self.lines = [p for p in self.lines if (p.get('at') or now) >= now - WINDOW_SECONDS]
            if not self.lines:
                self.dirty = False
                return
            window = list(self.lines)
            self.dirty, self.busy, self.last_eval = False, True, now
        threading.Thread(target=self._evaluate, args=(window,), daemon=True, name='watch-call').start()

    def _evaluate(self, window):
        try:
            text = PREAMBLE + '\n\n' + '\n'.join('%s: %s' % (who(p), (p.get('text') or '').strip()) for p in window)
            questions = dict(QUESTIONS)
            if all(p.get('voice') == 'main' for p in window):
                del questions['scam']
            started = time.time()
            self.stats['calls'] += 1
            try:
                probs = self.decide(text, questions)
            except Exception as e:
                self.stats['errors'] += 1
                log('decisions call skipped: %s' % (str(e)[:80] or type(e).__name__))
                return
            latency = time.time() - started
            probs = {k: probs.get(k) for k in QUESTIONS}
            self.stats.update(last=probs, last_latency=round(latency, 2))
            self.stats['latencies'].append(round(latency, 2))
            fired = self._judge(window, probs)
            self.stats['log'].append({'at': self.now(), 'ids': [p.get('id') for p in window], 'probabilities': probs,
                                      'latency': round(latency, 2), 'fired': fired})
        except Exception as e:
            log('evaluation failed: %s' % type(e).__name__)
        finally:
            with self.lock:
                self.busy = False

    def _judge(self, window, probs):
        fired = []
        p = lambda k: probs.get(k) or 0.0
        if p('scam') >= SCAM_AT:
            others = [x for x in window if x.get('voice') != 'main']
            fired += self._alert('scam', p('scam'), probs, *pick_quote(others, SCAM_WORDS))
        if p('help') >= HELP_AT or p('alarm') >= ALARM_AT:
            fired += self._alert('help', max(p('help'), p('alarm')), probs, *pick_quote(window, HELP_WORDS))
        return fired

    def _alert(self, kind, prob, probs, quote, ids):
        now = self.now()
        with self.lock:
            last = self.last_alert.get(kind)
            if last is not None and now - last < COOLDOWN_SECONDS:
                return []
            self.last_alert[kind] = now
        alert = {'type': 'alert', 'id': '%s-%d-%s' % (kind, int(now), uuid.uuid4().hex[:6]), 'kind': kind,
                 'probability': round(prob, 3), 'probabilities': {k: (None if v is None else round(v, 3)) for k, v in probs.items()},
                 'title': TITLES[kind], 'text': TEXTS[kind], 'quote': quote, 'evidence': ids, 'at': now}
        self.stats['alerts'] += 1
        self.live.tell(alert)
        try:
            folder = data_folder()
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, 'alerts.jsonl'), 'a') as f:
                f.write(json.dumps(alert) + '\n')
        except OSError as e:
            log('could not save the alert: %s' % type(e).__name__)
        log('%s alert p=%.2f "%s"' % (kind, prob, quote[:60]))
        return [kind]


def start(live, decide=None, now=time.time):
    """Start a watcher on a Live object (anything with subscribe/unsubscribe/tell)."""
    return Watcher(live, decide, now)


_watchers, _make = {}, threading.Lock()


def attach(live):
    """Start exactly one watcher per Live object (safe to call on every request). Returns the Live object."""
    with _make:
        if id(live) not in _watchers:
            try:
                _watchers[id(live)] = start(live)
            except Exception as e:
                log('could not start: %s' % type(e).__name__)
                _watchers[id(live)] = None
    return live
