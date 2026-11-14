"""Run the decision model (gemini-decision-1) on cases with a known right answer.

    .venv/bin/python experiments/decisions/eval_decisions.py
    .venv/bin/python experiments/decisions/eval_decisions.py --threshold 0.8

Cases and questions live in cases.json: add a case whenever the model surprises you.
--threshold: an answer below this confidence counts as "unsure" (the system would ask or wait).
The cases are written by us, so this shows the model reasons sensibly, not that it is accurate on real data.
"""
import argparse
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent.parent / ".env")
p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
p.add_argument("--threshold", type=float, default=0.8)
args = p.parse_args()

spec = json.loads((HERE / "cases.json").read_text())
right = wrong = unsure_right = unsure_wrong = 0
for case in spec["cases"]:
    r = httpx.post("https://generativelanguage.googleapis.com/v1beta/decisions",
                   headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, timeout=30,
                   json={"model": "gemini-decision-1", "input": case["input"],
                         "questions": {k: spec["questions"][k] for k in case["want"]}})
    if r.status_code != 200:
        raise SystemExit("The Decisions API answered status %d for case '%s'." % (r.status_code, case["name"]))
    answers, parts = r.json()["answers"], []
    for key, want in case["want"].items():
        a = answers[key]
        got = (a["noul"] >= 0.5) if a["type"] == "noul" else a["choice"]
        sure = a["confidence"] >= args.threshold
        good = got == want
        right += good and sure
        wrong += (not good) and sure
        unsure_right += good and not sure
        unsure_wrong += (not good) and not sure
        parts.append("%s=%s %.2f %s" % (key, got, a["confidence"], ("OK" if good else "WRONG (wanted %s)" % want) + ("" if sure else ", unsure")))
    print("%-30s %s" % (case["name"], " | ".join(parts)))
total = right + wrong + unsure_right + unsure_wrong
print("\n%d answers. Confident and right: %d. Confident and WRONG: %d. Unsure (below %.2f): %d right, %d wrong." % (
    total, right, wrong, args.threshold, unsure_right, unsure_wrong))
print("The number that matters is 'confident and wrong': those are the mistakes a threshold cannot catch.")
