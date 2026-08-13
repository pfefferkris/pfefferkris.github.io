"""Adversarial battery for the miss-telemetry word gate.

Mirrors sanitizeQuestion() in api/ask.js exactly. If this and that ever disagree the
gate is not what the comments claim, so keep them in step.

Run: python scripts/test_safelist.py
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_GATE = json.load(io.open(os.path.join(ROOT, "data", "asksafe.json"), encoding="utf8"))
SAFE = set(_GATE["words"])
DOMAIN = set(_GATE.get("domain") or [])
MAX_WORDS = 24


def sanitize(q):
    # Case is read before lowercasing: a capital in mid-sentence marks a proper noun,
    # which is how places and names that ARE dictionary words get caught.
    tokens = [t for t in re.split(r"[^A-Za-z]+", str(q or "")) if t]
    out = []
    for i, tok in enumerate(tokens):
        raw = tok.lower()
        # His own legal vocabulary survives capitalisation; a proper noun does not.
        if i > 0 and tok[0].isupper() and raw not in DOMAIN:
            continue
        if len(raw) < 2 or len(raw) > 20:
            continue
        if raw not in SAFE:
            continue
        out.append(raw)
        if len(out) >= MAX_WORDS:
            break
    return " ".join(out)


FAILS = []


# Each case: the question a visitor might type, and the substrings that must NOT
# survive. The battery is the same shape as the PII run of 2026-08-12: identifiers
# first, then the things people actually put in a question without thinking.
LEAK_CASES = [
    ("my ssn is 555-12-3456 and I want to leave my ira to my kids",
     ["555", "12", "3456"]),
    ("I live at 1420 Kensington Court, Wilmington NC 28403, who inherits the house",
     ["1420", "kensington", "wilmington", "nc", "28403"]),
    ("my account at Wells Fargo ending 8891 has $412,000 in it, does it go through probate",
     ["wells", "fargo", "8891", "412", "000"]),
    ("call me at 910-555-0134 about my mother Doreen Pfeffer's estate",
     ["910", "555", "0134", "doreen", "pfeffer"]),
    ("email kristian.pfeffer@gmail.com — my brother Tyrique is the executor",
     ["kristian", "pfeffer", "gmail", "com", "tyrique"]),
    ("my daughter Aaliyah in Fayetteville gets the Roth, my son Dmitri gets nothing",
     ["aaliyah", "fayetteville", "dmitri"]),
    ("Dr. Okonkwo said my husband has maybe 6 months, what do we sign first",
     ["okonkwo"]),
    ("I was born 03/14/1958 and my policy number is AX-77201",
     ["03", "14", "1958", "ax", "77201"]),
]

print("== leak battery ==")
for q, forbidden in LEAK_CASES:
    got = sanitize(q)
    leaked = [f for f in forbidden if re.search(r"\b" + re.escape(f) + r"\b", got)]
    ok = not leaked
    print(("  PASS " if ok else "  FAIL ") + repr(got))
    if not ok:
        FAILS.append("leaked %s from %r" % (leaked, q))


# The other half of the job: a gate that emits nothing is perfectly private and
# perfectly useless. These are the real misses from the dream's gap analysis, and
# enough must survive that Kristian can tell what to write next.
USEFUL_CASES = [
    ("does homeowners insurance cover a guest who gets hurt on my porch",
     ["insurance", "cover", "guest", "hurt"]),
    ("how do I value a closely held business for a buy sell agreement",
     ["business", "buy", "sell", "agreement"]),
    ("when do I actually need to hire an attorney instead of doing this myself",
     ["attorney", "hire"]),
    ("what happens to my family farm if none of the children want to run it",
     ["family", "farm", "children"]),
    ("can a long term care policy be owned by an irrevocable trust",
     ["care", "policy", "trust"]),
]

print("\n== usefulness battery ==")
for q, expected in USEFUL_CASES:
    got = sanitize(q)
    missing = [w for w in expected if w not in got.split()]
    ok = not missing
    print(("  PASS " if ok else "  FAIL ") + repr(got))
    if not ok:
        FAILS.append("dropped %s from %r" % (missing, q))

print("\n== shape ==")
long_q = " ".join(["trust"] * 60)
print("  word cap:", len(sanitize(long_q).split()), "<=", MAX_WORDS)
if len(sanitize(long_q).split()) > MAX_WORDS:
    FAILS.append("word cap not enforced")
if not re.fullmatch(r"[a-z ]*", sanitize("Mixed CASE 123 !!! text")):
    FAILS.append("output is not letters and spaces only")

print("\n" + ("ALL PASS" if not FAILS else "FAILED:\n  " + "\n  ".join(FAILS)))
sys.exit(1 if FAILS else 0)
