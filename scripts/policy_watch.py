#!/usr/bin/env python3
"""Watch the primary sources for changes to the law this site explains.

This is the connector layer for RULES, the way update_rates.py is the connector layer
for FIGURES. It exists because the site's credibility rests on being current, and the
failure mode is silent: a regulation changes, nothing on the page moves, and the first
person to notice is a reader who knows more than the page does.

Two sources, both authoritative, both free, neither needing an account:

  Federal Register API  — every Rule, Proposed Rule and Notice the IRS and Treasury
                          publish, filtered to the subjects this library covers.
  eCFR versioner API    — the last amendment date of each regulation part that matters,
                          so a quiet technical amendment still shows up as a changed date.

A news reader would give softer coverage of the same ground: someone else's summary,
days later, mixed with commentary. This reads the register itself.

Writes data/policy-watch.json. Fails soft, one source at a time, exactly like the
rates updater: an unreachable endpoint keeps the previous answer rather than blanking it.
"""
import json, re, sys, urllib.request, urllib.parse, datetime, pathlib

UA = {"User-Agent": "Mozilla/5.0 (policy watcher for kpfeffer.com; contact mail@kpfeffer.com)"}
OUT = pathlib.Path("data/policy-watch.json")
LOOKBACK_DAYS = 400

# The parts of the Code of Federal Regulations this library actually rests on.
# A changed amendment date here is a signal to re-read an explainer.
CFR_PARTS = [
    ("26", "20", "Federal estate tax regulations"),
    ("26", "25", "Federal gift tax regulations"),
    ("26", "26", "Generation-skipping transfer tax regulations"),
    ("20", "416", "Supplemental Security Income (drives the special needs trust rules)"),
]

# Subject terms, each run as its own query so one noisy term cannot crowd out the rest.
TERMS = [
    "estate tax", "gift tax", "generation-skipping", "grantor trust",
    "basis consistency", "portability election", "fiduciary income tax",
    "required minimum distribution", "special needs trust",
]

# A document only counts if one of these appears in its title or abstract. The API's
# term search reads the whole document, which is how a stablecoin rule matches "estate tax".
SUBJECT_WORDS = (
    "estate tax", "gift tax", "generation-skipping", "generation skipping",
    "trust", "trusts", "fiduciary", "decedent", "bequest", "inherit",
    "basis consistency", "portability", "qdot", "qtip", "grantor",
    "required minimum distribution", "beneficiary", "supplemental security",
    "charitable remainder", "annuity trust", "unitrust", "life insurance",
)

AGENCIES = ["internal-revenue-service", "treasury-department"]
# Notices are mostly paperwork burden statements; rules are what actually change the law.
DOC_TYPES = ["RULE", "PRORULE"]


