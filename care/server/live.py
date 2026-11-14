"""Band 39 care · live transcript: the band's microphone, streamed, written down as people speak,
labelled by voice, and searchable.

    band mic (Opus packets) -> this server -> decode -> Deepgram (streaming) -> text with word times
                                              |                                   |
                                              +-> the same samples ---------------+-> one row per phrase:
                                                  voice match (is it the main voice?) + loudness + text embedding
                                                  -> SQLite (words: FTS5/BM25, meaning: vectors) -> search

Needs the project's Python environment (numpy, av, onnxruntime, kaldi-native-fbank, tokenizers):
    ../.venv/bin/python server/server.py
and two model files in experiments/models/ (not in git; see experiments/README.md):
    wespeaker_en_voxceleb_CAM++.onnx   whose voice (29 MB)
    minilm-model.onnx + minilm-tokenizer.json   what a phrase means, all-MiniLM-L6-v2 (90 MB)

Built on the kit's speech helper (examples/python/speech.py): the Deepgram address, the key
handling and "do not train on this sound" (mip_opt_out) are the kit's and stay as they are.
While it runs, everything the microphone hears goes to Deepgram: the page says so.
The database and the voiceprint are in experiments/data/live/ (git ignores it: voices are personal).
"""
import json
import os
import queue
import sqlite3
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
KIT = os.path.join(ROOT, 'vexo-open-kit')
for p in (os.path.join(KIT, 'python'), os.path.join(KIT, 'examples', 'python'), os.path.join(ROOT, 'experiments', 'speech')):
    if p not in sys.path:
        sys.path.insert(0, p)

import numpy as np            # noqa: E402
import onnxruntime as ort     # noqa: E402
import speech                 # noqa: E402  (the kit's)
import voice_check as vc      # noqa: E402  (experiments/speech: voice embedding + loudness)

MODELS = os.path.join(ROOT, 'experiments', 'models')
DATA = os.path.join(ROOT, 'experiments', 'data', 'live')
RATE = 16000
KEEP_SECONDS = 300            # sound kept in memory, to cut each phrase out of
IDLE_SECONDS = 20             # no sound for this long: hang up on Deepgram
YES, NO = 0.65, 0.50          # voice match: at or above YES it is the main voice, below NO someone else
AUTO_MIN_SECONDS = 3.0        # with nobody enrolled, the first phrase this long becomes the main voice for now
FUSION_K = 60                 # reciprocal rank fusion: a hit scores 1 / (k + rank) in each ranking
FUSION_DEPTH = 100
MIN_SIMILARITY = 0.2          # a phrase less alike than this is not a match by meaning (unrelated text scores about 0 to 0.15)
STOP = set("a an and are as at be but by did do does for from had has have he her him his how i in is it its me my of on or our she so "
           "that the their them then there they this to was we were what when where which who whom why will with you your".split())


# ---- what a phrase means: all-MiniLM-L6-v2, run directly --------------------------------------

class TextEmbedder:
    def __init__(self):
        from tokenizers import Tokenizer
        self.tok = Tokenizer.from_file(os.path.join(MODELS, 'minilm-tokenizer.json'))
        self.tok.enable_truncation(max_length=256)
        self.tok.enable_padding()
        self.sess = ort.InferenceSession(os.path.join(MODELS, 'minilm-model.onnx'), providers=['CPUExecutionProvider'])
        self.inputs = [i.name for i in self.sess.get_inputs()]

    def embed(self, texts):
        enc = self.tok.encode_batch(list(texts))
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feed = {'input_ids': ids, 'attention_mask': mask, 'token_type_ids': np.zeros_like(ids)}
        out = self.sess.run(None, {k: v for k, v in feed.items() if k in self.inputs})[0]
        pooled = (out * mask[..., None]).sum(axis=1) / np.maximum(mask.sum(axis=1, keepdims=True), 1)
        return (pooled / np.linalg.norm(pooled, axis=1, keepdims=True)).astype(np.float32)


# ---- the store: one row per phrase; words in FTS5, meaning and voice as vectors ----------------

