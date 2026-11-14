"""Is this the wearer's own voice, and is it close to the band?

    enroll:  .venv/bin/python experiments/speech/voice_check.py enroll margaret one.ogg two.ogg three.ogg
    check:   .venv/bin/python experiments/speech/voice_check.py check margaret reply.ogg
    test:    .venv/bin/python experiments/speech/voice_check.py selftest      (voices made by Deepgram's text-to-speech)

Voice match: a small open speaker-recognition model (WeSpeaker CAM++, 29 MB) that runs on this
computer, so voice samples never leave it. It turns a clip into a list of numbers (an embedding);
two clips of one person give similar lists. The score is their cosine similarity, -1 to 1.
Loudness: how loud the speech in the clip is, in dB below the loudest the microphone can measure
(0 = loudest). The wearer's mouth is about half a metre from the wrist; a TV is across the room.

The model file is not in git. Get it once:
    curl -L -o "experiments/models/wespeaker_en_voxceleb_CAM++.onnx" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx"

YES, NO and NEAR below are first guesses. Tune both on recordings from the real band.
A voiceprint is biometric data: enroll only people who agreed, and keep experiments/data out of git.
"""
import sys
from pathlib import Path

import av
import numpy as np
import kaldi_native_fbank as knf
import onnxruntime as ort

HERE = Path(__file__).resolve().parent
MODEL = HERE.parent / "models" / "wespeaker_en_voxceleb_CAM++.onnx"
VOICES = HERE.parent / "data" / "voices"
YES = 0.65       # similarity at or above this: the wearer. Below NO: someone else. In between: unsure, ask again.
NO = 0.50        # (9 real recordings of 3 people: same person 0.68 and up, different 0.57 and down; a one-second
                 #  'I'm fine' from the right voice scores only about 0.56 to 0.59, which is why there is a middle)
NEAR = -35.0      # speech louder than this many dB: close to the band (guess, needs the real band)
_session = None


def read(path):
    """Any sound file -> samples at 16000 a second, mono, floats from -1 to 1."""
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    parts = []
    with av.open(str(path)) as f:
        for frame in f.decode(audio=0):
            for out in resampler.resample(frame):
                parts.append(out.to_ndarray().reshape(-1))
    return np.concatenate(parts).astype(np.float32) / 32768.0


def embedding(samples):
    """A clip -> 512 numbers that describe the voice. Runs the model directly: 80 mel bands,
    25 ms windows every 10 ms, mean removed over the clip (what the WeSpeaker project does).
    The sherpa-onnx wrapper (2.0.1) gave embeddings that did not separate people, so it is not used."""
    global _session
    if _session is None:
        if not MODEL.exists():
            raise SystemExit("The model file is missing. The top of voice_check.py has the command that gets it.")
        _session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    o = knf.FbankOptions()
    o.frame_opts.dither = 0
    o.frame_opts.samp_freq = 16000
    o.frame_opts.frame_length_ms = 25
    o.frame_opts.frame_shift_ms = 10
    o.mel_opts.num_bins = 80
    o.energy_floor = 0
    fbank = knf.OnlineFbank(o)
    fbank.accept_waveform(16000, (samples * 32768).tolist())
    fbank.input_finished()
    feats = np.stack([fbank.get_frame(i) for i in range(fbank.num_frames_ready)])
    feats = feats - feats.mean(axis=0, keepdims=True)
    e = _session.run(None, {"feats": feats[None].astype(np.float32)})[0][0]
    return e / np.linalg.norm(e)


def loudness(samples):
    """dB of the loudest third of 20 ms pieces: the speech, not the pauses."""
    pieces = samples[: len(samples) // 320 * 320].reshape(-1, 320)
    power = np.sort((pieces ** 2).mean(axis=1))[::-1]
    return float(10 * np.log10(power[: max(1, len(power) // 3)].mean() + 1e-12))


def enroll(name, paths):
    e = np.mean([embedding(read(p)) for p in paths], axis=0)
    VOICES.mkdir(parents=True, exist_ok=True)
    np.save(VOICES / (name + ".npy"), e / np.linalg.norm(e))
    print("Enrolled %s from %d recordings." % (name, len(paths)))


def check(name, path):
    """-> {"match": similarity, "is_wearer": "yes" / "no" / "unsure", "loudness_db": dB, "near": bool, "seconds": length}"""
    samples = read(path)
    score = float(np.dot(np.load(VOICES / (name + ".npy")), embedding(samples)))
    db = loudness(samples)
    return {"match": round(score, 2), "is_wearer": "yes" if score >= YES else "no" if score < NO else "unsure", "loudness_db": round(db, 1), "near": db >= NEAR,
            "seconds": round(len(samples) / 16000, 1)}


def selftest():
    """Three made-up voices say different sentences. Each should match itself and not the others."""
    import os
    import tempfile

    import httpx
    from dotenv import load_dotenv
    load_dotenv(HERE.parent.parent / ".env")
    voices = ["aura-2-thalia-en", "aura-2-andromeda-en", "aura-2-orion-en"]
    enroll_text = ["Good morning, I would like a cup of tea and some toast please.",
                   "The garden looks lovely today, the roses are finally out."]
    replies = ["I'm fine.", "I'm not fine, please call Lisa.", "I'll call the pharmacy on Tuesday at three."]
    folder = Path(tempfile.mkdtemp())

    def say(voice, text, name):
        r = httpx.post("https://api.deepgram.com/v1/speak", params={"model": voice, "encoding": "linear16", "sample_rate": 16000, "container": "wav"},
                       headers={"Authorization": "Token " + os.environ["DEEPGRAM_API_KEY"]}, json={"text": text}, timeout=30)
        if r.status_code != 200:
            raise SystemExit("Deepgram text-to-speech answered status %d." % r.status_code)
        (folder / name).write_bytes(r.content)
        return folder / name

    prints = {v: np.mean([embedding(read(say(v, t, "%s-e%d.wav" % (v, i)))) for i, t in enumerate(enroll_text)], axis=0) for v in voices}
    same, different = [], []
    for v in voices:
        for i, t in enumerate(replies):
            e = embedding(read(say(v, t, "%s-r%d.wav" % (v, i))))
            for other in voices:
                score = float(np.dot(prints[other] / np.linalg.norm(prints[other]), e))
                (same if other == v else different).append((score, t))
    print("same voice:      lowest %.2f, mean %.2f  (%d pairs)" % (min(s for s, _ in same), np.mean([s for s, _ in same]), len(same)))
    print("different voice: highest %.2f, mean %.2f  (%d pairs)" % (max(s for s, _ in different), np.mean([s for s, _ in different]), len(different)))
    for label, text in [("shortest reply", replies[0])]:
        print("%s (%r): same voice %.2f to %.2f" % (label, text, min(s for s, t in same if t == text), max(s for s, t in same if t == text)))
    wrong = sum(s < NO for s, _ in same) + sum(s >= YES for s, _ in different)
    unsure = sum(NO <= s < YES for s, _ in same + different)
    print("With yes at %.2f and no below %.2f: %d of %d pairs judged wrong, %d unsure (would ask again)." % (
        YES, NO, wrong, len(same) + len(different), unsure))
    print("Made-up studio voices are the easy case. The real test is the band's microphone, a real person and a TV.")
    return wrong == 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["selftest"]:
        sys.exit(0 if selftest() else 1)
    if a[:1] == ["enroll"] and len(a) >= 3:
        enroll(a[1], a[2:])
    elif a[:1] == ["check"] and len(a) == 3:
        for key, value in check(a[1], a[2]).items():
            print("%-12s %s" % (key, value))
    else:
        sys.exit(__doc__)
