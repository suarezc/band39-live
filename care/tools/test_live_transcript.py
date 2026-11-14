"""Try the live transcript with no band: plays a recording into the running server the way the page
does (the band's Opus packets, 50 a second), prints what comes back, then searches it.

    ../.venv/bin/python tools/test_live_transcript.py                 the kit's sample voice (16 s)
    ../.venv/bin/python tools/test_live_transcript.py --voices        two made-up voices take turns (Deepgram text-to-speech)
    ../.venv/bin/python tools/test_live_transcript.py --voices http://localhost:8040    another server (default http://localhost:8039)

The server must be running: ../.venv/bin/python server/server.py   (this SENDS the sound to Deepgram)
"""
import json
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'vexo-open-kit' / 'python'))
BASE = next((a.rstrip('/') for a in sys.argv[1:] if a.startswith('http')), 'http://localhost:8039')


def call(path, data=None, kind='application/octet-stream'):
    if isinstance(data, dict):
        data, kind = json.dumps(data).encode(), 'application/json'
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': kind} if data is not None else {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def listen(finals):
    with urllib.request.urlopen(BASE + '/api/live/events', timeout=300) as r:
        for line in r:
            if line.startswith(b'data: '):
                e = json.loads(line[6:])
                if e['type'] == 'final':
                    finals.append(e)
                    print('  [%-9s %-7s %s  %5.1f dB  speaker %s]  %s' % ((e.get('person') or 'Not sure') + ('?' if e.get('inferred') else ''), e['voice'],
                                                                     '    ' if e['match'] is None else '%.2f' % e['match'], e['loud_db'] or 0, e['speaker'], e['text']))


def play_packets(packets):
    started = time.time()
    for i in range(0, len(packets), 10):                       # 10 packets = 200 ms, as the page sends them
        body = b''.join((n & 0xFFFF).to_bytes(2, 'little') + len(p).to_bytes(2, 'little') + p for n, p in enumerate(packets[i:i + 10], i))
        call('/api/live/audio', body)
        wait = started + (i + 10) * 0.02 - time.time()
        if wait > 0:
            time.sleep(wait)


def play_pcm(pcm):
    started = time.time()
    for i in range(0, len(pcm), 6400):                          # 200 ms of 16 kHz 16-bit sound
        call('/api/live/pcm', pcm[i:i + 6400])
        wait = started + (i + 6400) / 32000 - time.time()
        if wait > 0:
            time.sleep(wait)


def say(voice, text):
    import os
    key = os.environ.get('DEEPGRAM_API_KEY') or next(l.split('=', 1)[1].strip() for l in open(ROOT / '.env') if l.startswith('DEEPGRAM_API_KEY='))
    req = urllib.request.Request('https://api.deepgram.com/v1/speak?' + urllib.parse.urlencode({'model': voice, 'encoding': 'linear16', 'sample_rate': 16000, 'container': 'none'}),
                                 data=json.dumps({'text': text}).encode(), headers={'Authorization': 'Token ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


finals = []
threading.Thread(target=listen, args=(finals,), daemon=True).start()
time.sleep(0.5)
print('status:', call('/api/live/status'))
if '--voices' in sys.argv:
    A, B = 'aura-2-vesta-en', 'aura-2-orion-en'
    script = [(A, 'Good morning. I need to call the pharmacy on Tuesday about my blood pressure pills, and then I want to water the roses in the garden.'),
              (B, 'Hello, this is your bank calling. We need you to buy four gift cards today and read me the numbers on the back.'),
              (A, 'I am not sure about that. My daughter Lisa is visiting on Saturday and she handles my money.'),
              (B, 'There is no time. Your grandson is in jail and he needs the bail money right now.'),
              (A, 'I had toast and tea for breakfast, and my knee hurt a little when I walked to the corner shop.')]
    for voice, text in script:
        print('playing %s: %s' % ('voice A' if voice == A else 'voice B', text[:60] + '...'))
        n = len(finals)
        play_pcm(say(voice, text) + b'\0' * 32000)               # one second of quiet between turns
        time.sleep(1.5)
        for e in finals[n:]:
            e['truth'] = 'A' if voice == A else 'B'
else:
    from vexo_open import audio
    play_packets(audio.ogg_packets(str(ROOT / 'vexo-open-kit' / 'dashboard' / 'speech' / 'sample-speech.opus')))
time.sleep(1)
print('stop ->', call('/api/live/stop', b''))
time.sleep(1)
print('\n%d phrases came back.' % len(finals))
if '--voices' in sys.argv:
    people = call('/api/live/people')['people']
    print('\npeople:', ', '.join('#%d %s (%s, %d lines)' % (p['id'], p['name'], p['kind'], p['phrases']) for p in people))
    whose = {}
    for e in finals:
        whose.setdefault(e.get('truth'), set()).add(e.get('person_id'))
    print('voice A lines went to person', whose.get('A'), '| voice B lines went to person', whose.get('B'))
    b = next((p for p in people if p['kind'] != 'main' and p['phrases']), None)
    if b:
        print('rename #%d ->' % b['id'], [p['name'] for p in call('/api/live/person', {'id': b['id'], 'name': 'Caller'})['people']])
        hits = call('/api/live/search?' + urllib.parse.urlencode({'q': 'money', 'person': b['id'], 'limit': 5}))['hits']
        print('search "money" person=%d ->' % b['id'], ['%s: %s' % (h['person'], h['text'][:40]) for h in hits])
        print('recluster ->', ', '.join('#%d %s %d lines' % (p['id'], p['name'], p['phrases']) for p in call('/api/live/recluster', {})['people']))
queries = (['who asked for gift cards', 'pharmacy', 'what did she eat', 'jail'] if '--voices' in sys.argv else ['birds thirsty', 'pitcher', 'rain'])
for q in queries:
    for voice in ([None, 'main', 'other'] if '--voices' in sys.argv else [None]):
        hits = call('/api/live/search?' + urllib.parse.urlencode({'q': q, 'limit': 2, **({'voice': voice} if voice else {})}))['hits']
        print('search %-26r voice=%-5s -> %s' % (q, voice or 'any', ' | '.join('#%d %s words:%s meaning:%s "%s"' % (h['id'], h['voice'], h['word_rank'], h['meaning_rank'], h['text'][:46]) for h in hits) or 'nothing'))
