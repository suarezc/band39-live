"""Can gemini-decision-1 judge AUDIO directly (groans, laboured breathing, calls for help)?

    .venv/bin/python experiments/decisions/audio_test.py              # generate missing clips, check, judge, print table
    .venv/bin/python experiments/decisions/audio_test.py --only gen   # just make/check clips
    .venv/bin/python experiments/decisions/audio_test.py --runs 2     # ask the audio questions twice per clip (stability)
    .venv/bin/python experiments/decisions/audio_test.py --rejudge    # ignore cached Decisions answers

Clips are synthetic (Deepgram Aura TTS, Gemini TTS with style direction, numpy). They are cached in
CACHE (below) with a check file (duration, loudness, Deepgram transcript) and cached Decisions answers,
so a rerun costs nothing unless --rejudge or clips are deleted.
Request shape that works: input = [{"type":"text","text":...}, {"type":"audio","data":<base64>,"mime_type":"audio/wav"}].
Keys come from .env and are only ever sent in headers.
"""
import argparse
import base64
import io
import json
import os
import time
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent.parent / ".env")
CACHE = Path("/private/tmp/claude-501/-Users-charlessuarez-vexohacks/56491f33-22d1-417b-bb12-03f11ca839e1/scratchpad/audio-decisions")
SR = 16000
GEM = "https://generativelanguage.googleapis.com/v1beta"
TTS_MODELS = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts"]

# ---- clip specs -------------------------------------------------------------------------------
# want: expected answers. None = not scored (genuinely ambiguous, e.g. the conflict clips).
# urgency is scored as a range of acceptable levels (0..3).
def W(distress, wordless, help_, speaking, kind, urg):
    return {"distress": distress, "wordless": wordless, "help": help_, "speaking": speaking, "kind": kind, "urgency": urg}

CALM = W(False, False, False, True, "calm_speech", [0])
FINE = W(False, False, False, True, "calm_speech", [0])
HELP = W(True, False, True, True, "call_for_help", [2, 3])
WORDLESS = W(True, True, False, False, "wordless_distress", [2, 3])
QUIET = W(False, False, False, False, "silence_noise", [0])
TV = W(False, False, False, True, "broadcast", [0])

STYLE_GROAN = ("Perform ONLY non-verbal sounds, no words at all: an elderly man who has just fallen on the floor, "
               "groaning and moaning in pain, with long low groans and heavy laboured breathing between them, for about eight seconds.")
