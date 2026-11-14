"""Shared by the experiment scripts: the band number (one place), the kit's path, connecting."""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT / "vexo-open-kit"
sys.path.insert(0, str(KIT / "python"))             # the library
sys.path.insert(0, str(KIT / "examples" / "python"))  # ogg_opus, speech helpers
DATA = Path(__file__).resolve().parent / "data"

from vexo_open.sync import Band  # noqa: E402

BAND = 39  # our band, Vexo-HACK-39. The only band these scripts connect to.


def parser(description):
    p = argparse.ArgumentParser(description=description)
    link = p.add_mutually_exclusive_group()
    link.add_argument("--sim", action="store_true", help="pretend band (made-up data: checks the plumbing only)")
    link.add_argument("--usb", action="store_true", help="USB cable instead of Bluetooth")
    return p


def connect(args, **options):
    transport = "sim" if args.sim else "serial" if args.usb else "ble"
    if not args.sim:
        print("Connecting to Vexo-HACK-%d... (double-tap the band first; close the dashboard and other pages)" % BAND)
    band = Band.connect(BAND, transport, **options)
    print("Connected to %s over %s." % (band.name, "the pretend band" if args.sim else transport))
    return band
