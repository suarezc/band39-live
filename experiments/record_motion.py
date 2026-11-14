"""Record the band's motion to a CSV file for the noise, gait and balance tests.

    .venv/bin/python experiments/record_motion.py --test gait --placement ankle-left --condition normal --seconds 30
    .venv/bin/python experiments/record_motion.py --test noise --placement desk --condition flat --seconds 60
    .venv/bin/python experiments/record_motion.py --test sway --placement belt --condition eyes-closed --seconds 30
    add --sim to try it with the pretend band

Saves experiments/data/motion/<test>_<placement>_<condition>_<time>.csv: a few "# key: value" lines,
then one row per sample: n, t_ms, ax, ay, az (g), gx, gy, gz (degrees/second).
"""
import time

import band as kit

p = kit.parser(__doc__.splitlines()[0])
p.add_argument("--test", required=True, choices=["noise", "gait", "sway"])
p.add_argument("--placement", required=True, help="desk, wrist-left, wrist-right, belt, ankle-left, ankle-right, shoe-left ...")
p.add_argument("--condition", required=True, help="normal, limp-left (ankle weight), eyes-open, eyes-closed, foam ...")
p.add_argument("--who", default="", help="initials of the person, optional")
p.add_argument("--seconds", type=float, default=30)
p.add_argument("--rate", type=int, default=208, help="samples a second (208 is the plan; 100 works on any band)")
p.add_argument("--countdown", type=int, default=5, help="seconds to get ready before recording starts")
args = p.parse_args()

# Ranges: an ankle or shoe sees heel strikes of 5-10 g and fast swings; everything else stays small.
on_leg = args.placement.startswith(("ankle", "shoe", "shin"))
accel_range, gyro_range = (16, 1000) if on_leg else (4, 500)

band = kit.connect(args)
band.set_motion(accel_range=accel_range, gyro_range=gyro_range)
rows = []
band.on("motion", lambda m: rows.append((m.n, m.t, m.ax, m.ay, m.az, m.gx, m.gy, m.gz)))
band.set_led("#ffb020", pattern="blink", period=1000)           # amber blink: get ready
for left in range(args.countdown, 0, -1):
    print("Starting in %d..." % left)
    band.wait(1)
band.set_led("#38c172")                                          # green: recording
streams = band.configure(motion=args.rate)
print("Recording %s for %.0f seconds at %s samples a second." % (args.test, args.seconds, streams["motion"]))
band.wait(args.seconds)
band.configure(motion=False)
band.led_off()
band.disconnect()

if len(rows) < 2:
    raise SystemExit("No samples arrived. Nothing saved.")
lost = (rows[-1][0] - rows[0][0] + 1 - len(rows)) if rows[0][0] is not None else None
seconds = (rows[-1][1] - rows[0][1]) / 1000.0
out = kit.DATA / "motion"
out.mkdir(parents=True, exist_ok=True)
path = out / ("%s_%s_%s_%s.csv" % (args.test, args.placement, args.condition, time.strftime("%m%d-%H%M%S")))
with open(path, "w") as f:
    for key, value in [("band", kit.BAND), ("test", args.test), ("placement", args.placement), ("condition", args.condition),
                       ("who", args.who), ("asked_rate", streams["motion"]), ("measured_rate", round((len(rows) - 1) / seconds, 2)),
                       ("accel_range_g", accel_range), ("gyro_range_dps", gyro_range), ("lost_samples", lost),
                       ("pretend_band", args.sim), ("recorded", time.strftime("%Y-%m-%d %H:%M:%S"))]:
        f.write("# %s: %s\n" % (key, value))
    f.write("n,t_ms,ax,ay,az,gx,gy,gz\n")
    for r in rows:
        f.write(",".join("" if v is None else str(v) for v in r) + "\n")
print("Saved %d samples (%.1f s, %.1f a second, %s lost) to %s" % (len(rows), seconds, (len(rows) - 1) / seconds, lost, path))
print("Next: .venv/bin/python experiments/analyze.py %s" % path)
