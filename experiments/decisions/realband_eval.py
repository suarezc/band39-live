"""Evaluate one REAL band recording (session 1114-151423): transcript, voice labels, loudness, and
gemini-decision-1 on the transcript text and on audio clips cut from the WAV.

    .venv/bin/python experiments/decisions/realband_eval.py            # everything (cached answers are reused)
    .venv/bin/python experiments/decisions/realband_eval.py --no-api   # only the local parts (A, B, C, events)
    .venv/bin/python experiments/decisions/realband_eval.py --rejudge  # ask the Decisions API again

Inputs (read-only): experiments/data/live/clips/1114-151423-151800.wav and experiments/data/live/transcript.db.
Clips cut from the WAV and cached API answers go to the session scratchpad (CACHE below), never elsewhere.
Each API answer is cached under a hash of the exact request, so a rerun is free unless a request changes.
Keys come from .env and are only ever sent in the x-goog-api-key header.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sqlite3
import time
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
load_dotenv(ROOT / ".env")
WAV = ROOT / "experiments/data/live/clips/1114-151423-151800.wav"
DB = ROOT / "experiments/data/live/transcript.db"
SESSION = "1114-151423"
CACHE = Path("/private/tmp/claude-501/-Users-charlessuarez-vexohacks/56491f33-22d1-417b-bb12-03f11ca839e1/scratchpad/realband")
URL = "https://generativelanguage.googleapis.com/v1beta/decisions"
SR = 16000

# ---- the script, and which stored phrase words belong to which line ----------------------------
# (line, true speaker, reference text, [(phrase id, first word, last word+1 or None), ...]) ; word indices
# are into the normalised phrase text. Lines 13, 14, 16, 17 have no words (reference empty).
SCRIPT = [
    (1, "main", "I need to call the pharmacy on Tuesday at three about my blood pressure pills.", [(48, 0, None), (49, 0, None)]),
    (2, "main", "Lisa is visiting on Saturday morning, and Ethan scored a goal last week.", [(50, 0, None)]),
    (3, "main", "I had toast and tea for breakfast, and I took my metformin.", [(51, 0, None)]),
    (4, "other", "Hello, this is your bank's security department. Your account has been compromised.", [(53, 0, None), (54, 0, None), (55, 0, None)]),
    (5, "other", "I need you to buy four gift cards today and read me the numbers on the back.", [(56, 0, None), (57, 0, None), (58, 0, 3)]),
    (6, "other", "Your grandson is in jail and needs bail money right now. Don't tell anyone.", [(58, 3, None), (59, 0, None)]),
    (7, "main", "I'm not sure about that. My daughter handles my money.", [(60, 0, None), (61, 0, 5)]),
    (8, "main", "Okay, what card number do you need?", [(61, 5, None)]),
    (9, "main", "I'm fine.", [(62, 0, 2)]),
    (10, "main", "I'm not fine.", [(62, 2, None)]),
    (11, "main", "Help, I've fallen and I can't get up.", [(63, 0, None)]),
    (12, "other", "Oh my god, are you okay? Don't move, let me help you.", [(64, 0, None)]),
    (13, "main", "", []),
    (14, "main", "", []),
    (15, "main", "I'm fine.", [(65, 0, None)]),  # the groan after it has no words
    (16, "main", "", []),
    (17, "main", "", []),
]
# true speaker of every stored phrase in the scripted part (one speaker per phrase here)
PHRASE_TRUTH = {48: "main", 49: "main", 50: "main", 51: "main", 53: "other", 54: "other", 55: "other", 56: "other",
                57: "other", 58: "other", 59: "other", 60: "main", 61: "main", 62: "main", 63: "main", 64: "other", 65: "main"}
PHRASE_LINES = {48: "1", 49: "1", 50: "2", 51: "3", 53: "4", 54: "4", 55: "4", 56: "5", 57: "5", 58: "5-6", 59: "6",
                60: "7", 61: "7-8", 62: "9-10", 63: "11", 64: "12", 65: "15"}
# unscripted phrases that are very probably Charles (introducing the test, asking the second person to read)
PROBABLY_MAIN = [44, 45, 46, 47, 52]
ENROLLED = 48  # the phrase the main voice was learned from: its match of 1.0 is by construction


def norm(s):
    return re.sub(r"[^a-z0-9' ]", " ", s.lower().replace("’", "'")).replace("'", "").split()


def align(ref, hyp):
    """Levenshtein alignment -> list of (op, ref word, hyp word); op in ok/sub/del/ins."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n + 1, m + 1), int)
    d[:, 0], d[0, :] = range(n + 1), range(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    ops, i, j = [], n, m
    while i or j:
        if i and j and d[i, j] == d[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(("ok" if ref[i - 1] == hyp[j - 1] else "sub", ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i and d[i, j] == d[i - 1, j] + 1:
            ops.append(("del", ref[i - 1], None))
            i -= 1
        else:
            ops.append(("ins", None, hyp[j - 1]))
            j -= 1
    return ops[::-1]


def load_rows():
    c = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    cols = ["id", "t0", "t1", "text", "dg_speaker", "voice", "match", "loud_db", "confidence", "vemb"]
    rows = c.execute("select %s from phrases where session=? order by id" % ",".join(cols), (SESSION,)).fetchall()
    c.close()
    out = {r[0]: dict(zip(cols, r)) for r in rows}
    for r in out.values():
        r["vemb"] = None if r["vemb"] is None else np.frombuffer(r["vemb"], dtype=np.float32)
    return out


def f2(v):
    return "-" if v is None else "%.2f" % v


# ---- A. transcript ---------------------------------------------------------------------------
def part_a(rows):
    print("\n## A. Transcript accuracy per scripted line (lowercase, no punctuation)\n")
    print("| line | spoken by | reference | transcript (as stored) | ref words | errors | WER | wrong words |")
    print("|---|---|---|---|---|---|---|---|")
    tot_ref = tot_err = 0
    for line, who, ref, parts in SCRIPT:
        hyp = []
        for pid, a, b in parts:
            hyp += norm(rows[pid]["text"])[a:b]
        r = norm(ref)
        ops = align(r, hyp)
        errs = [o for o in ops if o[0] != "ok"]
        wrong = ", ".join("%s->%s" % (o[1], o[2]) if o[0] == "sub" else ("missing '%s'" % o[1] if o[0] == "del" else "added '%s'" % o[2]) for o in errs)
        tot_ref += len(r)
        tot_err += len(errs)
        wer = ("%.0f%%" % (100 * len(errs) / len(r))) if r else ("0 (no words, none added)" if not hyp else "added words")
        print("| %d | %s | %s | %s | %d | %d | %s | %s |" % (line, "you" if who == "main" else "second", ref or "(no words)",
              " ".join(hyp) or "(nothing)", len(r), len(errs), wer, wrong or "-"))
    print("\nOverall: %d errors / %d reference words = WER %.1f%%" % (tot_err, tot_ref, 100 * tot_err / tot_ref))
    print("Unscripted phrase 52 (%r) sits between lines 3 and 4 and is not scored." % rows[52]["text"])


# ---- B, C. voice labels and loudness ------------------------------------------------------------
def part_bc(rows):
    print("\n## B. Voice labels per stored phrase (truth: 'you' = main, 'second voice' = other)\n")
    print("| id | line | t0-t1 s | dur s | text | truth | app label | match | Deepgram speaker | loud dB | result |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    tally = {"right": 0, "wrong": 0, "unsure": 0}
    for pid, truth in PHRASE_TRUTH.items():
        r = rows[pid]
        res = "unsure" if r["voice"] == "unsure" else ("right" if r["voice"] == truth else "WRONG")
        tally[res.lower()] += 1
        print("| %d | %s | %.1f-%.1f | %.1f | %s | %s | %s | %s | %s | %s | %s |" % (pid, PHRASE_LINES[pid], r["t0"], r["t1"], r["t1"] - r["t0"],
              r["text"], truth, r["voice"], f2(r["match"]), r["dg_speaker"], r["loud_db"], res + (" (enrolment phrase)" if pid == ENROLLED else "")))
    print("\nScripted phrases: right %d, wrong %d, unsure %d (of %d; includes the enrolment phrase 48)" % (
        tally["right"], tally["wrong"], tally["unsure"], len(PHRASE_TRUTH)))
    print("Unscripted, probably Charles: " + "; ".join("%d %r %s %s" % (p, rows[p]["text"], rows[p]["voice"], f2(rows[p]["match"])) for p in PROBABLY_MAIN))
    m_main = [rows[p]["match"] for p, t in PHRASE_TRUTH.items() if t == "main" and p != ENROLLED and rows[p]["match"] is not None]
    m_oth = [rows[p]["match"] for p, t in PHRASE_TRUTH.items() if t == "other" and rows[p]["match"] is not None]
    print("match, you (excluding enrolment phrase 48): %.2f to %.2f (median %.2f, n=%d)" % (min(m_main), max(m_main), np.median(m_main), len(m_main)))
    print("match, second voice: %.2f to %.2f (median %.2f, n=%d)" % (min(m_oth), max(m_oth), np.median(m_oth), len(m_oth)))
    # Deepgram diarization as a cross-check: majority speaker number per true speaker
    for who in ("main", "other"):
        sp = [rows[p]["dg_speaker"] for p, t in PHRASE_TRUTH.items() if t == who]
        print("Deepgram speaker numbers for %s: %s" % (who, sp))
    # stored match == dot(vemb of enrolment phrase 48, vemb) (checked); what if the main voice were learned from lines 1-3?
    print("\nDiagnostic (not what the app does): stored match is the dot product with phrase 48's embedding. If instead the main "
          "voice were the mean of phrases 48, 50, 51 (lines 1-3, all 'you'), the other phrases would score:")
    cen = sum(rows[p]["vemb"] for p in (48, 50, 51))
    cen = cen / np.linalg.norm(cen)
    for who in ("main", "other"):
        sc = ["%d:%.2f" % (p, float(cen @ rows[p]["vemb"])) for p, t in PHRASE_TRUTH.items() if t == who and p not in (48, 50, 51) and rows[p]["vemb"] is not None]
        print("  %s: %s" % (who, " ".join(sc)))
    print("  unscripted probably-Charles: %s" % " ".join("%d:%.2f" % (p, float(cen @ rows[p]["vemb"])) for p in PROBABLY_MAIN if rows[p]["vemb"] is not None))
    print("\n## C. Loudness (loud_db) of stored phrases\n")
    for who in ("main", "other"):
        ld = [rows[p]["loud_db"] for p, t in PHRASE_TRUTH.items() if t == who]
        print("%-6s %.1f to %.1f dB (median %.1f, n=%d)" % (who, min(ld), max(ld), np.median(ld), len(ld)))
    print("line 11 (shout for help) %.1f dB; line 12 (bystander) %.1f dB" % (rows[63]["loud_db"], rows[64]["loud_db"]))


# ---- wordless events by energy ------------------------------------------------------------------
def frame_features(x, t0, t1, hop=0.05):
    out = []
    win = int(0.04 * SR)
    for t in np.arange(t0, t1, hop):
        s = x[int(t * SR):int(t * SR) + win]
        if len(s) < win:
            break
        s = s * np.hanning(win)
        rms = 20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9)
        S = np.abs(np.fft.rfft(s, 1024)) + 1e-9
        f = np.fft.rfftfreq(1024, 1 / SR)
        flat = float(np.exp(np.log(S).mean()) / S.mean())
        cen = float((S * f).sum() / S.sum())
        ac = np.correlate(s, s, "full")[win - 1:]
        ac = ac / (ac[0] + 1e-12)
        lo, hi = int(SR / 400), int(SR / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        out.append((round(t, 2), rms, flat, cen, float(ac[k]), SR / k))
    return out


def find_events(x, t0=181.6, t1=None, rise_db=12.0, gap=0.35, min_len=0.1):
    t1 = t1 or len(x) / SR
    fr = frame_features(x, t0, t1)
    floor = float(np.median([f[1] for f in fr]))
    act = [f for f in fr if f[1] > floor + rise_db]
    events = []
    for f in act:
        if events and f[0] - events[-1][-1][0] <= gap:
            events[-1].append(f)
        else:
            events.append([f])
    res = []
    for ev in events:
        a, b = ev[0][0], ev[-1][0] + 0.05
        if b - a < min_len:
            continue
        voiced = [f for f in ev if f[4] > 0.6]
        res.append(dict(t0=a, t1=round(b, 2), peak=max(f[1] for f in ev), n=len(ev),
                        voiced=len(voiced) / len(ev), flat=float(np.median([f[2] for f in ev])),
                        cen=float(np.median([f[3] for f in ev])),
                        f0=float(np.median([f[5] for f in voiced])) if voiced else None))
    return floor, res


# my reading of the events (I cannot listen): line -> (start, end, confidence, why)
EVENT_GUESS = [
    ("13 groan", 183.6, 184.5, "medium", "loudest wordless burst, partly voiced at ~125-145 Hz (male pitch), but only ~0.8 s long, not the ~5 s asked for; it may be the start of the groan with the rest quieter, or the groan may be inside 184.5-189.5"),
    ("14 breathing", 184.8, 189.6, "medium", "five or six noisy pulses (spectral flatness ~0.33-0.44, centroid ~2 kHz, mostly unvoiced) about 0.6-1 s apart: looks like breaths"),
    ("15 'I'm fine' + groan", 190.0, 192.5, "high", "'I'm fine' is transcribed at 189.9-190.6; right after it a low (centroid ~430 Hz), voiced (~120-150 Hz) sound to 191.2 and a second voiced burst at 191.9-192.4"),
    ("16 laugh then cough", 195.0, 197.3, "medium", "195.0-195.8 is a voiced (~130-140 Hz) burst, consistent with laughter; 196.3-197.2 are three short bursts, the first one unvoiced and noisy, consistent with coughs. Which is laugh and which is cough is inferred from the order in the script"),
    ("17 silence", 197.4, 207.4, "high", "room tone only (about -42 dB per 50 ms frame) from 197.4 s, with tiny clicks at 203.5 and 212.7 s"),
]


def part_events(x):
    print("\n## Wordless region (181.6 s to end): sound events by short-time RMS\n")
    floor, ev = find_events(x)
    print("Room-tone median in this region: %.1f dB per 50 ms frame; events = frames > floor + 12 dB, gaps <= 0.35 s merged.\n" % floor)
    print("| start s | end s | peak dB | voiced frames | median flatness | median centroid Hz | median f0 Hz (voiced) |")
    print("|---|---|---|---|---|---|---|")
    for e in ev:
        print("| %.2f | %.2f | %.1f | %.0f%% | %.2f | %.0f | %s |" % (e["t0"], e["t1"], e["peak"], 100 * e["voiced"], e["flat"], e["cen"],
              "-" if e["f0"] is None else "%.0f" % e["f0"]))
    print("\nMy assignment to script lines (I cannot listen; times are what the clips below use):\n")
    print("| line | clip s | confidence | why |")
    print("|---|---|---|---|")
    for name, a, b, conf, why in EVENT_GUESS:
        print("| %s | %.1f-%.1f | %s | %s |" % (name, a, b, conf, why))


# ---- Decisions API ------------------------------------------------------------------------------
def decide(inp, questions, rejudge=False, tag=""):
    body = {"model": "gemini-decision-1", "input": inp, "questions": questions}
    h = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]
    p = CACHE / "answers" / ("%s.%s.json" % (tag, h))
    if p.exists() and not rejudge:
        return json.loads(p.read_text())
    if API_OFF:
        return None
    t0 = time.time()
    r = httpx.post(URL, headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, json=body, timeout=120)
    CALLS[0] += 1
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", r.text[:300])
        except Exception:
            msg = r.text[:300]
        print("  ! Decisions %s: HTTP %d: %s" % (tag, r.status_code, msg))
        return None
    j = r.json()
    res = {"answers": j.get("answers", {}), "usage": j.get("usage"), "latency_s": round(time.time() - t0, 2)}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(res, indent=1))
    return res


API_OFF = False
CALLS = [0]

SPEC = json.loads((HERE / "cases.json").read_text())
TEXT_Q = {
    "scam": {"type": "noul", "instructions": "Is someone asking for money, gift cards, card numbers or account details (a possible scam)?"},
    "distress": {"type": "noul", "instructions": "Is the speaker in distress or asking for help?"},
    "said_fine": {"type": "noul", "instructions": "Did the speaker say they are fine?"},
}
FALL_Q = dict(TEXT_Q, wearer_ok_v2=SPEC["questions"]["wearer_ok_v2"])

# audio question set copied from audio_test.py (kept identical so results compare), plus the scam question
AUDIO_Q = {
    "distress": {"type": "noul", "instructions": "Is someone in this audio in distress or pain?"},
    "wordless": {"type": "noul", "instructions": "Is there groaning, moaning, crying or laboured breathing (vocal sounds that are not words)?"},
    "help": {"type": "noul", "instructions": "Is someone asking for help?"},
    "speaking": {"type": "noul", "instructions": "Is anyone speaking words in this audio (including from a TV or radio)?"},
    "kind": {"type": "choice", "instructions": "What best describes this audio clip?", "criteria": {
        "calm_speech": "Calm, ordinary speech by a person nearby.",
        "call_for_help": "Someone calling or asking for help.",
        "wordless_distress": "Groaning, moaning, crying or laboured breathing without words.",
        "silence_noise": "Silence or only background noise; nobody vocalising.",
        "broadcast": "Broadcast speech such as TV or radio (newsreader, presenter, programme)."}},
    "urgency": {"type": "score", "instructions": "How urgent is it for a caregiver to check on the wearer, based on this audio?", "criteria": [
        "Not urgent: nothing suggests a problem.",
        "Low: something slightly unusual; check in when convenient.",
        "High: signs of pain or distress; check soon.",
        "Emergency: clear distress or a call for help; act now."]},
    "scam": TEXT_Q["scam"],
}
FALL_CONTEXT = ("This is a 5-10 second clip from the microphone of a wristband worn by an older person living alone, "
                "recorded just after the band detected a possible fall.")  # same sentence as audio_test.py
PLAIN_CONTEXT = "This is a clip from the microphone of a wristband worn by an older person living alone."

TEXT_HEAD = ("Speech heard by the microphone of a wristband worn by an older man living alone. Each phrase shows the "
             "speech-to-text transcript (it may contain errors), the word confidence, the voice label (main = the wearer's "
             "enrolled voice, other = someone else, unsure = cannot tell) and the voice match with the wearer's enrolled voice (0 to 1).\n")
FALL_HEAD = ("Possible fall detected. Band and app asked 'did you fall?'. Speech heard since then, phrase by phrase, with the "
             "speech-to-text transcript (it may contain errors), word confidence, voice label (main = the wearer's enrolled voice, "
             "other = someone else, unsure = cannot tell) and voice match with the wearer's enrolled voice (0 to 1):\n")


def phrase_line(r):
    return '- "%s" (word confidence %.2f; voice: %s; match %s)' % (r["text"], r["confidence"], r["voice"],
                                                                   "none, too short to measure" if r["match"] is None else "%.2f" % r["match"])


TEXT_GROUPS = [  # (name, script lines, phrase ids)
    ("L4", "4", [53, 54, 55]), ("L5", "5 (+start of 6 in 58)", [56, 57, 58]), ("L6", "6", [58, 59]),
    ("L4-6", "4-6", [53, 54, 55, 56, 57, 58, 59]), ("L7", "7 (first half)", [60]), ("L7-8", "7-8", [61]),
    ("L4-8", "4-8 whole call", [53, 54, 55, 56, 57, 58, 59, 60, 61]),
    ("L9-10", "9-10", [62]), ("L11", "11", [63]), ("L12", "12", [64]), ("L15", "15 (words only)", [65]),
]
SINGLE = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 64]
FALL_GROUPS = [
    ("F-9-10", "9-10", [62], ""), ("F-11", "11", [63], ""), ("F-9-11", "9-11", [62, 63], ""),
    ("F-12", "12 bystander only", [64], ""), ("F-11-12", "11-12", [63, 64], ""),
    ("F-13-14", "13-14 (no words reached the transcript)", [], "No words recognised for the last 8 seconds."),
    ("F-15", "15 (groan not in transcript)", [65], "No other words recognised."),
    ("F-9-15", "9-15 all", [62, 63, 64, 65], ""),
]
# counterfactual: the same fall-check phrases, but with the voice label the wearer's phrases SHOULD have had ("main"),
# keeping the stored match number; shows how much of the fall-check answer is driven by the label
RELABEL = [("CF-9-10", "9-10 relabelled main", [62]), ("CF-11", "11 relabelled main", [63]), ("CF-15", "15 relabelled main", [65])]


def ans_cell(res, k):
    if not res or k not in res["answers"]:
        return "ERR"
    a = res["answers"][k]
    if a["type"] == "noul":
        return "%.2f" % a["noul"]
    if a["type"] == "choice":
        pr = a.get("probabilities", {})
        return "%s %.2f" % (a["choice"], a["confidence"]) + (" (" + ", ".join("%s %.2f" % (c, pr[c]) for c in pr if c != a["choice"]) + ")" if pr else "")
    lvl = max(a["probabilities"], key=a["probabilities"].get)
    return "%s (E%.1f)" % (lvl, a["score"])


def part_d(rows, rejudge):
    print("\n## D. Decision model on the TEXT (transcript as produced, with labels and match)\n")
    print("P(yes) per question. Phrases are given exactly as stored (errors included).\n")
    print("| group | lines | phrases | scam | distress/help | said fine |")
    print("|---|---|---|---|---|---|")
    for name, lines, ids in TEXT_GROUPS:
        inp = TEXT_HEAD + "\n".join(phrase_line(rows[i]) for i in ids)
        res = decide(inp, TEXT_Q, rejudge, "text-" + name)
        print("| %s | %s | %s | %s | %s | %s |" % (name, lines, ",".join(map(str, ids)), *(ans_cell(res, k) for k in TEXT_Q)))
    print("\nEach phrase ALONE (as a per-phrase scam check would see it). Scam lines = ids 53-59; negatives = 48-52 (you, ordinary) and 64 (bystander):\n")
    print("| id | truth | text | scam | distress/help | said fine |")
    print("|---|---|---|---|---|---|")
    pos, neg = [], []
    for i in SINGLE:
        res = decide(TEXT_HEAD + phrase_line(rows[i]), TEXT_Q, rejudge, "single-%d" % i)
        kind = "scam line" if 53 <= i <= 59 else "negative"
        if res:
            (pos if kind == "scam line" else neg).append((res["answers"]["scam"]["noul"], i))
        print("| %d | %s | %s | %s | %s | %s |" % (i, kind, rows[i]["text"], *(ans_cell(res, k) for k in TEXT_Q)))
    if pos and neg:
        print("\nscam lines: %.2f to %.2f; negatives: %.2f to %.2f -> %s" % (min(pos)[0], max(pos)[0], min(neg)[0], max(neg)[0],
              "separable on this recording (any threshold between)" if min(pos)[0] > max(neg)[0] else "NOT separable phrase by phrase"))
    print("\nFall check (wearer_ok_v2 wording from cases.json; 'did you fall?' framing; no tap, no motion data given):\n")
    print("| group | lines | phrases | scam | distress/help | said fine | wearer_ok_v2 (other options) |")
    print("|---|---|---|---|---|---|---|")
    for name, lines, ids, extra in FALL_GROUPS:
        body = "\n".join(phrase_line(rows[i]) for i in ids) if ids else "(no phrases)"
        inp = FALL_HEAD + body + ("\n" + extra if extra else "") + "\nNo tap on the band or the app."
        res = decide(inp, FALL_Q, rejudge, "fall-" + name)
        print("| %s | %s | %s | %s |" % (name, lines, ",".join(map(str, ids)) or "-", " | ".join(ans_cell(res, k) for k in FALL_Q)))
    for name, lines, ids in RELABEL:
        inp = FALL_HEAD + "\n".join(phrase_line(dict(rows[i], voice="main")) for i in ids) + "\nNo tap on the band or the app."
        res = decide(inp, FALL_Q, rejudge, "fall-" + name)
        print("| %s | %s | %s | %s |" % (name, lines, ",".join(map(str, ids)), " | ".join(ans_cell(res, k) for k in FALL_Q)))


# ---- E. audio clips -----------------------------------------------------------------------------
CLIPS = [  # (id, lines, start s, end s, context kind)
    ("control_A", "conversation before the test (ids 40-43, speakers unknown)", 0.0, 12.4, "fall"),
    ("control_B", "Charles: 'Alright, I'm gonna start speaking...' (ids 44-47)", 87.3, 92.8, "fall"),
    ("scam_4_6", "4-6 whole scam pitch", 133.3, 153.0, "plain"),
    ("scam_4", "4 bank security", 133.3, 139.1, "plain"),
    ("scam_5_6", "5-6 gift cards + grandson bail", 141.2, 153.0, "plain"),
    ("replies_7_8", "7-8 wearer's replies", 153.6, 159.1, "plain"),
    ("fall_9_11", "9-11 fine / not fine / help I've fallen", 164.8, 172.7, "fall"),
    ("bystander_12", "12 second voice: are you okay", 178.4, 181.9, "fall"),
    ("groan_13", "13 groan (my guess, see events)", 183.4, 184.6, "fall"),
    ("breath_14", "14 laboured breathing (my guess)", 184.7, 189.7, "fall"),
    ("win_13_14", "13-14 together, as an 8 s fall window", 181.9, 189.8, "fall"),
    ("fine_groan_15", "15 'I'm fine' then groan", 189.7, 192.7, "fall"),
    ("laugh_cough_16", "16 laugh then cough (my guess)", 194.8, 197.4, "fall"),
    ("silence_17", "17 ten seconds of silence", 197.4, 207.4, "fall"),
]


def cut_clips(x):
    d = CACHE / "clips"
    d.mkdir(parents=True, exist_ok=True)
    for cid, _, a, b, _ in CLIPS:
        p = d / (cid + ".wav")
        if not p.exists():
            sf.write(p, x[int(a * SR):int(b * SR)], SR, subtype="PCM_16")
    return d


def part_e(x, rejudge):
    d = cut_clips(x)
    print("\n## E. Decision model on AUDIO clips cut from the WAV\n")
    print("ctx = one context sentence first (fall sentence from audio_test.py for fall/control clips; a plain wristband "
          "sentence for scam/replies), bare = audio only. Columns: P(yes) distress, wordless, help, speaking, scam; kind; urgency (most likely level, E = expected).\n")
    print("| clip | lines | s | mode | distress | wordless | help | speaking | scam | kind | urgency |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    toks = []
    for cid, lines, a, b, ctx in CLIPS:
        data = base64.b64encode((d / (cid + ".wav")).read_bytes()).decode()
        audio = {"type": "audio", "data": data, "mime_type": "audio/wav"}
        for mode in ("ctx", "bare"):
            text = (FALL_CONTEXT if ctx == "fall" else PLAIN_CONTEXT) + " The audio clip follows.\n"
            inp = ([{"type": "text", "text": text}] if mode == "ctx" else []) + [audio]
            res = decide(inp, AUDIO_Q, rejudge, "audio-%s-%s" % (cid, mode))
            if res and res.get("usage"):
                toks.append(res["usage"].get("total_input_tokens"))
            print("| %s | %s | %.1f | %s | %s |" % (cid, lines, b - a, mode, " | ".join(ans_cell(res, k) for k in
                  ["distress", "wordless", "help", "speaking", "scam", "kind", "urgency"])))
    if toks:
        print("\ninput tokens per audio call: median %d (min %d, max %d)" % (int(np.median(toks)), min(toks), max(toks)))


def main():
    global API_OFF
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-api", action="store_true", help="skip D and E unless answers are cached")
    ap.add_argument("--rejudge", action="store_true")
    a = ap.parse_args()
    API_OFF = a.no_api
    rows = load_rows()
    x, sr = sf.read(WAV, dtype="float32")
    assert sr == SR and x.ndim == 1
    print("# Real band recording %s (%.1f s)" % (SESSION, len(x) / SR))
    part_a(rows)
    part_bc(rows)
    part_events(x)
    part_d(rows, a.rejudge)
    part_e(x, a.rejudge)
    print("\nDecisions API calls made this run: %d" % CALLS[0])


if __name__ == "__main__":
    main()