CLIPS = [
    dict(id="calm_toast_vesta", cls="calm speech", make=("dg", "aura-2-vesta-en",
         "I had toast for breakfast this morning, and then I watered the tomatoes. I think I'll make soup later."), want=CALM),
    dict(id="calm_garden_orion", cls="calm speech", make=("dg", "aura-2-orion-en",
         "The weather's nice today. I sat in the garden for a while and read the paper with my tea."), want=CALM),
    dict(id="fine_thalia", cls="I'm fine (calm)", make=("dg", "aura-2-thalia-en", "I'm fine. I'm fine, thank you. Nothing happened, I just sat down."), want=FINE),
    dict(id="fine_gemini", cls="I'm fine (calm)", make=("gem", "Kore", "Say calmly and cheerfully: I'm fine, dear, really. I just dropped my glasses."), want=FINE),
    dict(id="help_orion_flat", cls="call for help (flat TTS voice; words-alarming/tone-flat conflict)", make=("dg", "aura-2-orion-en",
         "Help, I've fallen and I can't get up. Please, somebody help me."), want=W(None, False, True, True, None, [2, 3])),
    dict(id="help_gemini_panic", cls="call for help", make=("gem", "Charon",
         "Say in a frightened, breathless, pained voice of an old man lying on the floor, shouting for help: Help! Help me, I've fallen and I can't get up!"), want=HELP),
    dict(id="help_gemini_weak", cls="call for help", make=("gem", "Sulafat",
         "Say in a weak, trembling, pained voice of an elderly woman who has fallen: Please... somebody help me... I can't get up."), want=HELP),
    dict(id="groan_gemini_m", cls="wordless distress (groan)", make=("gem", "Charon", STYLE_GROAN), want=WORDLESS),
    dict(id="groan_gemini_f", cls="wordless distress (moan)", make=("gem", "Sulafat",
         "Perform ONLY non-verbal sounds, no words: an elderly woman lying on the floor in pain, moaning and whimpering, "
         "\"ohhh... mmmmh... ahhh...\", with shaky breaths, for about eight seconds."), want=WORDLESS),
    dict(id="breath_gemini", cls="wordless distress (laboured breathing)", make=("gem", "Fenrir",
         "Perform ONLY breathing sounds, no words: very heavy, laboured, wheezing, gasping breathing of someone in pain "
         "who is struggling to breathe, for about eight seconds. (gasp) (wheeze) (gasp)"), want=WORDLESS),
    dict(id="cry_gemini", cls="wordless distress (crying)", make=("gem", "Leda",
         "Perform ONLY non-verbal sounds, no words: an elderly woman sobbing and crying in pain, sniffling and whimpering, for about eight seconds."), want=WORDLESS),
    dict(id="groan_synth", cls="wordless distress (numpy synthetic groan)", make=("synth_groan",), want=WORDLESS),
    dict(id="breath_synth", cls="wordless distress (numpy synthetic breathing)", make=("synth_breath",), want=WORDLESS),
    dict(id="silence", cls="silence", make=("silence",), want=QUIET),
    dict(id="room_noise", cls="low background noise", make=("noise",), want=QUIET),
    dict(id="tv_weather", cls="broadcast speech (clean)", make=("dg", "aura-2-orion-en",
         "And now the weather. Tomorrow will start cloudy with outbreaks of rain spreading from the west, "
         "clearing by the afternoon. Highs of fourteen degrees."), want=TV),
    dict(id="tv_weather_far", cls="broadcast speech (quiet, muffled, noisy, from another room)", make=("tvfar", "tv_weather"), want=TV),
    dict(id="tv_news_gemini", cls="broadcast speech (newsreader style)", make=("gem", "Iapetus",
         "Read like a professional TV newsreader: Good evening. Police are appealing for witnesses after a man fell from a ladder in the town centre. "
         "He was taken to hospital."), want=W(False, False, False, True, "broadcast", [0])),
    dict(id="fine_shaky", cls="conflict: calm words, distressed shaky voice", make=("gem", "Sulafat",
         "Say in a very shaky, tearful, pained, breathless voice, with a groan in the middle, as if hurt and trying to hide it: "
         "I'm fine... (groan) ...I'm fine, really, don't call anyone."), want=W(True, False, False, True, None, [1, 2, 3])),
    dict(id="fine_then_groan", cls="conflict: calm 'I'm fine' then synthetic groan (spliced)", make=("splice", "fine_thalia", "groan_synth"),
         want=W(True, None, False, True, None, [1, 2, 3])),
    # added after the first run: realistic confusions and harder mixes
    dict(id="laugh_gemini", cls="false-alarm test: hearty laughter, no words", make=("gem", "Puck",
         "Perform ONLY non-verbal sounds, no words: an older man laughing heartily at a joke, chuckling and wheezing with laughter, for about six seconds."),
         want=W(False, False, False, False, None, [0, 1])),
    dict(id="cough_gemini", cls="ambiguous: coughing fit, no words", make=("gem", "Fenrir",
         "Perform ONLY non-verbal sounds, no words: an elderly man having a short coughing fit, clearing his throat, for about six seconds."),
         want=W(None, None, False, False, None, None)),
    dict(id="groan_under_tv", cls="groan (groan_gemini_m) with the TV forecast playing at the same level", make=("mix", "tv_weather", "groan_gemini_m", 1.0, 1.0),
         want=W(True, True, False, True, None, [2, 3])),
    dict(id="groan_quiet", cls="groan (groan_gemini_m) at -20 dB + room noise (wearer far from mic)", make=("mix", "room_noise", "groan_gemini_m", 1.0, 0.1),
         want=WORDLESS),
]

QUESTIONS = {
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
}
CONTEXT = ("This is a 5-10 second clip from the microphone of a wristband worn by an older person living alone, "
           "recorded just after the band detected a possible fall.")


def key(name):
    return os.environ[name]


def report_error(what, r):
    try:
        msg = r.json().get("error", {}).get("message", r.text[:300])
    except Exception:
        msg = r.text[:300]
    print("  ! %s: HTTP %d: %s" % (what, r.status_code, msg))