class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.db.executescript('''
            create table if not exists phrases (
              id integer primary key, session text, at real, t0 real, t1 real, text text,
              dg_speaker integer, voice text, match real, loud_db real, confidence real,
              vemb blob, temb blob);
            create virtual table if not exists phrase_words using fts5(text, content='phrases', content_rowid='id', tokenize='porter unicode61');
            create trigger if not exists phrases_ai after insert on phrases begin
              insert into phrase_words(rowid, text) values (new.id, new.text); end;
        ''')

    COLS = 'id, session, at, t0, t1, text, dg_speaker, voice, match, loud_db, confidence'

    @staticmethod
    def _row(r):
        return dict(zip(('id', 'session', 'at', 't0', 't1', 'text', 'speaker', 'voice', 'match', 'loud_db', 'confidence'), r))

    def add(self, p, vemb, temb):
        with self.lock:
            cur = self.db.execute(
                'insert into phrases (session, at, t0, t1, text, dg_speaker, voice, match, loud_db, confidence, vemb, temb) values (?,?,?,?,?,?,?,?,?,?,?,?)',
                (p['session'], p['at'], p['t0'], p['t1'], p['text'], p.get('speaker'), p['voice'], p.get('match'), p.get('loud_db'), p.get('confidence'),
                 None if vemb is None else vemb.astype(np.float32).tobytes(), None if temb is None else temb.astype(np.float32).tobytes()))
            self.db.commit()
            return cur.lastrowid

    def recent(self, limit=60):
        with self.lock:
            rows = self.db.execute('select %s from phrases order by id desc limit ?' % self.COLS, (limit,)).fetchall()
        return [self._row(r) for r in reversed(rows)]

    def voice_embeddings(self, ids=None):
        with self.lock:
            if ids:
                rows = self.db.execute('select id, t1 - t0, vemb from phrases where vemb is not null and id in (%s)' % ','.join('?' * len(ids)), list(ids)).fetchall()
            else:
                rows = self.db.execute('select id, t1 - t0, vemb from phrases where vemb is not null').fetchall()
        return [(i, d, np.frombuffer(b, dtype=np.float32)) for i, d, b in rows]

    def relabel(self, labels):
        with self.lock:
            self.db.executemany('update phrases set voice = ?, match = ? where id = ?', [(v, m, i) for i, (v, m) in labels.items()])
            self.db.commit()

    def count(self):
        with self.lock:
            return self.db.execute('select count(*) from phrases').fetchone()[0]

    def search(self, query, embedder=None, voice=None, limit=10, recency=0.0):
        """Words (BM25) and meaning (vectors), fused by reciprocal rank. voice: 'main', 'other', 'unsure' or None."""
        terms = [t for t in ''.join(c.lower() if c.isalnum() else ' ' for c in query).split() if t and t not in STOP]
        where, args = ('where p.voice = ?', [voice]) if voice else ('', [])
        with self.lock:
            by_words = []
            if terms:
                match = ' OR '.join('"%s"' % t for t in terms)
                sql = ('select p.id from phrase_words w join phrases p on p.id = w.rowid %s %s phrase_words match ? order by bm25(phrase_words) limit ?'
                       % (where, 'and' if where else 'where'))
                by_words = [r[0] for r in self.db.execute(sql, args + [match, FUSION_DEPTH]).fetchall()]
            rows = self.db.execute('select p.id, p.temb from phrases p %s %s p.temb is not null' % (where, 'and' if where else 'where'), args).fetchall()
        by_meaning, sims = [], {}
        if embedder is not None and rows and query.strip():
            q = embedder.embed([query])[0]
            mat = np.stack([np.frombuffer(b, dtype=np.float32) for _, b in rows])
            score = mat @ q
            order = [i for i in np.argsort(-score)[:FUSION_DEPTH] if score[i] >= MIN_SIMILARITY]
            by_meaning = [rows[i][0] for i in order]
            sims = {rows[i][0]: float(score[i]) for i in order}
        newest = sorted(set(by_words) | set(by_meaning), reverse=True)
        rank = lambda ids: {i: n + 1 for n, i in enumerate(ids)}     # noqa: E731
        rw, rm, rt = rank(by_words), rank(by_meaning), rank(newest)
        rrf = lambda r: 1.0 / (FUSION_K + r) if r else 0.0           # noqa: E731
        fused = sorted(((rrf(rw.get(i)) + rrf(rm.get(i)) + recency * rrf(rt.get(i)), i) for i in newest), reverse=True)[:limit]
        if not fused:
            return []
        ids = [i for _, i in fused]
        with self.lock:
            got = {r[0]: self._row(r) for r in self.db.execute('select %s from phrases where id in (%s)' % (self.COLS, ','.join('?' * len(ids))), ids).fetchall()}
        out = []
        for s, i in fused:
            hit = got[i]
            hit.update(score=round(s, 5), word_rank=rw.get(i), meaning_rank=rm.get(i), similarity=None if i not in sims else round(sims[i], 3))
            out.append(hit)
        return out


# ---- one listening session: sound in, phrases out ----------------------------------------------