def get(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8", "ignore")


def load_existing():
    try:
        return json.loads(OUT.read_text())
    except Exception:
        return {}


def fetch_federal_register(existing):
    """Rules and proposed rules from IRS and Treasury on the subjects this site covers."""
    try:
        since = (datetime.date.today() - datetime.timedelta(days=LOOKBACK_DAYS)).isoformat()
        seen, items = set(), []
        for term in TERMS:
            q = [("per_page", "20"), ("order", "newest"),
                 ("conditions[term]", term),
                 ("conditions[publication_date][gte]", since)]
            for f in ("document_number", "publication_date", "type", "title", "abstract", "html_url"):
                q.append(("fields[]", f))
            for a in AGENCIES:
                q.append(("conditions[agencies][]", a))
            for t in DOC_TYPES:
                q.append(("conditions[type][]", t))
            url = "https://www.federalregister.gov/api/v1/documents.json?" + urllib.parse.urlencode(q)
            try:
                data = json.loads(get(url))
            except Exception as e:
                print(f"  term '{term}' failed: {e}", file=sys.stderr)
                continue
            for r in data.get("results", []):
                num = r.get("document_number")
                if not num or num in seen:
                    continue
                # The API searches full text, so a stablecoin rule can match "estate tax"
                # on a stray cross reference. A watchlist full of those is a watchlist
                # nobody reads, so relevance is judged on the title and abstract only.
                head = ((r.get("title") or "") + " " + (r.get("abstract") or "")).lower()
                if not any(k in head for k in SUBJECT_WORDS):
                    continue
                seen.add(num)
                items.append({
                    "date": r.get("publication_date"),
                    "type": r.get("type"),
                    "title": (r.get("title") or "")[:220],
                    "url": r.get("html_url"),
                    "matched": term,
                })
        if not items:
            # A genuinely quiet year is possible; only keep the old list if the API broke.
            raise ValueError("no documents returned from any term")
        items.sort(key=lambda x: x["date"] or "", reverse=True)
        return {"federalRegister": items[:40],
                "federalRegisterChecked": datetime.date.today().isoformat(),
                "federalRegisterSource": "Federal Register API, IRS and Treasury rules and proposed rules"}
    except Exception as e:
        print(f"federal register fetch failed, keeping existing: {e}", file=sys.stderr)
        return {k: existing[k] for k in ("federalRegister", "federalRegisterChecked", "federalRegisterSource")
                if k in existing}


def fetch_ecfr(existing):
    """Last amendment date per regulation part. A quiet technical change still moves this."""
    try:
        out = []
        for title, part, label in CFR_PARTS:
            url = f"https://www.ecfr.gov/api/versioner/v1/versions/title-{title}.json?part={part}"
            try:
                meta = json.loads(get(url)).get("meta", {})
                out.append({"cfr": f"{title} CFR part {part}", "what": label,
                            "lastAmended": meta.get("latest_amendment_date"),
                            "issueDate": meta.get("latest_issue_date")})
            except Exception as e:
                print(f"  {title} CFR {part} failed: {e}", file=sys.stderr)
        if not out:
            raise ValueError("no CFR parts resolved")
        return {"cfrParts": out,
                "cfrChecked": datetime.date.today().isoformat(),
                "cfrSource": "eCFR versioner API"}
    except Exception as e:
        print(f"ecfr fetch failed, keeping existing: {e}", file=sys.stderr)
        return {k: existing[k] for k in ("cfrParts", "cfrChecked", "cfrSource") if k in existing}


def diff_note(old, new):
    """What actually changed since the last run, so a human reads three lines not forty."""
    notes = []
    old_docs = {d.get("url") for d in (old.get("federalRegister") or [])}
    fresh = [d for d in (new.get("federalRegister") or []) if d.get("url") not in old_docs]
    for d in fresh[:12]:
        notes.append(f"NEW {d['type']} {d['date']}: {d['title']}")
    old_cfr = {c.get("cfr"): c.get("lastAmended") for c in (old.get("cfrParts") or [])}
    for c in (new.get("cfrParts") or []):
        was = old_cfr.get(c["cfr"])
        if was and was != c.get("lastAmended"):
            notes.append(f"AMENDED {c['cfr']} ({c['what']}): {was} -> {c['lastAmended']}")
    return notes


def main():
    existing = load_existing()
    data = dict(existing)
    data.update(fetch_federal_register(existing))
    data.update(fetch_ecfr(existing))
    data["changes"] = diff_note(existing, data)
    data["updated"] = datetime.date.today().isoformat()

    comparable = {k: v for k, v in data.items() if k not in ("updated", "changes",
                                                             "federalRegisterChecked", "cfrChecked")}
    prior = {k: v for k, v in existing.items() if k not in ("updated", "changes",
                                                            "federalRegisterChecked", "cfrChecked")}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    if comparable == prior:
        print("no substantive change")
    else:
        print("CHANGES:")
        for n in data["changes"] or ["(first run, baseline recorded)"]:
            print("  " + n)


if __name__ == "__main__":
    main()
