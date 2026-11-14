#!/usr/bin/env python3
"""Deploy the Band 39 care app to a Superserve sandbox with a public HTTPS preview URL.

Keys never enter the sandbox: Deepgram, ElevenLabs and OpenAI are stored as Superserve secrets
and bound to env vars; code in the sandbox only sees stand-in tokens, swapped for the real key on
the way out to each API host. Reads keys from ~/.config/vexo-band39/env (or KEYS_FILE).
Usage: python3 tools/deploy_superserve.py [--update]   (--update redeploys to the saved sandbox, same URL; never prints keys)
"""
import json, os, ssl, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); APP = os.path.dirname(HERE)
KEYS = {}
for line in open(os.path.expanduser(os.environ.get('KEYS_FILE', '~/.config/vexo-band39/env'))):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); KEYS[k.strip()] = v.strip()
API = 'https://api.superserve.ai'; BOX = 'https://sandbox.superserve.ai'; PORT = 8080
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if os.path.exists('/etc/ssl/cert.pem') and sys.platform == 'darwin' else ssl.create_default_context()


def call(method, url, body=None, headers=None, raw=False):
    h = dict(headers or {})
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    if data is not None and not raw: h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
            t = r.read(); return r.status, (json.loads(t) if t[:1] in (b'{', b'[') else t.decode(errors='replace'))
    except urllib.error.HTTPError as e:
        t = e.read().decode(errors='replace'); return e.code, t[:400]


api = lambda m, p, b=None: call(m, API + p, b, {'X-API-Key': KEYS['SUPERSERVE_API_KEY']})

# 1. secrets (create, or rotate the value if the name exists)
SECRETS = {
    'b39-deepgram':   dict(env='DEEPGRAM_API_KEY',   value=KEYS.get('DEEPGRAM_API_KEY'),   auth={'type': 'api-key', 'header': 'Authorization', 'prefix': 'Token '}, hosts=['api.deepgram.com']),
    'b39-elevenlabs': dict(env='ELEVENLABS_API_KEY', value=KEYS.get('ELEVENLABS_API_KEY'), auth={'type': 'api-key', 'header': 'xi-api-key'}, hosts=['api.elevenlabs.io']),
    'b39-openai':     dict(env='OPENAI_API_KEY',     value=KEYS.get('OPENAI_API_KEY'),     provider='openai'),
    'b39-stripe':     dict(env='STRIPE_SECRET_KEY',  value=KEYS.get('STRIPE_SECRET_KEY'),  provider='stripe'),
}
bind = {}
for name, s in SECRETS.items():
    if not s['value']:
        continue
    body = {'name': name, 'value': s['value']}
    if 'provider' in s: body['provider'] = s['provider']
    else: body['auth'] = s['auth']; body['hosts'] = s['hosts']
    code, res = api('POST', '/secrets', body)
    if code == 409:
        code, res = api('POST', '/secrets/%s/rotate' % name, {'value': s['value']})
        if code >= 300: code, res = api('PUT', '/secrets/%s' % name, {'value': s['value']})
    print('secret', name, '→', code if code < 300 else 'status %d %s' % (code, str(res)[:160]))
    if code < 300: bind[s['env']] = name

# 2. sandbox with secrets bound (or --update: reuse the saved sandbox so the URL stays the same)
UPDATE = '--update' in sys.argv
if UPDATE:
    sid = json.load(open(os.path.join(HERE, '.superserve.json')))['sandbox']
    code, sb = api('GET', '/sandboxes/%s' % sid)
    if code >= 300 or not isinstance(sb, dict) or not sb.get('access_token'):
        sys.exit('cannot reuse sandbox %s: %d %s' % (sid, code, str(sb)[:200]))
    if sb.get('status') not in (None, 'active', 'running'):
        rc, rr = api('POST', '/sandboxes/%s/resume' % sid)
        if rc >= 300: sys.exit('sandbox %s is %s and cannot resume: %d %s' % (sid, sb.get('status'), rc, str(rr)[:300]))
    tok = sb['access_token']
else:
    code, sb = api('POST', '/sandboxes', {'name': 'band39-care-%d' % int(time.time()), 'secrets': bind,
                                           'env_vars': {'SUPERSERVE': '1', 'HOST': '0.0.0.0', 'PORT': str(PORT), 'KEYS_FILE': '/nonexistent'},
                                           'metadata': {'app': 'band39-care'}})
    if code >= 300:
        sys.exit('sandbox create failed: %d %s' % (code, sb))
    sid, tok = sb['id'], sb['access_token']
print('sandbox', sid, sb.get('status'))
boxh = {'X-Superserve-Sandbox-Id': sid, 'X-Access-Token': tok}


def sh(cmd, timeout=120):
    code, res = call('POST', BOX + '/exec', {'command': 'sh', 'args': ['-c', cmd], 'timeout_s': timeout}, boxh)
    if code >= 300 or not isinstance(res, dict):
        code, res = call('POST', BOX + '/exec', {'command': cmd, 'timeout_s': timeout}, boxh)
    return res if isinstance(res, dict) else {'stdout': '', 'stderr': str(res), 'exit_code': code}


# 3. upload web/ and server/
n = 0
for sub in ('web', 'server'):
    for d, _, files in os.walk(os.path.join(APP, sub)):
        for f in files:
            if f.startswith('.') or f.endswith('.pyc'): continue
            local = os.path.join(d, f); rel = os.path.relpath(local, APP)
            code, res = call('POST', BOX + '/files?path=' + urllib.parse.quote('/home/user/app/' + rel), open(local, 'rb').read(), dict(boxh, **{'Content-Type': 'application/octet-stream'}), raw=True)
            if code >= 300: sys.exit('upload failed %s: %d %s' % (rel, code, res))
            n += 1
print('uploaded', n, 'files')

# 4. start the server
r = sh('command -v python3 && python3 --version'); print('python:', (r.get('stdout') or r.get('stderr') or '').strip().replace('\n', ' '))
if UPDATE: sh("pkill -f '[s]erver/server.py'; sleep 1")
r = sh('cd /home/user/app && setsid nohup python3 server/server.py %d > server.log 2>&1 < /dev/null & sleep 3; cat /home/user/app/server.log' % PORT, 30)
print('server:', (r.get('stdout') or '').strip()[:200], (r.get('stderr') or '').strip()[:200])

# 5. public preview URL
code, res = api('POST', '/sandboxes/%s/preview-ports' % sid, {'port': PORT, 'access': 'public'})
print('preview port →', code, res if code >= 300 else '')
url = (res.get('url') if isinstance(res, dict) else None) or 'https://%d-%s.sandbox.superserve.ai' % (PORT, sid)
time.sleep(2)
code, cfg = call('GET', url + '/api/config')
print('check', url + '/api/config', '→', code, cfg)
json.dump({'sandbox': sid, 'url': url}, open(os.path.join(HERE, '.superserve.json'), 'w'))
print('\nPUBLIC URL:', url + '/')
