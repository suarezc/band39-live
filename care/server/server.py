#!/usr/bin/env python3
"""Band 39 care server: serves web/ and keeps every API key on the server side.

  GET  /api/config      which integrations are live (never the keys)
  POST /api/transcribe  audio/wav from the band's microphone -> Deepgram -> {"text": ...}
  POST /api/tts         {"text": ...} -> audio/mpeg (ElevenLabs; Deepgram Aura as fallback)
  POST /api/checkout    {"items": [{id, name, price, qty}]} -> Stripe Checkout URL (or demo mode)
  POST /api/doctor      {"summary": ...} -> doctor inbox (in memory; GET lists it)

Keys come from environment variables (on Superserve they are stand-in tokens that the platform
swaps for the real key on the way out), or locally from KEYS_FILE (default ~/.config/vexo-band39/env).
Run: python3 server/server.py [port]    No packages needed.
"""
import json, os, ssl, sys, time, urllib.parse, urllib.request, uuid
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import insights, agents, re, threading
import history   # Trends tab: /api/trend-summary, /api/chat
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
VOICE = os.environ.get('ELEVENLABS_VOICE_ID', 'EXAVITQu4vr4xnSDxMaL')   # "Sarah - Mature, Reassuring"
DG_VOICE = os.environ.get('DEEPGRAM_VOICE', 'aura-2-vesta-en')            # Deepgram Aura voice: fallback when ElevenLabs is unavailable


def load_keys():
    # ~/.config/vexo-band39/env, then the repo's own .env one folder up (git-ignored), as in suarezc/band39-live
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.expanduser(os.environ.get('KEYS_FILE', '~/.config/vexo-band39/env')), os.path.join(here, '..', '..', '.env')):
        if not os.path.exists(path):
            continue
        for line in open(path):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                if v.strip():
                    os.environ.setdefault(k.strip(), v.strip())

load_keys()
KEY = lambda name: os.environ.get(name, '').strip()
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if os.path.exists('/etc/ssl/cert.pem') and sys.platform == 'darwin' else ssl.create_default_context()
DOCTOR_INBOX = []
HOMES = {}                     # household code -> {'state': snapshot, 'actions': [...], 'seq': n, 'at': ms}
HOMES_LOCK = threading.Lock()
HOME_RE = re.compile(r'^[A-Z0-9]{6}$')


def home_of(path):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
    code = (q.get('home') or [''])[0].upper()
    return code if HOME_RE.match(code) else None, q


def upstream_curl(url, data=None, headers=None, method=None, timeout=60):
    # Superserve's egress proxy is an https:// proxy, which urllib can't use; curl can (and the
    # platform swaps the stand-in key for the real one on the way out).
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'out'); cmd = ['curl', '-s', '-m', str(timeout), '-o', out, '-w', '%{http_code} %{content_type}', '-X', method or ('POST' if data is not None else 'GET')]
        for k, v in (headers or {}).items():
            cmd += ['-H', '%s: %s' % (k, v)]
        if data is not None:
            inp = os.path.join(d, 'in'); open(inp, 'wb').write(data); cmd += ['--data-binary', '@' + inp]
        r = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=timeout + 5)
        code, _, ctype = (r.stdout.strip() + '  ').partition(' ')
        body = open(out, 'rb').read() if os.path.exists(out) else b''
        return int(code or 0), ctype.strip(), body