# ---- audio generation -------------------------------------------------------------------------
def resample(x, sr_in, sr_out=SR):
    if sr_in == sr_out:
        return x
    n = int(len(x) * sr_out / sr_in)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def dg_tts(voice, text):
    r = httpx.post("https://api.deepgram.com/v1/speak?model=%s&encoding=linear16&sample_rate=%d&container=wav" % (voice, SR),
                   headers={"Authorization": "Token " + key("DEEPGRAM_API_KEY")}, json={"text": text}, timeout=60)
    if r.status_code != 200:
        report_error("Deepgram TTS", r)
        return None, None
    x, sr = sf.read(io.BytesIO(r.content), dtype="float32")
    return resample(x, sr), "deepgram %s" % voice


def gem_tts(voice, prompt):
    for model in TTS_MODELS:
        body = {"contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseModalities": ["AUDIO"],
                                     "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
        r = httpx.post("%s/models/%s:generateContent" % (GEM, model), headers={"x-goog-api-key": key("GEMINI_API_KEY")},
                       json=body, timeout=120)
        if r.status_code != 200:
            report_error("Gemini TTS %s" % model, r)
            continue
        try:
            part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
        except (KeyError, IndexError):
            print("  ! Gemini TTS %s returned no audio: %s" % (model, json.dumps(r.json())[:300]))
            continue
        rate = 24000
        if "rate=" in part.get("mimeType", ""):
            rate = int(part["mimeType"].split("rate=")[1].split(";")[0])
        pcm = np.frombuffer(base64.b64decode(part["data"]), dtype="<i2").astype(np.float32) / 32768
        return resample(pcm, rate), "gemini %s voice %s" % (model, voice)
    return None, None


rng = np.random.default_rng(7)


def pink(n):
    w = np.fft.rfft(rng.standard_normal(n))
    w /= np.maximum(np.sqrt(np.arange(len(w))), 1)
    x = np.fft.irfft(w, n)
    return (x / np.abs(x).max()).astype(np.float32)


def synth_groan():
    """Three low vocal-like groans: harmonic source ~110 Hz with slow pitch fall, vowel-ish formants, breathy noise."""
    t_total, out = 8.0, np.zeros(int(8.0 * SR), np.float32)
    for start, dur in [(0.3, 1.8), (3.0, 2.2), (5.9, 1.7)]:
        n = int(dur * SR)
        t = np.arange(n) / SR
        f0 = 120 - 25 * t / dur + 3 * np.sin(2 * np.pi * 5 * t)
        ph = 2 * np.pi * np.cumsum(f0) / SR
        src = sum(np.sin(k * ph) / k for k in range(1, 25))
        spec = np.fft.rfft(src + 0.3 * rng.standard_normal(n))
        f = np.fft.rfftfreq(n, 1 / SR)
        env_f = sum(a * np.exp(-((f - fc) / bw) ** 2) for fc, bw, a in [(500, 120, 1.0), (900, 150, 0.6), (2400, 300, 0.2)])
        v = np.fft.irfft(spec * env_f, n)
        env = np.sin(np.pi * t / dur) ** 0.7
        out[int(start * SR):int(start * SR) + n] += (v * env).astype(np.float32)
    return 0.3 * out / np.abs(out).max(), "numpy: 3 synthetic low groans (harmonic ~110Hz + formant filter)"


def synth_breath():
    """Fast heavy breaths: band-passed noise bursts, ~0.9 s cycle."""
    n = int(8 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    spec = np.fft.rfft(noise)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= np.exp(-((f - 1200) / 900) ** 2)
    x = np.fft.irfft(spec, n)
    cyc = (t % 0.9) / 0.9
    env = np.where(cyc < 0.4, np.sin(np.pi * cyc / 0.4), 0.6 * np.sin(np.pi * np.clip((cyc - 0.45) / 0.5, 0, 1))) ** 2
    x = x * env
    return (0.3 * x / np.abs(x).max()).astype(np.float32), "numpy: band-passed noise bursts at ~67 breaths/min"


def fit(x, lo=5.0, hi=10.0):
    """Pad to >=5 s with faint room noise, crop to <=10 s."""
    x = x[:int(hi * SR)]
    if len(x) < lo * SR:
        pad = int(lo * SR) - len(x)
        x = np.concatenate([x, np.zeros(pad, np.float32)])
    return (x + 0.0005 * pink(len(x))).astype(np.float32)


def load(cid):
    return sf.read(CACHE / (cid + ".wav"), dtype="float32")[0]


def make(clip):
    m = clip["make"]
    if m[0] == "dg":
        return dg_tts(m[1], m[2])
    if m[0] == "gem":
        return gem_tts(m[1], m[2])
    if m[0] == "synth_groan":
        return synth_groan()
    if m[0] == "synth_breath":
        return synth_breath()
    if m[0] == "silence":
        return np.zeros(int(7 * SR), np.float32), "numpy: digital silence (+ the faint pad noise every clip gets, -66 dBFS)"
    if m[0] == "noise":
        return 0.01 * pink(int(7 * SR)), "numpy: pink noise at about -40 dBFS"
    if m[0] == "tvfar":
        x = load(m[1])
        spec = np.fft.rfft(x)
        f = np.fft.rfftfreq(len(x), 1 / SR)
        spec *= (f > 250) & (f < 3000)  # small TV speaker through a wall
        x = 0.06 * np.fft.irfft(spec, len(x)) / np.abs(x).max()
        return (x + 0.01 * pink(len(x))).astype(np.float32), "derived from %s: band-passed 250-3000 Hz, -24 dB, + pink noise" % m[1]
    if m[0] == "mix":
        a, b = load(m[1]), load(m[2])
        n = max(len(a), len(b))
        a, b = np.pad(a, (0, n - len(a))), np.pad(b, (0, n - len(b)))
        return (m[3] * a + m[4] * b).astype(np.float32), "mixed: %s x%.2f + %s x%.2f" % (m[1], m[3], m[2], m[4])
    if m[0] == "splice":
        a, b = load(m[1])[: int(3.5 * SR)], load(m[2])[: int(5 * SR)]
        return np.concatenate([a, 0.6 * b]).astype(np.float32), "spliced: first 3.5 s of %s + first 5 s of %s" % (m[1], m[2])


def transcribe(path):
    r = httpx.post("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true",
                   headers={"Authorization": "Token " + key("DEEPGRAM_API_KEY"), "Content-Type": "audio/wav"},
                   content=path.read_bytes(), timeout=60)
    if r.status_code != 200:
        report_error("Deepgram STT", r)
        return None, None
    alt = r.json()["results"]["channels"][0]["alternatives"][0]
    return alt["transcript"], alt.get("confidence")


def ensure_clips():
    CACHE.mkdir(parents=True, exist_ok=True)
    for c in CLIPS:
        wav, meta = CACHE / (c["id"] + ".wav"), CACHE / (c["id"] + ".json")
        if not wav.exists():
            x, how = make(c)
            if x is None:
                print("  ! could not make %s" % c["id"])
                continue
            sf.write(wav, fit(x), SR, subtype="PCM_16")
            meta.write_text(json.dumps({"how": how}))
        info = json.loads(meta.read_text())
        if "transcript" not in info:
            x = load(c["id"])
            info["duration_s"] = round(len(x) / SR, 2)
            info["rms_dbfs"] = round(float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)), 1)
            info["peak_dbfs"] = round(float(20 * np.log10(np.abs(x).max() + 1e-12)), 1)
            info["transcript"], info["stt_conf"] = transcribe(wav)
            meta.write_text(json.dumps(info, indent=1))
        c["info"] = info
        print("%-18s %5.1fs rms %6.1f dBFS  %-60s | STT: %r" % (c["id"], info["duration_s"], info["rms_dbfs"], info["how"][:60], info["transcript"]))


