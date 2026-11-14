"""Work out the numbers for one or more recordings made by record_motion.py.

    .venv/bin/python experiments/analyze.py experiments/data/motion/gait_*.csv
    .venv/bin/python experiments/analyze.py --selftest       made-up walking signals with a known answer

The file's own "# test:" line picks the analysis:
  noise  the sensor's offset and noise while it lies still
  gait   step and stride timing, regularity (Moe-Nilssen & Helbostad 2004), left/right step-time ratio
         (Apple's scale: up to 1.1 symmetric, 1.1 to 1.5 mild, above 1.5 severe)
  sway   standing balance in the style of ISway (Mancini 2012): RMS, jerk, path of the sway

These are first versions. They are checked on made-up signals (--selftest), not yet on a person.
"""
import sys

import numpy as np

RATE = 100.0   # every recording is put on an even 100-a-second grid before analysis


def load(path):
    """-> (info from the '# key: value' lines, t in seconds, accel Nx3 in g, gyro Nx3 in degrees/second)."""
    info, header_lines = {}, 0
    with open(path) as f:
        for line in f:
            if not line.startswith("#"):
                break
            header_lines += 1
            key, _, value = line[1:].partition(":")
            info[key.strip()] = value.strip()
    raw = np.genfromtxt(path, delimiter=",", comments=None, skip_header=header_lines, names=True)
    t = (raw["t_ms"] - raw["t_ms"][0]) / 1000.0
    grid = np.arange(0, t[-1], 1.0 / RATE)
    column = lambda name: np.interp(grid, t, raw[name])     # noqa: E731
    accel = np.stack([column(n) for n in ("ax", "ay", "az")], axis=1)
    gyro = np.stack([column(n) for n in ("gx", "gy", "gz")], axis=1)
    return info, grid, accel, gyro


def smooth(x, seconds):
    """Moving average over this many seconds (a simple low-pass)."""
    n = max(1, int(round(seconds * RATE)))
    return np.convolve(x, np.ones(n) / n, mode="same")


def peaks(x, min_gap, min_height):
    """Indices of local maxima at least min_gap samples apart and above min_height."""
    found = []
    for i in np.argsort(x)[::-1]:
        if x[i] < min_height:
            break
        if 0 < i < len(x) - 1 and x[i] >= x[i - 1] and x[i] >= x[i + 1] and all(abs(i - j) >= min_gap for j in found):
            found.append(i)
    return np.array(sorted(found))


def autocorrelation(x, max_lag):
    """Unbiased autocorrelation, 1.0 at lag 0."""
    x = x - x.mean()
    ac = np.array([np.dot(x[: len(x) - k], x[k:]) / (len(x) - k) for k in range(max_lag)])
    return ac / ac[0]


# ---- noise ------------------------------------------------------------------------------

def noise(accel, gyro):
    magnitude = np.linalg.norm(accel, axis=1)
    return {
        "accel noise, each axis (mg)": " ".join("%.2f" % v for v in accel.std(axis=0) * 1000),
        "accel |a| mean (g), should be near 1": "%.4f" % magnitude.mean(),
        "accel |a| noise (mg)": "%.2f" % (magnitude.std() * 1000),
        "gyro offset, each axis (deg/s)": " ".join("%.2f" % v for v in gyro.mean(axis=0)),
        "gyro noise, each axis (deg/s)": " ".join("%.3f" % v for v in gyro.std(axis=0)),
    }


# ---- gait -------------------------------------------------------------------------------

def gait(accel, gyro, placement=""):
    """Timing and regularity of walking. On a leg the band sees one stride at a time, not each step."""
    on_leg = placement.startswith(("ankle", "shoe", "shin"))
    magnitude = np.linalg.norm(accel, axis=1)
    signal = smooth(magnitude - smooth(magnitude, 2.0), 0.05)          # drop slow drift, then the fizz
    ac = autocorrelation(signal, int(2.2 * RATE))
    lo, hi = int(0.7 * RATE), int(1.7 * RATE)                           # one stride takes 0.7 to 1.7 s
    candidates = [k for k in range(lo, hi) if ac[k] >= ac[k - 1] and ac[k] >= ac[k + 1]]
    if not candidates:
        return {"result": "no walking rhythm found in this recording"}
    best = max(ac[k] for k in candidates)
    stride_lag = next(k for k in candidates if ac[k] >= 0.85 * best)   # the first strong one, not a multiple
    out = {"stride time (s)": "%.3f" % (stride_lag / RATE), "cadence (steps/min)": "%.0f" % (120 * RATE / stride_lag),
           "stride regularity (0..1)": "%.2f" % ac[stride_lag]}
    if on_leg:
        # One leg: every stride has one big forward swing. Its peaks time the strides of this leg.
        swing = smooth(np.linalg.norm(gyro - gyro.mean(axis=0), axis=1), 0.05)
        at = peaks(swing, int(0.6 * stride_lag), 0.5 * np.percentile(swing, 95))
        if len(at) > 3:
            strides = np.diff(at) / RATE
            out["strides found"] = str(len(strides))
            out["stride time variation (%)"] = "%.1f" % (100 * strides.std() / strides.mean())
            out["peak swing speed (deg/s), mean"] = "%.0f" % swing[at].mean()
        out["note"] = "one leg only: record the other leg too and compare. Stance and swing time: not built yet"
        return out
    half = stride_lag // 2
    near = range(int(half * 0.85), int(half * 1.15) + 1)
    step_lag = max(near, key=lambda k: ac[k])
    out["step regularity (0..1)"] = "%.2f" % ac[step_lag]
    out["symmetry, step / stride regularity (1 = even)"] = "%.2f" % (ac[step_lag] / ac[stride_lag])
    at = peaks(signal, int(0.6 * step_lag), 0.3 * np.percentile(signal, 98))
    if len(at) > 5:
        steps = np.diff(at) / RATE
        a, b = steps[0::2].mean(), steps[1::2].mean()
        ratio = max(a, b) / min(a, b)
        out["steps found"] = str(len(steps))
        out["step time variation (%)"] = "%.1f" % (100 * steps.std() / steps.mean())
        out["step-time ratio, longer / shorter"] = "%.2f  (%s)" % (
            ratio, "symmetric" if ratio <= 1.1 else "mild asymmetry" if ratio <= 1.5 else "severe asymmetry")
        if len(steps) < 14:
            out["note"] = "fewer than 14 steps: too short for a trustworthy asymmetry number"
    return out


