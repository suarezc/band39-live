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
DATA = os.environ.get('BAND39_LIVE_DATA') or DATA   # tests run a second server on their own folder
# Who is speaking: every distinct voice becomes a person ("Mom", "Voice 2", ...). Tuned on the real band
# (care/tools/test_voices.py, session 1114-151423): on the band's microphone one person's phrases score only
# about 0.4 to 0.75 against each other and two people -0.1 to 0.3, so the bars are much lower than for studio sound.
LONG_SECONDS = 1.5            # shorter phrases give unreliable voiceprints: they never start or move a person
JOIN = 0.40                   # a long phrase joins the best person at or above this (cosine to the person's centroid)
SOLID = 0.50                  # ... and only at or above this does it also add to the person's voiceprint
SHORT_JOIN, SHORT_MARGIN = 0.45, 0.15   # a short phrase joins only this alike, and this far ahead of the runner-up
NEW_MIN_SECONDS = 1.5         # a phrase that matches nobody starts a new person only if this long ...
NEW_MIN_DB = -32.0            # ... and this loud (a nearby voice; far chatter measured -34 to -41 dB)
MERGE = 0.60                  # two people whose voiceprints are this alike become one
DG_GAP = 3.0                  # Deepgram's speaker number carries a person over to a phrase at most this far away
AUTO_MIN_SECONDS = 3.0        # with no main person yet, the first phrase this long becomes the main person
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


# ---- who is speaking: people, each a voiceprint built from their solid phrases -----------------

class Person:
    def __init__(self, id, kind='voice', name=None, total=None, n=0, created=None, last_heard=None):
        self.id, self.kind, self.name, self.n = id, kind, name, n
        self.total = np.zeros(512) if total is None else np.asarray(total, dtype=np.float64)
        self.created, self.last_heard = created, last_heard
        self.seed = False       # while rebuilding: the old voiceprint stands in until a phrase joins

    def centroid(self):
        norm = np.linalg.norm(self.total)
        return self.total / norm if norm > 0 else self.total

    def add(self, vemb):
        if self.seed:
            self.total, self.n, self.seed = np.zeros(512), 0, False
        self.total = self.total + vemb
        self.n += 1


def display_name(id, kind, name):
    return name or ('Mom' if kind == 'main' else 'Voice %d' % id)