# ---- decisions --------------------------------------------------------------------------------
def decide(inp):
    t0 = time.time()
    r = httpx.post(GEM + "/decisions", headers={"x-goog-api-key": key("GEMINI_API_KEY")}, timeout=120,
                   json={"model": "gemini-decision-1", "input": inp, "questions": QUESTIONS})
    dt = time.time() - t0
    if r.status_code != 200:
        report_error("Decisions", r)
        return None
    j = r.json()
    return {"answers": j.get("answers", {}), "usage": j.get("usage"), "latency_s": round(dt, 2),
            "block": j.get("prompt_feedback")}


def audio_input(cid, context=True):
    return ([{"type": "text", "text": CONTEXT + " The audio clip follows.\n"}] if context else []) + [
            {"type": "audio", "data": base64.b64encode((CACHE / (cid + ".wav")).read_bytes()).decode(), "mime_type": "audio/wav"}]


def text_input(c):
    tr = c["info"]["transcript"] or ""
    return (CONTEXT + " We only have the speech-to-text transcript of the clip, not the audio. "
            "Transcript: " + ('"%s"' % tr if tr.strip() else "(empty: no words were recognised)"))


def judged(c, mode, run, rejudge):
    p = CACHE / ("%s.%s%d.answers.json" % (c["id"], mode, run))
    if p.exists() and not rejudge:
        return json.loads(p.read_text())
    res = decide(text_input(c) if mode == "text" else audio_input(c["id"], context=(mode == "audio")))
    if res:
        p.write_text(json.dumps(res, indent=1))
    return res


