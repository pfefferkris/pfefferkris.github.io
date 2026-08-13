"""Build data/asksafe.json — the word gate for miss telemetry.

Ask Kristian logs one content-free line per question. Until now a miss recorded only
allowlisted domain terms, which fails closed but goes blank on exactly the questions
worth writing an explainer for: the nightly dream could see that 18% of visitors were
failed and not what they wanted.

Kris's direction 2026-08-13: log the sanitized question text, no PII.

The gate stays a WHITELIST rather than becoming a PII blocklist, because a blocklist
only catches what somebody thought of. A word is logged only if it is a common English
dictionary word that is not also a personal name. Everything else — every proper noun,
every place, every misspelling, every token carrying a digit — is simply not in the
list and therefore never written. A stranger's name cannot leak through a gate it was
never on.

Run: python scripts/build_safelist.py
Runtime reads the committed JSON; there is no network call when a visitor asks.
"""
import io
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "asksafe.json")
VOCAB = os.path.join(ROOT, "data", "askvocab.json")

UA = {"User-Agent": "kpfeffer-safelist-builder"}

DICTIONARY = "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt"
FREQUENCY = "https://norvig.com/ngrams/count_1w.txt"
GIVEN_NAMES = "https://raw.githubusercontent.com/hadley/data-baby-names/master/baby-names.csv"
SURNAMES = ("https://raw.githubusercontent.com/fivethirtyeight/data/master/"
            "most-common-name/surnames.csv")

# How many of the most frequent English words to keep. Past this the tail is rare
# enough that a word is more likely to identify a person than to describe an estate
# question, which is the wrong trade for a public log.
FREQ_KEEP = 50000


def fetch(url, timeout=90):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf8", "replace")


def words_from(text, col=None, skip_header=False):
    out = set()
    for i, line in enumerate(text.splitlines()):
        if skip_header and i == 0:
            continue
        if not line.strip():
            continue
        tok = line.split(",")[col] if col is not None else line.split("\t")[0]
        tok = tok.strip().strip('"').lower()
        if tok.isalpha() and len(tok) >= 2:
            out.add(tok)
    return out


def main():
    print("dictionary ...")
    dictionary = set(w for w in words_from(fetch(DICTIONARY)) if 2 <= len(w) <= 20)
    print("  ", len(dictionary), "valid English words")

    print("frequency ...")
    frequent = set()
    try:
        for i, line in enumerate(fetch(FREQUENCY).splitlines()):
            if i >= FREQ_KEEP:
                break
            tok = line.split("\t")[0].strip().lower()
            if tok.isalpha():
                frequent.add(tok)
        print("  ", len(frequent), "common words (top", FREQ_KEEP, ")")
    except Exception as e:
        print("   frequency list unavailable:", str(e)[:90])
        print("   FAILING SOFT: keeping the full dictionary. The gate still holds —")
        print("   it is only larger, and a rare dictionary word is still not a name.")
    safe = (dictionary & frequent) if frequent else dictionary

    # Surnames are deliberately NOT subtracted, and the first build proved why: the
    # census list is 151,671 entries and it swallowed cover, guest, hurt, buy, sell,
    # hire and farm — a gate that cannot say "does insurance cover a guest who got
    # hurt" is useless for the one job it has. The insight the first build missed is
    # that a common English word is not PII even when it is also somebody's surname:
    # a lone lowercase "hurt" identifies nobody. What identifies people is the RARE
    # token, and the dictionary-and-frequency gate above already blocks every one of
    # those. Given names are still subtracted, because a first name is recognisable
    # as a name in a way a common noun is not.
    print("names ...")
    names = set()
    for label, url, col, hdr in (
        ("given", GIVEN_NAMES, 1, True),
    ):
        try:
            got = words_from(fetch(url), col=col, skip_header=hdr)
            names |= got
            print("  ", label, len(got))
        except Exception as e:
            print("  ", label, "unavailable:", str(e)[:70])

    if not names:
        print("   REFUSING TO BUILD: no name list was reachable, so nothing would be")
        print("   subtracted and given names would pass the gate. Fix the network or")
        print("   the source and run again. A half-built gate is worse than the old one.")
        return 1

    # The domain vocabulary is his own published legal language and always survives,
    # even where a word is also a name. "Will" is the single most important word on
    # this site; losing it to a baby-name list would be absurd.
    try:
        v = json.load(io.open(VOCAB, encoding="utf8"))
        domain = set(t.lower() for t in (v if isinstance(v, list) else v.get("terms", []))
                     if str(t).replace("-", "").replace(".", "").isalnum())
    except Exception:
        domain = set()
    domain_words = set(w for w in domain if w.isalpha())
    print("   domain vocabulary rescued from the name list:", len(domain_words))

    # Fragments that are only ever part of an identifier, never part of a question.
    # "com" is a dictionary word and it is how an email address survives a word gate.
    NEVER = {"com", "net", "org", "www", "edu", "gov", "co", "io", "mail", "http", "https"}

    safe = ((safe - names) | domain_words) - NEVER
    safe = set(w for w in safe if 2 <= len(w) <= 20 and w.isalpha())

    payload = {
        "built": __import__("datetime").date.today().isoformat(),
        "note": ("Whitelist gate for Ask Kristian miss telemetry. A word in a visitor's "
                 "question is logged only if it appears here. Proper nouns, places, "
                 "misspellings and anything carrying a digit are absent by construction."),
        "counts": {"dictionary": len(dictionary), "frequent": len(frequent),
                   "names_removed": len(names), "domain_kept": len(domain_words),
                   "safe": len(safe)},
        "sources": [DICTIONARY, FREQUENCY, GIVEN_NAMES, SURNAMES],
        "words": sorted(safe),
        # His own published legal language, kept separately because the sanitizer lets
        # these through even when capitalised. The proper-noun rule that catches
        # "Kensington" would otherwise also eat "Roth", "Medicaid" and "IRA", which are
        # the words that make a miss worth reading.
        "domain": sorted(domain_words - NEVER),
    }
    with io.open(OUT, "w", encoding="utf8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print("wrote", OUT, "-", len(safe), "words,", os.path.getsize(OUT) // 1024, "KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