class Voices:
    """Assigns phrases to people. Pure: no database, so care/tools/test_voices.py runs the same code offline.
    A phrase is a dict: vemb (unit vector or None), seconds, loud_db, session, speaker (Deepgram's), t0, t1, at."""

    def __init__(self, people=(), next_id=1):
        self.people = {p.id: p for p in people}
        self.next_id = next_id
        self.alias = {}         # merged-away id -> survivor

    def main(self):
        return next((p for p in self.people.values() if p.kind == 'main'), None)

    def resolve(self, pid):
        while pid in self.alias:
            pid = self.alias[pid]
        return pid

    def new(self, kind, at):
        p = Person(self.next_id, kind, created=at, last_heard=at)
        self.next_id += 1
        self.people[p.id] = p
        return p

    def ranked(self, vemb):
        return sorted(((float(np.dot(p.centroid(), vemb)), p) for p in self.people.values() if p.n), key=lambda x: -x[0])

    def assign(self, ph, near=(), create=True):
        """-> {person_id, match, inferred, created, auto_main, changed: ids whose voiceprint moved}"""
        out = {'person_id': None, 'match': None, 'inferred': False, 'created': False, 'auto_main': False, 'changed': set()}
        v, secs, main = ph.get('vemb'), ph['seconds'], self.main()
        ranked = self.ranked(v) if v is not None else []
        if ranked:
            out['match'] = round(ranked[0][0], 2)
        if v is not None and secs >= LONG_SECONDS:
            if ranked and ranked[0][0] >= JOIN:
                c, p = ranked[0]
                if c >= SOLID:
                    p.add(v)
                    out['changed'].add(p.id)
                if main is None and secs >= AUTO_MIN_SECONDS:
                    p.kind, out['auto_main'] = 'main', True
                    out['changed'].add(p.id)
                return self._hit(out, p, ph)
            loud = ph.get('loud_db') is not None and ph['loud_db'] >= NEW_MIN_DB
            if create and loud and secs >= max(NEW_MIN_SECONDS, 0 if main else AUTO_MIN_SECONDS):
                p = self.new('voice' if main else 'main', ph.get('at'))
                p.add(v)
                out.update(created=True, auto_main=main is None, match=1.0)
                out['changed'].add(p.id)
                return self._hit(out, p, ph)
        elif v is not None and ranked and ranked[0][0] >= SHORT_JOIN:
            runner = ranked[1][0] if len(ranked) > 1 else 0.0
            if ranked[0][0] - runner >= SHORT_MARGIN:
                return self._hit(out, ranked[0][1], ph)
        # Deepgram's speaker number: the nearest phrase of the same speaker, close in time, that was assigned by voice
        best = None
        for q in near:
            if q.get('person_id') and not q.get('inferred') and q.get('session') == ph.get('session') and q.get('speaker') == ph.get('speaker') \
                    and ph.get('speaker') is not None and q is not ph:
                gap = max(0.0, ph['t0'] - q['t1'], q['t0'] - ph['t1'])
                if gap <= DG_GAP and (best is None or gap < best[0]):
                    best = (gap, self.resolve(q['person_id']))
        if best and best[1] in self.people:
            out['inferred'] = True
            return self._hit(out, self.people[best[1]], ph)
        return out

    def _hit(self, out, p, ph):
        out['person_id'] = p.id
        if ph.get('at') and (p.last_heard or 0) < ph['at']:
            p.last_heard = ph['at']
        return out

    def merge(self, gone, into):
        """Fold person `gone` into `into` (the main person always survives). -> (gone id, survivor id)"""
        a, b = self.people[gone], self.people[into]
        if a.kind == 'main':
            a, b = b, a
        if not a.seed:                                  # a stand-in voiceprint is dropped, real phrases are kept
            if b.seed:
                b.total, b.n, b.seed = a.total.copy(), a.n, False
            else:
                b.total, b.n = b.total + a.total, b.n + a.n
        b.name = b.name or a.name
        b.created = min((x for x in (a.created, b.created) if x is not None), default=None)
        b.last_heard = max(a.last_heard or 0, b.last_heard or 0) or None
        del self.people[a.id]
        self.alias[a.id] = b.id
        return a.id, b.id

    def merge_similar(self):
        """People whose voiceprints have become very alike are one person: the lower id survives (the main person always)."""
        done = []
        while True:
            ps = [p for p in self.people.values() if p.n]
            pair = None
            for i, a in enumerate(ps):
                for b in ps[i + 1:]:
                    c = float(np.dot(a.centroid(), b.centroid()))
                    if c >= MERGE and (pair is None or c > pair[0]):
                        pair = (c, a, b)
            if not pair:
                return done
            _, a, b = pair
            lo, hi = (a, b) if a.id < b.id else (b, a)
            done.append(self.merge(hi.id, lo.id))


def rebuild(phrases, seeds=(), next_id=1, pinned=None):
    """Every stored phrase, assigned again from scratch. phrases: dicts as for Voices.assign plus 'id', in time order.
    seeds: people to keep (the main person and named people), their old voiceprint standing in until phrases join.
    pinned: {phrase id: person id} phrases the user said belong to someone. -> (Voices, {phrase id: result})
    Two passes: long phrases form people; then the rest join them (or Deepgram's speaker number carries over)."""
    for p in seeds:
        p.seed = True
    eng = Voices(seeds, next_id)
    got, pinned = {}, pinned or {}
    for ph in phrases:
        pid = pinned.get(ph['id'])
        if pid in eng.people and ph.get('vemb') is not None:
            eng.people[pid].add(ph['vemb'])
            got[ph['id']] = {'person_id': pid, 'match': None, 'inferred': False}
        elif ph.get('vemb') is not None and ph['seconds'] >= LONG_SECONDS:
            r = eng.assign(ph)
            if r['person_id']:
                got[ph['id']] = r
        eng.merge_similar()
    by_session = {}
    for ph in phrases:
        if ph['id'] in got:
            got[ph['id']]['person_id'] = eng.resolve(got[ph['id']]['person_id'])
            by_session.setdefault(ph.get('session'), []).append(dict(ph, **got[ph['id']]))
    for ph in phrases:
        if ph['id'] not in got:
            got[ph['id']] = eng.assign(ph, by_session.get(ph.get('session'), ()), create=False)
    for ph in phrases:                                  # final matches against the finished voiceprints
        r = got[ph['id']]
        r['person_id'] = eng.resolve(r['person_id']) if r['person_id'] else None
        if ph.get('vemb') is not None and r['person_id'] in eng.people:
            r['match'] = round(float(np.dot(eng.people[r['person_id']].centroid(), ph['vemb'])), 2)
    return eng, got


