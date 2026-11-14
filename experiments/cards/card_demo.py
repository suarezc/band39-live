"""Scam-safe cards for Margaret, on Stripe Issuing in TEST MODE (pretend cards, pretend purchases, no real money).

    .venv/bin/python experiments/cards/card_demo.py            the whole story, step by step
    .venv/bin/python experiments/cards/card_demo.py --reset    cancel the demo's cards and start fresh next time

The story:
  1. Margaret gets an everyday virtual card: $50 a purchase, $200 a week, no wire transfers, money orders or
     stored-value loads.
  2. Ordinary purchases go through; a big one and a wire transfer are declined by the card's own rules.
  3. The band flags a likely scam -> the card is frozen -> the scammer's charge is declined.
  4. Lisa approves -> the card works again.
  5. The care shop item is paid with a one-time card: exactly its price, one kind of shop, cancelled after use,
     so nobody can charge it again next month.

The functions (freeze, unfreeze, one_time_card) are what the backend would call. It refuses to run on a live key.
Margaret is fictional; her details below are made up. Real consumer cards need Stripe's approval (private preview).
"""
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
KEY = os.environ.get("STRIPE_SECRET_KEY", "")
if not KEY.startswith("sk_test_"):
    sys.exit("This demo only runs with a Stripe TEST key (STRIPE_SECRET_KEY must start with sk_test_).")
TAG = "band39-demo"                       # marks what this demo made, so --reset touches nothing else

EVERYDAY = {"spending_limits": [{"amount": 5000, "interval": "per_authorization"}, {"amount": 20000, "interval": "weekly"}],
            "blocked_categories": ["wires_money_orders", "non_fi_money_orders", "non_fi_stored_value_card_purchase_load"]}


def flat(data, prefix=""):
    """{'a': {'b': [1, {'c': 2}]}} -> the form fields Stripe wants: a[b][0]=1, a[b][1][c]=2"""
    out = {}
    for key, value in (data.items() if isinstance(data, dict) else enumerate(data)):
        name = "%s[%s]" % (prefix, key) if prefix else str(key)
        if isinstance(value, (dict, list)):
            out.update(flat(value, name))
        else:
            out[name] = str(value).lower() if isinstance(value, bool) else value
    return out


def stripe(method, path, **data):
    r = httpx.request(method, "https://api.stripe.com/v1/" + path, headers={"Authorization": "Bearer " + KEY},
                      data=flat(data) if method == "POST" else None, params=flat(data) if method == "GET" else None, timeout=30)
    body = r.json()
    if r.status_code != 200:
        raise SystemExit("Stripe said no (%d) to %s: %s" % (r.status_code, path, body.get("error", {}).get("message")))
    return body


def money(cents):
    return "$%.2f" % (cents / 100)


V2 = {"Authorization": "Bearer " + KEY, "Stripe-Version": "2026-10-28.preview"}


def financial_account():
    """The pretend account the cards draw on. Stripe makes it when Issuing is switched on; cards need it 'open'."""
    r = httpx.get("https://api.stripe.com/v2/money_management/financial_accounts", headers=V2, timeout=30)
    accounts = r.json().get("data", []) if r.status_code == 200 else []
    if not accounts:
        raise SystemExit("No financial account yet. Finish the Issuing setup at https://dashboard.stripe.com/test/issuing/overview")
    opened = [a for a in accounts if a["status"] == "open"]
    if not opened:
        raise SystemExit("Stripe's financial account is still '%s', so cards cannot be made yet. Look for unfinished setup steps at "
                         "https://dashboard.stripe.com/test/issuing/overview , then run this again." % accounts[0]["status"])
    return opened[0]


def margaret():
    """The demo cardholder: found by its tag, or made once. Every detail is made up (555 numbers are for fiction)."""
    for c in stripe("GET", "issuing/cardholders", limit=100, status="active")["data"]:
        if c["metadata"].get("demo") == TAG:
            return c
    return stripe("POST", "issuing/cardholders", type="individual", name="Margaret Example", email="margaret@example.com",
                  phone_number="+14155550134",
                  individual={"first_name": "Margaret", "last_name": "Example", "dob": {"day": 4, "month": 3, "year": 1948},
                              "card_issuing": {"user_terms_acceptance": {"date": int(time.time()), "ip": "127.0.0.1"}}},
                  billing={"address": {"line1": "123 Main Street", "city": "San Francisco", "state": "CA", "postal_code": "94111", "country": "US"}},
                  metadata={"demo": TAG})