def val(a):
    if a["type"] == "noul":
        return a["noul"] >= 0.5, a["noul"], a["confidence"]
    if a["type"] == "choice":
        return a["choice"], None, a["confidence"]
    probs = a["probabilities"]  # score: "score" is the expected level (a float); take the most likely level
    lvl = int(max(probs, key=probs.get))
    return lvl, a["score"], a["confidence"]


def fmt(res, want, tally, conf_thr):
    if not res or not res["answers"]:
        return "ERROR/blocked"
    out = []
    for k in QUESTIONS:
        a = res["answers"].get(k)
        if a is None:
            out.append("%s=?" % k)
            continue
        got, p, conf = val(a)
        w = want[k]
        if w is None:
            mark = ""
        else:
            ok = (got in w) if k == "urgency" else (got == w)
            sure = conf is None or conf >= conf_thr
            tally["right" if ok else "wrong"] += 1
            if not ok and sure:
                tally["conf_wrong"] += 1
            mark = "" if ok else ("  X!" if sure else " x?")
        if k == "kind":
            out.append("%s(%.2f)%s" % (got, conf, mark))
        elif k == "urgency":
            out.append("urg%d(E%.1f)%s" % (got, p, mark))
        else:
            out.append("%.2f%s" % (p, mark))
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["gen", "all"], default="all")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--rejudge", action="store_true")
    ap.add_argument("--no-context", action="store_true", help="also ask on the bare audio, without the wristband context sentence")
    ap.add_argument("--threshold", type=float, default=0.8, help="confidence at/above which a wrong answer counts as confidently wrong")
    a = ap.parse_args()
    ensure_clips()
    if a.only == "gen":
        return
    clips = [c for c in CLIPS if "info" in c]
    modes = ["audio"] + (["bare"] if a.no_context else []) + ["text"]
    tallies = {m: {"right": 0, "wrong": 0, "conf_wrong": 0} for m in modes}
    lat, toks = {m: [] for m in modes}, {m: [] for m in modes}
    print("\nmodes: audio = context sentence + audio; bare = audio only (--no-context); text = context + Deepgram transcript only")
    print("noul columns = P(yes) for distress / wordless / help / speaking; X! = wrong with confidence >= %.2f, x? = wrong but unsure" % a.threshold)
    for c in clips:
        print("\n%s  [%s]" % (c["id"], c["cls"]))
        for mode in modes:
            for run in range(a.runs if mode == "audio" else 1):
                res = judged(c, mode, run, a.rejudge)
                if res:
                    lat[mode].append(res["latency_s"])
                    toks[mode].append(res["usage"])
                print("  %-6s %s" % (mode + ("" if a.runs == 1 or mode == "text" else str(run)), fmt(res, c["want"], tallies[mode], a.threshold)))
    print()
    for m, t in tallies.items():
        n = t["right"] + t["wrong"]
        print("%-5s scored answers %d: right %d, wrong %d (confidently wrong %d)" % (m, n, t["right"], t["wrong"], t["conf_wrong"]))
        if lat[m]:
            print("      latency median %.2fs max %.2fs" % (float(np.median(lat[m])), max(lat[m])))
    au = [u for u in toks["audio"] if u]
    if au:
        print("audio usage example:", json.dumps(au[0]))
        tot = [u.get("total_input_tokens", 0) for u in au]
        print("audio total_input_tokens median %d (min %d, max %d)" % (int(np.median(tot)), min(tot), max(tot)))


if __name__ == "__main__":
    main()