# ---- the store: one row per phrase; words in FTS5, meaning and voice as vectors ----------------

class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        had_people = self.db.execute("select 1 from sqlite_master where name = 'people'").fetchone() is not None
        self.db.executescript('''
            create table if not exists phrases (
              id integer primary key, session text, at real, t0 real, t1 real, text text,
              dg_speaker integer, voice text, match real, loud_db real, confidence real,
              vemb blob, temb blob);
            create virtual table if not exists phrase_words using fts5(text, content='phrases', content_rowid='id', tokenize='porter unicode61');
            create trigger if not exists phrases_ai after insert on phrases begin
              insert into phrase_words(rowid, text) values (new.id, new.text); end;
            create table if not exists people (
              id integer primary key autoincrement, name text, kind text, centroid blob, n integer, created real, last_heard real);
        ''')
        have = {r[1] for r in self.db.execute('pragma table_info(phrases)')}
        for col, kind in (('person_id', 'integer'), ('inferred', 'integer')):     # an older database gains the columns in place
            if col not in have:
                self.db.execute('alter table phrases add column %s %s' % (col, kind))
        self.db.commit()
        self.migrated = not had_people

    COLS = ('p.id, p.session, p.at, p.t0, p.t1, p.text, p.dg_speaker, p.voice, p.match, p.loud_db, p.confidence, p.person_id, p.inferred, pe.kind, pe.name '
            'from phrases p left join people pe on pe.id = p.person_id')

    @staticmethod
    def _row(r):
        d = dict(zip(('id', 'session', 'at', 't0', 't1', 'text', 'speaker', 'voice', 'match', 'loud_db', 'confidence', 'person_id', 'inferred'), r[:13]))
        d['inferred'] = bool(d['inferred'])
        d['person'] = display_name(d['person_id'], r[13], r[14]) if d['person_id'] else None
        return d

    def add(self, p, vemb, temb):
        with self.lock:
            cur = self.db.execute(
                'insert into phrases (session, at, t0, t1, text, dg_speaker, voice, match, loud_db, confidence, vemb, temb, person_id, inferred) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (p['session'], p['at'], p['t0'], p['t1'], p['text'], p.get('speaker'), p['voice'], p.get('match'), p.get('loud_db'), p.get('confidence'),
                 None if vemb is None else vemb.astype(np.float32).tobytes(), None if temb is None else temb.astype(np.float32).tobytes(),
                 p.get('person_id'), int(bool(p.get('inferred')))))
            self.db.commit()
            return cur.lastrowid

    def recent(self, limit=60):
        with self.lock:
            rows = self.db.execute('select %s order by p.id desc limit ?' % self.COLS, (limit,)).fetchall()
        return [self._row(r) for r in reversed(rows)]

    def voice_embeddings(self, ids):
        with self.lock:
            rows = self.db.execute('select id, person_id, vemb from phrases where vemb is not null and id in (%s)' % ','.join('?' * len(ids)), list(ids)).fetchall()
        return [(i, pid, np.frombuffer(b, dtype=np.float32).astype(np.float64)) for i, pid, b in rows]

    def phrases_for_rebuild(self):
        with self.lock:
            rows = self.db.execute('select id, session, at, t0, t1, dg_speaker, loud_db, vemb from phrases order by at, id').fetchall()
        return [{'id': i, 'session': s, 'at': at, 't0': t0, 't1': t1, 'speaker': sp, 'loud_db': loud, 'seconds': (t1 or 0) - (t0 or 0),
                 'vemb': None if b is None else np.frombuffer(b, dtype=np.float32).astype(np.float64)} for i, s, at, t0, t1, sp, loud, b in rows]

    # -- people
    def load_people(self):
        with self.lock:
            rows = self.db.execute('select id, name, kind, centroid, n, created, last_heard from people').fetchall()
            seq = self.db.execute("select seq from sqlite_sequence where name = 'people'").fetchone()
        people = [Person(i, kind, name, None if c is None else np.frombuffer(c, dtype=np.float64) * max(n or 1, 1), n or 0, created, heard)
                  for i, name, kind, c, n, created, heard in rows]
        return people, max([seq[0] if seq else 0] + [p.id for p in people]) + 1

    def save_people(self, people, only=None):
        """Write people (all of them, removing the rest, unless `only` names the ids that changed)."""
        rows = [(p.id, p.name, p.kind, p.centroid().astype(np.float64).tobytes(), p.n, p.created, p.last_heard)
                for p in people.values() if only is None or p.id in only]
        with self.lock:
            if only is None:
                self.db.execute('delete from people where id not in (%s)' % ','.join(str(int(i)) for i in people) if people else 'delete from people')
            self.db.executemany('insert or replace into people (id, name, kind, centroid, n, created, last_heard) values (?,?,?,?,?,?,?)', rows)
            self.db.commit()

    def drop_person(self, gone, into):
        with self.lock:
            self.db.execute('update phrases set person_id = ? where person_id = ?', (into, gone))
            self.db.execute('delete from people where id = ?', (gone,))
            self.db.commit()

    def reassign(self, got):
        with self.lock:
            self.db.executemany('update phrases set person_id = ?, inferred = ?, match = ? where id = ?',
                                [(r['person_id'], int(bool(r.get('inferred'))), r.get('match'), i) for i, r in got.items()])
            self.db.commit()

    def refresh_voice(self):
        """The old three labels, from the people: main, other (someone else), unsure; unknown while nobody is the main person."""
        with self.lock:
            has_main = self.db.execute("select 1 from people where kind = 'main'").fetchone() is not None
            if has_main:
                self.db.execute("update phrases set voice = case when person_id is null then 'unsure' "
                                "when (select kind from people where id = person_id) = 'main' then 'main' else 'other' end")
            else:
                self.db.execute("update phrases set voice = 'unknown'")
            self.db.commit()

    def people_list(self):
        with self.lock:
            rows = self.db.execute('select pe.id, pe.name, pe.kind, pe.last_heard, count(p.id) from people pe left join phrases p on p.person_id = pe.id '
                                   'group by pe.id order by pe.kind = \'main\' desc, pe.id').fetchall()
        return [{'id': i, 'name': display_name(i, kind, name), 'named': bool(name), 'kind': kind, 'last_heard': heard, 'phrases': n}
                for i, name, kind, heard, n in rows]

    def count(self):
        with self.lock:
            return self.db.execute('select count(*) from phrases').fetchone()[0]

    def search(self, query, embedder=None, voice=None, limit=10, recency=0.0, person=None):
        """Words (BM25) and meaning (vectors), fused by reciprocal rank. voice: 'main', 'other', 'unsure' or None; person: a person id or None."""
        terms = [t for t in ''.join(c.lower() if c.isalnum() else ' ' for c in query).split() if t and t not in STOP]
        conds, args = [], []
        if voice:
            conds.append('p.voice = ?'); args.append(voice)
        if person:
            conds.append('p.person_id = ?'); args.append(int(person))
        where = ('where ' + ' and '.join(conds)) if conds else ''
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
            got = {r[0]: self._row(r) for r in self.db.execute('select %s where p.id in (%s)' % (self.COLS, ','.join('?' * len(ids))), ids).fetchall()}
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
        self.vlock = threading.RLock()                  # the people: changed by the phrase worker and by the page
        people, next_id = self.store.load_people()
        self.voices = Voices(people, next_id)
        if self.store.migrated and not people and os.path.exists(self.main_path):
            # an older database: the saved voiceprint becomes the main person, then every stored phrase is assigned again
            main = self.voices.new('main', time.time())
            main.add(np.load(self.main_path).astype(np.float64))
            self.store.save_people(self.voices.people)
        main = self.voices.main()
        self.main_source = 'saved' if main is not None else None
        if self.store.migrated and self.store.count():
            self.recluster(tell=False)
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
        return {'type': 'status', 'listening': bool(s), 'phrases': self.store.count(), 'main_voice': self.main_source, 'people': len(self.voices.people),
                'seconds': round(s['samples'] / RATE, 1) if s else 0, 'thresholds': {'join': JOIN, 'solid': SOLID, 'merge': MERGE}}

    # -- sound in
    def _open(self):
        s = {'id': time.strftime('%m%d-%H%M%S'), 'pcm': bytearray(), 'base': 0, 'samples': 0, 'last': time.time(), 'started': time.time(), 'heard': []}
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

    def _voice(self, pid):
        """The old three labels, kept for search filters and older pages."""
        main = self.voices.main()
        if main is None:
            return 'unknown'
        return 'unsure' if pid is None else 'main' if pid == main.id else 'other'

    def _phrase(self, s, words):
        if time.time() < getattr(self, 'mute_until', 0):   # the laptop is speaking an answer (server/ask.py): do not transcribe our own voice
            return
        text = ' '.join(w.get('punctuated_word') or w.get('word', '') for w in words).strip()
        if not text:
            return
        t0, t1 = float(words[0]['start']), float(words[-1]['end'])
        a = max(0, int((t0 - 0.1) * RATE) - s['base'])
        b = max(a, int((t1 + 0.1) * RATE) - s['base'])
        samples = np.frombuffer(bytes(s['pcm'][a * 2:b * 2]), dtype=np.int16).astype(np.float32) / 32768.0
        vemb = vc.embedding(samples) if len(samples) / RATE >= 0.6 else None
        loud = round(vc.loudness(samples), 1) if len(samples) >= 320 else None
        temb = self.text.embed([text])[0]
        p = {'session': s['id'], 'at': s['started'] + t0, 't0': round(t0, 2), 't1': round(t1, 2), 'text': text, 'speaker': words[0].get('speaker'),
             'loud_db': loud, 'confidence': round(float(np.mean([w.get('confidence', 0) for w in words])), 2)}
        with self.vlock:
            r = self.voices.assign(dict(p, t0=t0, t1=t1, seconds=t1 - t0, vemb=None if vemb is None else vemb.astype(np.float64)), s['heard'])
            merged = self.voices.merge_similar()
            pid = self.voices.resolve(r['person_id']) if r['person_id'] else None
            p.update(person_id=pid, inferred=r['inferred'], match=r['match'], voice=self._voice(pid))
            p['id'] = self.store.add(p, vemb, temb)
            for gone, into in merged:
                self.store.drop_person(gone, into)
            self.store.save_people(self.voices.people, None if merged else r['changed'] | ({pid} if pid else set()))
            s['heard'] = s['heard'][-40:] + [{'session': s['id'], 'speaker': p['speaker'], 't0': t0, 't1': t1, 'person_id': pid, 'inferred': r['inferred']}]
            for h in s['heard']:
                h['person_id'] = self.voices.resolve(h['person_id']) if h['person_id'] else None
            if r['auto_main']:
                self.main_source = 'auto: first long phrase'
                self._save_main()
            person = self.voices.people.get(pid) if pid else None
        self.tell(dict(p, type='final', person=display_name(pid, person.kind, person.name) if person else None))
        if r['auto_main']:                              # what was said before a main person was known is assigned now
            self.recluster()
        elif merged:                                    # earlier lines change label: the pages fetch them again
            self.store.refresh_voice()
            self.tell({'type': 'relabel'})
            self.tell(self.status())
        elif r['created']:
            self.tell({'type': 'people'})

    # -- who is who
    def _save_main(self):
        main = self.voices.main()
        if main is not None:
            os.makedirs(DATA, exist_ok=True)
            np.save(self.main_path, main.centroid().astype(np.float32))

    def recluster(self, pinned=None, tell=True):
        """Every stored phrase assigned again. The main person and people with a name are kept (their old voiceprint
        stands in until their phrases join); other people keep their number when a new group matches their voiceprint."""
        TEMP = 1000000
        with self.vlock:
            old = self.voices
            seeds = [Person(p.id, p.kind, p.name, p.total.copy(), p.n, p.created, p.last_heard) for p in old.people.values() if p.kind == 'main' or p.name]
            unnamed = [p for p in old.people.values() if not (p.kind == 'main' or p.name)]
            eng, got = rebuild(self.store.phrases_for_rebuild(), seeds, TEMP, pinned)
            next_id, renum = max(old.next_id, eng.next_id if eng.next_id < TEMP else 0), {}
            for p in sorted((p for p in eng.people.values() if p.id >= TEMP), key=lambda p: p.id):
                score = [(float(np.dot(o.centroid(), p.centroid())), o) for o in unnamed if o.id not in renum.values()]
                best = max(score, key=lambda x: x[0], default=(0, None))
                renum[p.id] = best[1].id if best[0] >= JOIN else None
                if renum[p.id] is None:
                    renum[p.id], next_id = next_id, next_id + 1
            for t, real in renum.items():
                p = eng.people.pop(t)
                p.id = real
                eng.people[real] = p
            for r in got.values():
                if r['person_id'] in renum:
                    r['person_id'] = renum[r['person_id']]
            eng.alias, eng.next_id = {}, next_id
            for p in eng.people.values():
                p.seed = False
            self.voices = eng
            self.store.save_people(eng.people)
            self.store.reassign(got)
            self.store.refresh_voice()
            self.main_source = self.main_source if eng.main() else None
            self._save_main()
        if tell:
            self.tell({'type': 'relabel'})
            self.tell(self.status())
        return {'ok': True, 'phrases': len(got), 'people': self.people()}

    def enroll(self, ids):
        """The person who said these phrases is the main person. Every stored phrase is assigned again."""
        got = self.store.voice_embeddings(ids)
        if not got:
            return {'error': 'Those phrases are too short to learn a voice from. Pick a longer one.'}
        with self.vlock:
            owners = [pid for _, pid, _ in got if pid in self.voices.people]
            pid = max(set(owners), key=owners.count) if owners else None
            old = self.voices.main()
            if pid is None:
                person = old or self.voices.new('main', time.time())
            else:
                person = self.voices.people[pid]
            if old is not None and old is not person:
                old.kind = 'voice'
            person.kind = 'main'
            person.total, person.n = np.sum([e for _, _, e in got], axis=0), len(got)
            self.main_source = 'enrolled from %d phrase(s)' % len(got)
            out = self.recluster(pinned={i: person.id for i, _, _ in got})
        return {'ok': True, 'relabelled': out['phrases'], 'people': out['people']}

    def forget_voice(self):
        """Nobody is the main person any more (the people and their phrases stay)."""
        with self.vlock:
            main = self.voices.main()
            if main is not None:
                main.kind = 'voice'
                self.store.save_people(self.voices.people)
            self.main_source = None
            if os.path.exists(self.main_path):
                os.remove(self.main_path)
            self.store.refresh_voice()
        self.tell({'type': 'relabel'})
        self.tell(self.status())
        return {'ok': True}

    def people(self):
        return self.store.people_list()

    def person(self, id, name=None, merge_into=None):
        """Rename a person (an empty name goes back to "Mom" / "Voice N"), or fold them into another person."""
        with self.vlock:
            if id not in self.voices.people:
                return {'error': 'There is no such voice.'}
            if merge_into is not None:
                if merge_into not in self.voices.people or merge_into == id:
                    return {'error': 'There is no such voice to put these lines under.'}
                gone, into = self.voices.merge(id, merge_into)
                self.store.drop_person(gone, into)
                self.store.save_people(self.voices.people)
                self.store.refresh_voice()
            else:
                self.voices.people[id].name = (str(name or '').strip()[:40]) or None
                self.store.save_people(self.voices.people, {id})
        self.tell({'type': 'relabel'})
        return {'ok': True, 'people': self.people()}

    def search(self, query, voice=None, limit=10, recency=0.0, person=None):
        return self.store.search(query, self.text, voice or None, limit, recency, person or None)

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