def everyday_card(holder):
    for c in stripe("GET", "issuing/cards", cardholder=holder["id"], limit=100)["data"]:
        if c["metadata"].get("kind") == "everyday" and c["status"] != "canceled":
            return stripe("POST", "issuing/cards/" + c["id"], status="active")
    return stripe("POST", "issuing/cards", cardholder=holder["id"], currency="usd", type="virtual", status="active",
                  financial_account_v2=financial_account()["id"], spending_controls=EVERYDAY, metadata={"demo": TAG, "kind": "everyday"})


def one_time_card(holder, cents, category, what):
    """A card that can pay one thing: this much in total, at this kind of shop."""
    return stripe("POST", "issuing/cards", cardholder=holder["id"], currency="usd", type="virtual", status="active",
                  financial_account_v2=financial_account()["id"], spending_controls={"spending_limits": [{"amount": cents, "interval": "all_time"}], "allowed_categories": [category]},
                  metadata={"demo": TAG, "kind": "one-time", "for": what})


def freeze(card, why):
    """The band flagged a likely scam: stop the card until someone the family trusts says it is fine."""
    return stripe("POST", "issuing/cards/" + card["id"], status="inactive", metadata={"frozen_because": why})


def unfreeze(card, who):
    return stripe("POST", "issuing/cards/" + card["id"], status="active", metadata={"frozen_because": "", "unfrozen_by": who})


def buy(card, cents, shop, category):
    """A pretend purchase (Stripe's test helper). -> True if approved."""
    a = stripe("POST", "test_helpers/issuing/authorizations", card=card["id"], amount=cents, currency="usd",
               merchant_data={"name": shop, "category": category})
    reason = a["request_history"][-1]["reason"] if a.get("request_history") else ""
    print("   %-9s %8s at %-28s %s" % ("APPROVED" if a["approved"] else "DECLINED", money(cents), shop, "" if a["approved"] else "(" + reason.replace("_", " ") + ")"))
    return a["approved"]


def reset():
    n = 0
    for c in stripe("GET", "issuing/cards", limit=100)["data"]:
        if c["metadata"].get("demo") == TAG and c["status"] != "canceled":
            stripe("POST", "issuing/cards/" + c["id"], status="canceled")
            n += 1
    print("Cancelled %d demo card(s)." % n)


def main():
    financial_account()                   # stops here with what to do if Stripe has not opened it yet
    holder = margaret()
    card = everyday_card(holder)
    print("\n1. Margaret's everyday card: a virtual %s ending %s. Limits: $50 a purchase, $200 a week; no wires, money orders or stored-value loads." % (card["brand"], card["last4"]))

    print("\n2. An ordinary day")
    buy(card, 1840, "Corner Pharmacy", "drug_stores_and_pharmacies")
    buy(card, 3275, "Fresh Market", "grocery_stores_supermarkets")
    buy(card, 45000, "Best Electronics (gift cards)", "electronics_stores")
    buy(card, 4000, "QuickWire Money Transfer", "wires_money_orders")

    print("\n3. The band hears an unknown voice asking for gift cards -> scam alert -> the card is frozen")
    card = freeze(card, "scam alert from band 39")
    buy(card, 4500, "Fresh Market (gift cards)", "grocery_stores_supermarkets")

    print("\n4. Lisa calls her mother, then approves in her app -> the card works again")
    card = unfreeze(card, "Lisa")
    buy(card, 1200, "Corner Pharmacy", "drug_stores_and_pharmacies")

    print("\n5. Lisa buys the suggested quad-base cane ($39) with a one-time card")
    once = one_time_card(holder, 3900, "medical_dental_ophthalmic_and_hospital_equipment_and_supplies", "quad-base cane")
    print("   one-time card ending %s: $39.00 in total, medical equipment shops only" % once["last4"])
    buy(once, 3900, "CareSupply Medical", "medical_dental_ophthalmic_and_hospital_equipment_and_supplies")
    buy(once, 3900, "CareSupply Medical (again)", "medical_dental_ophthalmic_and_hospital_equipment_and_supplies")
    buy(once, 500, "Some Other Shop", "miscellaneous_general_merchandise")
    stripe("POST", "issuing/cards/" + once["id"], status="canceled")
    print("   the one-time card is now cancelled for good\n")


if __name__ == "__main__":
    reset() if "--reset" in sys.argv else main()