# ---- sway -------------------------------------------------------------------------------

def sway(accel, gyro):
    """Standing balance: movement across the direction of gravity, slower than 3.5 Hz."""
    down = accel.mean(axis=0)
    down /= np.linalg.norm(down)
    flat = accel - np.outer(accel @ down, down)                       # what is left is sideways and front-back
    flat = np.stack([smooth(flat[:, i] - flat[:, i].mean(), 0.14) for i in range(3)], axis=1)   # about 3.5 Hz
    size = np.linalg.norm(flat, axis=1)
    jerk = np.diff(flat, axis=0) * RATE
    turning = gyro - gyro.mean(axis=0)
    return {
        "sway RMS (mg)": "%.2f" % (np.sqrt((size ** 2).mean()) * 1000),
        "sway range, 95% (mg)": "%.2f" % (np.percentile(size, 95) * 1000),
        "jerk (mg^2/s, log10)": "%.2f" % np.log10(0.5 * (jerk ** 2).sum() / RATE * 1e6 + 1e-12),
        "sway path (mg per second)": "%.2f" % (np.linalg.norm(np.diff(flat, axis=0), axis=1).sum() * 1000 / (len(flat) / RATE)),
        "turning RMS (deg/s)": "%.3f" % np.sqrt((np.linalg.norm(turning, axis=1) ** 2).mean()),
        "note": "compare with the noise recording: a sway RMS near the noise floor means nothing was measured",
    }


# ---- self-test: made-up walking with a known answer --------------------------------------

def made_up_walk(short, long, seconds=40, noise_mg=20, seed=1):
    """A bump at every step, steps alternating short and long (seconds). Returns accel Nx3."""
    rng = np.random.default_rng(seed)
    t = np.arange(0, seconds, 1 / RATE)
    z = np.ones_like(t)
    at, i = 0.5, 0
    while at < seconds - 0.5:
        z += (0.45 if i % 2 else 0.5) * np.exp(-((t - at) ** 2) / (2 * 0.03 ** 2))
        at += (short if i % 2 else long) + rng.normal(0, 0.008)
        i += 1
    z += rng.normal(0, noise_mg / 1000, len(t))
    return np.stack([rng.normal(0, 0.01, len(t)), rng.normal(0, 0.01, len(t)), z], axis=1)


def selftest():
    ok = True
    for short, long, want in [(0.55, 0.55, 1.00), (0.52, 0.60, 1.15), (0.45, 0.72, 1.60)]:
        accel = made_up_walk(short, long)
        result = gait(accel, np.zeros_like(accel), "belt")
        got = float(result["step-time ratio, longer / shorter"].split()[0])
        good = abs(got - want) < 0.05
        ok &= good
        print("steps of %.2f s and %.2f s: ratio wanted %.2f, got %.2f, symmetry %s  %s" % (
            short, long, want, got, result["symmetry, step / stride regularity (1 = even)"], "OK" if good else "WRONG"))
    quiet = np.random.default_rng(2).normal(0, 0.001, (3000, 3)) + [0, 0, 1]
    wobble = quiet + np.stack([0.006 * np.sin(np.arange(3000) / RATE * 2 * np.pi * 0.4)] * 2 + [np.zeros(3000)], axis=1)
    a, b = float(sway(quiet, quiet * 0)["sway RMS (mg)"]), float(sway(wobble, quiet * 0)["sway RMS (mg)"])
    good = b > 3 * a
    ok &= good
    print("standing still %.2f mg, with a 6 mg wobble %.2f mg  %s" % (a, b, "OK" if good else "WRONG"))
    print("Self-test passed (made-up signals only; a person is the real test)." if ok else "SELF-TEST FAILED")
    return ok


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for path in sys.argv[1:]:
        info, t, accel, gyro = load(path)
        test = info.get("test", "gait")
        print("\n%s\n  %s on %s, %s, %.0f s, %s lost%s" % (
            path, test, info.get("placement", "?"), info.get("condition", "?"), t[-1], info.get("lost_samples", "?"),
            "  (PRETEND BAND: made-up data)" if info.get("pretend_band") == "True" else ""))
        result = noise(accel, gyro) if test == "noise" else sway(accel, gyro) if test == "sway" else gait(accel, gyro, info.get("placement", ""))
        for key, value in result.items():
            print("  %-48s %s" % (key, value))