def upstream(url, data=None, headers=None, method=None, timeout=60):
    if os.environ.get('HTTPS_PROXY', '').startswith('https://'):
        return upstream_curl(url, data, headers, method, timeout)
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=timeout) as r:
            return r.status, r.headers.get('Content-Type', ''), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get('Content-Type', ''), e.read()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):   # no request bodies or headers in logs
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self, limit=8_000_000):
        n = int(self.headers.get('Content-Length') or 0)
        if n > limit:
            raise ValueError('too large')
        return self.rfile.read(n) if n else b''

    def do_GET(self):
        if self.path == '/api/config':
            return self.send_json(200, {
                'deepgram': bool(KEY('DEEPGRAM_API_KEY')), 'elevenlabs': bool(KEY('ELEVENLABS_API_KEY')),
                'stripe': bool(KEY('STRIPE_SECRET_KEY')), 'openai': bool(KEY('OPENAI_API_KEY')), 'host': 'superserve' if os.environ.get('SUPERSERVE') else 'local'})
        if self.path == '/api/doctor':
            return self.send_json(200, {'inbox': DOCTOR_INBOX[-20:]})
        if self.path.startswith('/api/state'):
            code, _ = home_of(self.path)
            if not code: return self.send_json(400, {'error': 'household code needed'})
            h = HOMES.get(code)
            return self.send_json(200, {'state': h['state'] if h else None, 'at': h['at'] if h else 0})
        if self.path.startswith('/api/actions'):
            code, q = home_of(self.path)
            if not code: return self.send_json(400, {'error': 'household code needed'})
            after = int((q.get('after') or ['0'])[0] or 0)
            h = HOMES.get(code) or {'actions': [], 'seq': 0}
            return self.send_json(200, {'actions': [a for a in h['actions'] if a['id'] > after], 'seq': h['seq']})
        return super().do_GET()

    def do_POST(self):
        try:
            route = self.path.split('?')[0]
            if route == '/api/transcribe':
                return self.transcribe()
            if route == '/api/tts':
                return self.tts()
            if route == '/api/checkout':
                return self.checkout()
            if route == '/api/doctor':
                return self.doctor()
            if route == '/api/analyze':
                return self.analyze()
            if route in ('/api/trend-summary', '/api/chat'):   # Trends tab (server/history.py)
                return self.send_json(200, history.handle(route, json.loads(self.body(200000) or b'{}'), key=KEY('OPENAI_API_KEY') or None, model=os.environ.get('OPENAI_MODEL', agents.MODEL_DEFAULT), post=self._post()))
            if route in ('/api/pip', '/api/recall', '/api/ask', '/api/digest', '/api/doctor-draft'):
                return self.agent(route)
            if route == '/api/state':
                return self.put_state()
            if route == '/api/actions':
                return self.put_action()
            self.send_json(404, {'error': 'not found'})
        except Exception as e:  # never echo upstream bodies or keys
            self.send_json(500, {'error': type(e).__name__})

    # Deepgram pre-recorded transcription (mip_opt_out: Deepgram may not train on this audio)
    def transcribe(self):
        if not KEY('DEEPGRAM_API_KEY'):
            return self.send_json(503, {'error': 'Transcription needs a Deepgram key on the server.'})
        audio = self.body()
        q = urllib.parse.urlencode({'model': 'nova-3', 'language': 'en', 'smart_format': 'true', 'mip_opt_out': 'true'})
        code, _, raw = upstream('https://api.deepgram.com/v1/listen?' + q, audio,
                                {'Authorization': 'Token ' + KEY('DEEPGRAM_API_KEY'), 'Content-Type': self.headers.get('Content-Type', 'audio/wav')})
        if code != 200:
            return self.send_json(502, {'error': 'Deepgram status %d' % code})
        alt = json.loads(raw)['results']['channels'][0]['alternatives'][0]
        self.send_json(200, {'text': alt.get('transcript', ''), 'confidence': alt.get('confidence')})

    # Text to speech: ElevenLabs first; Deepgram's Aura voice (same key as transcription) when there is no
    # ElevenLabs key or ElevenLabs fails (quota, outage). Fallback ported from suarezc/band39-live @ 39567e1.
    def tts(self):
        if not KEY('ELEVENLABS_API_KEY') and not KEY('DEEPGRAM_API_KEY'):
            return self.send_json(503, {'error': 'Voice needs an ElevenLabs or Deepgram key on the server.'})
        text = str(json.loads(self.body(20000) or b'{}').get('text', ''))[:600]
        if not text.strip():
            return self.send_json(400, {'error': 'no text'})
        code, raw, used = 0, b'', ''
        if KEY('ELEVENLABS_API_KEY'):
            code, ctype, raw = upstream('https://api.elevenlabs.io/v1/text-to-speech/%s?output_format=mp3_44100_64' % VOICE,
                                        json.dumps({'text': text, 'model_id': 'eleven_turbo_v2_5', 'voice_settings': {'stability': 0.6, 'similarity_boost': 0.75}}).encode(),
                                        {'xi-api-key': KEY('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
            used = 'elevenlabs'
        if code != 200 and KEY('DEEPGRAM_API_KEY'):
            code, ctype, raw = upstream('https://api.deepgram.com/v1/speak?model=%s&encoding=mp3' % urllib.parse.quote(DG_VOICE),
                                        json.dumps({'text': text}).encode(),
                                        {'Authorization': 'Token ' + KEY('DEEPGRAM_API_KEY'), 'Content-Type': 'application/json'})
            used = 'deepgram'
        if code != 200:
            return self.send_json(502, {'error': 'Voice service status %d' % code})
        self.send_response(200)
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('X-Voice', used)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    # Stripe Checkout (test or live key on the server). HSA/FSA cards pay like any card.
    def checkout(self):
        req = json.loads(self.body(50000) or b'{}')
        items = [i for i in req.get('items', []) if isinstance(i, dict)][:12]
        if not items:
            return self.send_json(400, {'error': 'no items'})
        if not KEY('STRIPE_SECRET_KEY'):
            return self.send_json(200, {'demo': True, 'message': 'Stripe is not connected yet: add STRIPE_SECRET_KEY on the server. Nothing was charged.'})
        origin = req.get('origin') or ('https://' + (self.headers.get('Host') or 'localhost'))
        form = [('mode', 'payment'), ('success_url', origin + '/?paid=1'), ('cancel_url', origin + '/?paid=0'),
                ('metadata[source]', 'vexo-band39'), ('payment_intent_data[description]', 'Vexo care shop (HSA/FSA eligible items)')]
        for n, i in enumerate(items):
            form += [('line_items[%d][quantity]' % n, str(max(1, min(5, int(i.get('qty', 1)))))),
                     ('line_items[%d][price_data][currency]' % n, 'usd'),
                     ('line_items[%d][price_data][unit_amount]' % n, str(int(round(float(i['price']) * 100)))),
                     ('line_items[%d][price_data][product_data][name]' % n, str(i['name'])[:120])]
        code, _, raw = upstream('https://api.stripe.com/v1/checkout/sessions', urllib.parse.urlencode(form).encode(),
                                {'Authorization': 'Bearer ' + KEY('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded'})
        if code != 200:
            return self.send_json(502, {'error': 'Stripe status %d' % code})
        self.send_json(200, {'url': json.loads(raw)['url']})

    # Transcript -> risk / medical / dementia / lifestyle / track (OpenAI, or offline rules without a key)
    def analyze(self):
        req = json.loads(self.body(60000) or b'{}')
        def post(url, data, headers):
            code, _, raw = upstream(url, data, headers, timeout=60)
            return code, raw
        out = insights.analyze(str(req.get('transcript', '')), req.get('history') or [],
                               key=KEY('OPENAI_API_KEY') or None, model=os.environ.get('OPENAI_MODEL', 'gpt-6-luna'), post=post)
        self.send_json(200, out)

    def _post(self):
        def post(url, data, headers):
            code, _, raw = upstream(url, data, headers, timeout=60)
            return code, raw
        return post

    def agent(self, route):
        req = json.loads(self.body(200000) or b'{}')
        kw = dict(key=KEY('OPENAI_API_KEY') or None, model=os.environ.get('OPENAI_MODEL', agents.MODEL_DEFAULT), post=self._post())
        if route == '/api/pip':
            out = agents.pip(str(req.get('said', '')), req.get('context') or {}, req.get('history') or [], **kw)
        elif route == '/api/recall':
            if req.get('answer') is not None:
                out = agents.recall_score(str(req.get('question', '')), str(req.get('hint', '')), str(req.get('answer', '')), **kw)
            else:
                out = agents.recall_question([str(n) for n in (req.get('notes') or [])], **kw)
        elif route == '/api/ask':
            out = agents.ask(str(req.get('question', '')), req.get('facts') or {}, **kw)
        elif route == '/api/digest':
            out = agents.digest(req.get('facts') or {}, **kw)
        else:
            out = agents.doctor_draft(req.get('facts') or {}, **kw)
        self.send_json(200, out)

    def put_state(self):
        code, _ = home_of(self.path)
        if not code: return self.send_json(400, {'error': 'household code needed'})
        snap = json.loads(self.body(400000) or b'{}')
        with HOMES_LOCK:
            h = HOMES.setdefault(code, {'state': None, 'actions': [], 'seq': 0, 'at': 0})
            h['state'] = snap; h['at'] = int(time.time() * 1000)
            if len(HOMES) > 200:   # keep memory bounded
                for k in sorted(HOMES, key=lambda k: HOMES[k]['at'])[:20]: HOMES.pop(k, None)
        self.send_json(200, {'ok': True})

    def put_action(self):
        code, _ = home_of(self.path)
        if not code: return self.send_json(400, {'error': 'household code needed'})
        a = json.loads(self.body(20000) or b'{}')
        with HOMES_LOCK:
            h = HOMES.setdefault(code, {'state': None, 'actions': [], 'seq': 0, 'at': 0})
            h['seq'] += 1; a['id'] = h['seq']; h['actions'].append(a); h['actions'] = h['actions'][-100:]
        self.send_json(200, {'ok': True, 'id': a['id']})

    def doctor(self):
        req = json.loads(self.body(50000) or b'{}')
        item = {'id': str(uuid.uuid4())[:8], 'at': int(time.time() * 1000), 'to': str(req.get('to', 'Dr. Patel'))[:80],
                'summary': str(req.get('summary', ''))[:4000], 'items': req.get('items', [])[:12]}
        DOCTOR_INBOX.append(item)
        self.send_json(200, {'ok': True, 'id': item['id'], 'delivery': 'inbox'})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8039))
    host = os.environ.get('HOST', '127.0.0.1')
    print('Band 39 care: http://%s:%d  (deepgram=%s elevenlabs=%s stripe=%s)' % (
        'localhost' if host == '127.0.0.1' else host, port, bool(KEY('DEEPGRAM_API_KEY')), bool(KEY('ELEVENLABS_API_KEY')), bool(KEY('STRIPE_SECRET_KEY'))), flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
