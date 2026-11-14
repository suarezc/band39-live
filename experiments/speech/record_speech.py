"""Record the test phrases through the band's microphone, one condition at a time.

    .venv/bin/python experiments/speech/record_speech.py --condition "arm's length, quiet"
    .venv/bin/python experiments/speech/record_speech.py --condition "across the room"
    .venv/bin/python experiments/speech/record_speech.py --condition "arm's length, TV on"
    add --only fine,not-fine to record a few;  --sim plays the kit's sample voice (checks the plumbing only)

Nothing leaves the computer while recording. Each phrase is saved as an .ogg file under
experiments/data/speech/ and listed in voices.json. Then score them (this SENDS the recordings to Deepgram):

    .venv/bin/python vexo-open-kit/examples/python/speech_accuracy.py experiments/data/speech --show

The band's light is solid blue while its microphone is on. Tell the people near you first.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import band as kit  # noqa: E402
from ogg_opus import OggOpusWriter  # noqa: E402

p = kit.parser(__doc__.splitlines()[0])
p.add_argument("--condition", required=True, help='how it is recorded, e.g. "arm\'s length, quiet"')
p.add_argument("--who", default="", help="initials of the speaker, optional")
p.add_argument("--only", default="", help="comma-separated phrase ids; default is all of them")
args = p.parse_args()

phrases = json.loads((Path(__file__).parent / "phrases.json").read_text())
if args.only:
    phrases = [x for x in phrases if x["id"] in args.only.split(",")]
out = kit.DATA / "speech"
out.mkdir(parents=True, exist_ok=True)
index = out / "voices.json"
voices = json.loads(index.read_text()) if index.exists() else []
slug = re.sub(r"[^a-z0-9]+", "-", (args.condition + " " + args.who).lower()).strip("-")

options = {}
if args.sim:
    from vexo_open import audio
    options["audio_packets"] = audio.ogg_packets(str(kit.KIT / "dashboard" / "speech" / "sample-speech.opus"))
band = kit.connect(args, **options)
print("The microphone records the people near the band. Tell them. Nothing is sent anywhere while recording.\n")
for phrase in phrases:
    seconds = max(4.0, 0.45 * len(phrase["text"].split()) + 2.5)
    if not args.sim:
        input('Press Enter, wait for the blue light, then say:\n    "%s"\n' % phrase["text"])
    name = "%s_%s.ogg" % (slug, phrase["id"])
    writer = OggOpusWriter(str(out / name))
    handler = lambda a: writer.write(a.seq, a.opus)   # noqa: E731
    band.on("audio", handler)
    band.configure(audio=True)
    band.wait(seconds)
    band.configure(audio=False)
    band.off("audio", handler)
    writer.close()
    voices = [v for v in voices if v["file"] != name] + [
        {"file": name, "text": phrase["text"], "group": "%s | %s" % (args.condition, phrase["kind"])}]
    index.write_text(json.dumps(voices, indent=1))
    print("  saved %s (%.1f s)" % (name, seconds))
band.disconnect()
print("\nSaved %d recordings. Score them with:\n  .venv/bin/python vexo-open-kit/examples/python/speech_accuracy.py experiments/data/speech --show" % len(phrases))