class LiveSpeech(speech.DeepgramSpeech):
    """The kit's Deepgram stream, with two taps: the decoded sound, and Deepgram's full answers
    (word times and speakers), which the kit's own callback does not pass on."""

    def __init__(self, on_pcm, on_result):
        super().__init__(send='pcm', endpointing=300, diarize='true')
        self._on_pcm, self._on_result = on_pcm, on_result

    def feed_pcm(self, pcm):
        self._on_pcm(pcm)
        super().feed_pcm(pcm)

    def _message(self, message):
        try:
            self._on_result(message)
        except Exception as error:                      # a bug here must not stop the transcript
            print('live: could not handle a result: %r' % error, file=sys.stderr)
        super()._message(message)


class Live:
    def __init__(self):
        self.store = Store(os.path.join(DATA, 'transcript.db'))
        self.text = TextEmbedder()
        vc.embedding(np.zeros(RATE, dtype=np.float32))  # load the voice model now, not on the first phrase
        self.main_path = os.path.join(DATA, 'main-voice.npy')
        self.main = np.load(self.main_path) if os.path.exists(self.main_path) else None
        self.main_source = 'saved' if self.main is not None else None
        self.clients, self.lock = [], threading.RLock()
        self.session = None
        self.work = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()
        threading.Thread(target=self._watch, daemon=True).start()

    # -- telling the pages
    def subscribe(self):
        q = queue.Queue(maxsize=500)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    def tell(self, event):
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(event)
                except queue.Full:
                    pass

    def status(self):
        s = self.session
        return {'type': 'status', 'listening': bool(s), 'phrases': self.store.count(), 'main_voice': self.main_source,
                'seconds': round(s['samples'] / RATE, 1) if s else 0, 'thresholds': {'yes': YES, 'no': NO}}

    # -- sound in
    def _open(self):
        s = {'id': time.strftime('%m%d-%H%M%S'), 'pcm': bytearray(), 'base': 0, 'samples': 0, 'last': time.time(), 'started': time.time()}
        s['speech'] = LiveSpeech(lambda pcm: self._pcm(s, pcm), lambda m: self._result(s, m)).start()
        self.session = s
        self.tell(self.status())
        return s

    def _pcm(self, s, pcm):
        s['pcm'] += pcm
        s['samples'] += len(pcm) // 2
        extra = len(s['pcm']) - KEEP_SECONDS * RATE * 2
        if extra > RATE * 2 * 30:                       # trim half a minute at a time
            del s['pcm'][:extra]
            s['base'] += extra // 2

    def feed_packets(self, packets):
        """packets: [(seq, opus bytes)] from the band, in order."""
        with self.lock:
            s = self.session or self._open()
            s['last'] = time.time()
            for seq, packet in packets:
                s['speech'].feed(packet, seq)

    def feed_pcm(self, pcm):
        """Plain 16 kHz, 16-bit mono samples (tests, or a hub that already decoded)."""
        with self.lock:
            s = self.session or self._open()
            s['last'] = time.time()
            s['speech'].feed_pcm(pcm)

    def stop(self):
        with self.lock:
            s, self.session = self.session, None
        if s:
            try:
                s['speech'].stop(wait=3.0)
            except Exception:
                pass
            self.work.join()
            self.tell(self.status())

    def _watch(self):
        while True:
            time.sleep(2)
            s = self.session
            if s and time.time() - s['last'] > IDLE_SECONDS:
                self.stop()

    # -- text back
    def _result(self, s, m):
        if m.get('type') != 'Results':
            return
        alt = (m.get('channel', {}).get('alternatives') or [{}])[0]
        if not m.get('is_final'):
            if alt.get('transcript'):
                self.tell({'type': 'interim', 'text': alt['transcript']})
            return
        group = []
        for w in alt.get('words') or []:
            if group and w.get('speaker') != group[-1].get('speaker'):
                self.work.put((s, group))
                group = []
            group.append(w)
        if group:
            self.work.put((s, group))

    def _worker(self):
        while True:
            s, words = self.work.get()
            try:
                self._phrase(s, words)
            except Exception as error:
                print('live: could not store a phrase: %r' % error, file=sys.stderr)
            finally:
                self.work.task_done()

    def label(self, vemb, seconds):
        """-> (voice, match). voice: 'main', 'other', 'unsure', or 'unknown' when nobody is enrolled."""
        if vemb is None:
            return ('unknown' if self.main is None else 'unsure'), None
        if self.main is None:
            return 'unknown', None
        match = float(np.dot(self.main, vemb))
        if match >= YES:
            return 'main', match
        # a short phrase from the right voice scores low (measured: a 1 s "I'm fine" gives 0.3 to 0.6), so do not call it "other" lightly
        return ('other' if match < (NO if seconds >= 1.5 else 0.25) else 'unsure'), match

    def _phrase(self, s, words):
        text = ' '.join(w.get('punctuated_word') or w.get('word', '') for w in words).strip()
        if not text:
            return
        t0, t1 = float(words[0]['start']), float(words[-1]['end'])
        a = max(0, int((t0 - 0.1) * RATE) - s['base'])
        b = max(a, int((t1 + 0.1) * RATE) - s['base'])
        samples = np.frombuffer(bytes(s['pcm'][a * 2:b * 2]), dtype=np.int16).astype(np.float32) / 32768.0
        seconds = len(samples) / RATE
        vemb = vc.embedding(samples) if seconds >= 0.6 else None
        loud = round(vc.loudness(samples), 1) if len(samples) >= 320 else None
        learned = self.main is None and vemb is not None and seconds >= AUTO_MIN_SECONDS
        if learned:
            self._set_main(vemb, 'auto: first long phrase')
        voice, match = self.label(vemb, seconds)
        temb = self.text.embed([text])[0]
        p = {'session': s['id'], 'at': s['started'] + t0, 't0': round(t0, 2), 't1': round(t1, 2), 'text': text, 'speaker': words[0].get('speaker'),
             'voice': voice, 'match': None if match is None else round(match, 2), 'loud_db': loud,
             'confidence': round(float(np.mean([w.get('confidence', 0) for w in words])), 2)}
        p['id'] = self.store.add(p, vemb, temb)
        self.tell(dict(p, type='final'))
        if learned:                                     # what was said before a voice was known gets its label now
            self._relabel_all()

    # -- whose voice is the main one
    def _set_main(self, emb, source):
        self.main = (emb / np.linalg.norm(emb)).astype(np.float32)
        self.main_source = source
        os.makedirs(DATA, exist_ok=True)
        np.save(self.main_path, self.main)

    def enroll(self, ids):
        """These phrases are the main voice. Every stored phrase is labelled again."""
        got = self.store.voice_embeddings(ids)
        if not got:
            return {'error': 'Those phrases are too short to learn a voice from. Pick a longer one.'}
        self._set_main(np.mean([e for _, _, e in got], axis=0), 'enrolled from %d phrase(s)' % len(got))
        return {'ok': True, 'relabelled': self._relabel_all()}

    def _relabel_all(self):
        labels = {i: self.label(e, d) for i, d, e in self.store.voice_embeddings()}
        self.store.relabel({i: (v, None if m is None else round(m, 2)) for i, (v, m) in labels.items()})
        self.tell({'type': 'relabel'})
        self.tell(self.status())
        return len(labels)

    def forget_voice(self):
        self.main, self.main_source = None, None
        if os.path.exists(self.main_path):
            os.remove(self.main_path)
        self.store.relabel({i: ('unknown', None) for i, _, _ in self.store.voice_embeddings()})
        self.tell({'type': 'relabel'})
        self.tell(self.status())
        return {'ok': True}

    def search(self, query, voice=None, limit=10, recency=0.0):
        return self.store.search(query, self.text, voice or None, limit, recency)

    def save_clip(self, seconds=300):
        """Write the last `seconds` of sound still in memory to a WAV file (for tests on real recordings).
        Nothing is saved unless this is called. The file goes to experiments/data/live/clips/, which git ignores."""
        import wave
        with self.lock:
            s = self.session
            if not s or not s['pcm']:
                return {'error': 'Nothing is being listened to right now, so there is no sound to save.'}
            raw = bytes(s['pcm'][-int(seconds * RATE) * 2:])
            starts = s['base'] / RATE + (len(s['pcm']) - len(raw)) / 2 / RATE
            session = s['id']
        folder = os.path.join(DATA, 'clips')
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, '%s-%s.wav' % (session, time.strftime('%H%M%S')))
        with wave.open(path, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(raw)
        return {'ok': True, 'path': path, 'session': session, 'starts_at': round(starts, 2), 'seconds': round(len(raw) / 2 / RATE, 1)}


_live, _error = None, None
_make = threading.Lock()


def get():
    """The one Live object, made on first use. Raises RuntimeError with a sentence to show."""
    global _live, _error
    with _make:
        if _live is None and _error is None:
            try:
                _live = Live()
            except Exception as error:
                _error = 'Live transcript is not available: %s' % error
        if _live is None:
            raise RuntimeError(_error)
        return _live
