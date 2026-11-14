"""Check the three keys in .env. Prints only "works" or the status number, never a key.

    .venv/bin/python tools/check_keys.py
"""
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def check(name, env, url, headers):
    key = os.environ.get(env, "")
    if not key:
        print(f"{name}: NOT set ({env} is empty in .env)")
        return None
    try:
        r = httpx.get(url, headers=headers(key), timeout=15)
    except httpx.HTTPError as e:
        print(f"{name}: could not reach the service ({type(e).__name__})")
        return None
    print(f"{name}: works" if r.status_code == 200 else f"{name}: NOT working, status {r.status_code}")
    return r if r.status_code == 200 else None


check("Deepgram", "DEEPGRAM_API_KEY", "https://api.deepgram.com/v1/projects",
      lambda k: {"Authorization": f"Token {k}"})
r = check("Gemini", "GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
          lambda k: {"x-goog-api-key": k})
if r is not None:
    names = [m["name"].removeprefix("models/") for m in r.json().get("models", [])]
    picks = [n for n in names if any(w in n for w in ("hydrogen", "carbon", "argon"))]
    print("  Gemini 4 models this key can use:", ", ".join(picks) or "none found; all: " + ", ".join(names[:15]))
r = check("Stripe", "STRIPE_SECRET_KEY", "https://api.stripe.com/v1/balance",
          lambda k: {"Authorization": f"Bearer {k}"})
if r is not None:
    print("  Stripe mode:", "live (careful: real money)" if r.json().get("livemode") else "test")
