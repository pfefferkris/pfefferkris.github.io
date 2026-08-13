#!/usr/bin/env python3
"""Fold every published newsletter issue into the library Ask Kristian reads from.

The newsletter is the part of this site that grows. A couple of issues a week, each one
a worked position on a live question, and until now none of it reached the thing people
actually ask. Ask Kristian answered from seven hand written explainers and had never
read a single issue. Someone could ask about the Section 68 rewrite the morning after
an issue explained it and get told the library does not cover that.

So the posts become library documents. Same shape as the explainers, same retrieval,
same citation rules, built from the posts themselves so there is one source of truth
and nothing to keep in sync by hand.

  python scripts/build_corpus.py [--check]

Reads  _posts/*.md
Writes data/corpus.json

Hand written explainers in data/corpus.json are preserved exactly. Only documents whose
id begins with "nl-" are owned by this script, so a rebuild can never eat work that was
authored rather than generated. --check exits nonzero if the file would change, which is
what lets the workflow decide whether there is anything to commit.

The brain reads the same file. data/corpus.json is served publicly, so the household
Cerebellum pulls it over HTTP on its night pass and files one durable fact per issue.
One library, two readers, no second copy to drift.
"""
import json, os, re, sys, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
POSTS = ROOT / "_posts"
OUT = ROOT / "data" / "corpus.json"
SITE = "https://kpfeffer.com"

# The newsletter comments on published law. It is not advice about anybody's trust, and
# the boundary is the same for every issue, so it is stated once rather than invented
# per post. An honest fixed line beats a fabricated bespoke one.
STOPS = ("Whether any of this applies to a particular trust, estate or family, what a specific "
         "instrument actually says, and what any named person should do about it. This is a "
         "published essay working through a question in public, not advice on a live matter. "
         "A trust in administration needs its own counsel and often its own CPA.")

# The persona chips a visitor can set in the guide. Matched on whole words, because
# substrings lie: "heir" hides inside "their", "ssi" inside "passive", and a chip that
# matches every issue ranks nothing. A chip is claimed only when the issue really speaks
# to that situation.
CHIPS = {
    "married": ("spouse", "spouses", "surviving spouse", "marital deduction", "widow",
                "widower", "husband", "wife", "portability", "qtip", "marital trust"),
    "kids": ("child", "children", "son", "daughter", "descendant", "descendants",
             "remaindermen", "remainderman", "heirs", "grandchild", "grandchildren",
             "her children", "his children"),
    "blended": ("second marriage", "stepmother", "stepfather", "stepchild", "stepchildren",
                "blended family", "first marriage"),
    "minor": ("minor", "minors", "custodian", "ugma", "utma", "under 18", "guardian"),
    "sn": ("special needs", "supplemental needs", "medicaid", "ssi", "disabled",
           "supplemental security", "means tested"),
    "biz": ("closely held", "s corporation", "shareholder", "shareholders", "qsbs",
            "buy sell", "founder", "founders", "small business", "family business"),
}

# The thirteen domain outline the explainers are keyed to. Scored rather than first match,
# so an issue lands where most of its vocabulary points instead of wherever the list
# happened to check first.
DOMAINS = {
    "1": ("deed", "titling", "title", "basis", "step up", "joint tenancy",
          "tenancy by the entirety", "survivorship"),
    "2": ("intestacy", "intestate", "spousal share", "elective share"),
    "3": ("probate", "clerk of court", "estate administration", "executor",
          "personal representative", "letters testamentary"),
    "4": ("trustee", "trustees", "trust administration", "breach", "accounting",
          "duty of loyalty", "surcharge", "removal", "fiduciary duty", "prudent",
          "beneficiary", "beneficiaries", "self dealing", "bad faith"),
    "5": ("investment", "portfolio", "dividend", "alpha", "beta", "asset allocation",
          "prudent investor", "yield", "return", "market", "equity", "diversification"),
    "7": ("retirement", "401", "ira", "iras", "required minimum distribution",
          "secure act", "erisa", "rollover", "life expectancy", "social security"),
    "8": ("fiduciary income", "subchapter j", "distributable net income", "1041",
          "grantor trust", "nongrantor", "itemized deduction", "conduit",
          "distribution deduction", "bracket compression"),
    "9": ("estate tax", "gift tax", "exclusion", "portability", "marital deduction",
          "706", "709", "taxable gift", "qtip", "unified credit", "bluebook"),
    "10": ("generation skipping", "gst", "dynasty", "grat", "ilit", "freeze",
           "7520", "valuation discount", "tax alpha"),
    "11": ("charitable", "crat", "crut", "remainder trust", "donor advised",
           "philanthropy", "listed transaction"),
    "13": ("special needs", "supplemental needs", "ssi", "medicaid", "means tested",
           "public benefits"),
}


def _wordset(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _has_phrase(low, words, phrase):
    """Whole word match for a single token, plain containment for a real phrase."""
    if " " in phrase:
        return phrase in low
    return phrase in words


# Citations, URL first. The links in these posts ARE the citation: a post that links to
# law.cornell.edu/uscode/text/26/641 is telling us the section and the code it belongs to,
# which bare prose cannot. This matters more than it sounds. Reading "Section 36C" out of
# an NC trust post as an Internal Revenue Code section, or California Probate Code 859 as
# IRC 859, is exactly the confidently wrong citation the figure law exists to prevent.
URL_RULES = [
    (r"law\.cornell\.edu/uscode/text/26/([0-9A-Za-z.\-]+)", lambda m: "IRC Section " + m.group(1)),
    (r"law\.cornell\.edu/uscode/text/(?!26/)(\d+)/([0-9A-Za-z.\-]+)", lambda m: m.group(1) + " U.S.C. " + m.group(2)),
    (r"law\.cornell\.edu/cfr/text/(\d+)/([0-9A-Za-z.\-]+)", lambda m: m.group(1) + " CFR " + m.group(2)),
    (r"ncleg\.gov/[^\s)]*GS_([0-9A-Za-z\-.]+?)\.html", lambda m: "NCGS " + m.group(1)),
    (r"ncleg\.gov/[^\s)]*Chapter_([0-9A-Za-z]+)(?![^\s)]*GS_)", lambda m: "NCGS Chapter " + m.group(1)),
    (r"lawCode=PROB&sectionNum=([0-9.]+?)\.?(?=[\s)&]|$)", lambda m: "California Probate Code " + m.group(1)),
    (r"lawCode=(?!PROB)([A-Z]+)&sectionNum=([0-9.]+?)\.?(?=[\s)&]|$)", lambda m: "California " + m.group(1) + " Code " + m.group(2)),
    (r"irs\.gov/pub/irs-pdf/f([0-9a-z\-]+)\.pdf", lambda m: "IRS Form " + m.group(1).upper()),
    (r"ecfr\.gov/[^\s)]*title-(\d+)[^\s)]*part-(\d+)", lambda m: m.group(1) + " CFR part " + m.group(2)),
    (r"tc-memo-(\d{4})-(\d+)", lambda m: "T.C. Memo. " + m.group(1) + "-" + m.group(2)),
]

# Prose citations, and only the ones that name their own body of law. A bare "Section 68"
# is deliberately NOT here: without a prefix or a link there is nothing that says which
# code it belongs to, and guessing is how a citation becomes a lie.
TEXT_RULES = [
    (r"\bIRC\s*(?:Section\s+|§\s*)?(\d{1,4}[A-Za-z]?(?:\([a-z0-9]+\))?)", lambda m: "IRC Section " + m.group(1)),
    # The section symbol carries no code of its own, so it only counts when the Internal
    # Revenue Code is named in the same breath.
    (r"Internal Revenue Code[^.]{0,90}?§\s*(\d{1,4}[A-Za-z]?(?:\([a-z0-9]+\))?)", lambda m: "IRC Section " + m.group(1)),
    (r"\bInternal Revenue Code\s+[Ss]ection\s+(\d{1,4}[A-Za-z]?(?:\([a-z0-9]+\))?)", lambda m: "IRC Section " + m.group(1)),
    (r"\bSection\s+(\d{1,4}[A-Za-z]?(?:\([a-z0-9]+\))?)\s+of the Internal Revenue Code", lambda m: "IRC Section " + m.group(1)),
    (r"\bNCGS\s+(\d{1,3}[A-Za-z]?-\d{1,4}(?:[-.]\d+)*)", lambda m: "NCGS " + m.group(1)),
    (r"\bN\.?C\.?\s+Gen\.?\s+Stat\.?\s+(?:\u00a7\s*)?(\d{1,3}[A-Za-z]?-\d{1,4}(?:[-.]\d+)*)", lambda m: "NCGS " + m.group(1)),
    (r"\bChapter\s+(\d{1,3}[A-Z]?)\s+of the North Carolina General Statutes", lambda m: "NCGS Chapter " + m.group(1)),
    (r"\b(?:Public Law|P\.?L\.?)\s+(\d{2,3}-\d{1,3})", lambda m: "Public Law " + m.group(1)),
    (r"\bTreas(?:ury)?\.?\s+Reg(?:ulation)?s?\.?\s+(?:\u00a7\s*)?([\d.\-]+?)\.?(?=[\s,;)]|$)", lambda m: "Treasury Regulation " + m.group(1)),
    (r"\bRev(?:enue)?\.?\s+(Rul|Proc)(?:\.|edure|ing)?\s+(\d{2,4}-\d{1,3})",
     lambda m: ("Revenue Ruling " if m.group(1).lower() == "rul" else "Revenue Procedure ") + m.group(2)),
    (r"\bNotice\s+(\d{4}-\d{1,3})", lambda m: "IRS Notice " + m.group(1)),
    (r"\bAOC-E-(\d{3})", lambda m: "AOC-E-" + m.group(1)),
    (r"\bUniform\s+((?:[A-Z][a-z]+\s+){1,3}Act)", lambda m: "Uniform " + m.group(1).strip()),
    (r"\bCalifornia Probate Code\s+(?:[Ss]ection\s+)?(\d{2,4})", lambda m: "California Probate Code " + m.group(1)),
]

# "Form 4547" is not a thing. Only forms a fiduciary practice actually files get through.
REAL_FORMS = {"706", "706-NA", "709", "712", "990", "990-PF", "1040", "1041", "1041-A",
              "1099", "1099-R", "3520", "3520-A", "4768", "5227", "5500", "8938", "8939",
              "8971", "W-2", "W-9", "SS-4"}
FORM_RE = re.compile(r"\bForm\s+([0-9]{2,4}(?:-[A-Z]{1,3})?|W-[29]|SS-4)\b")

# A case name: capitalized parties around a v. The leading word is often the sentence
# connective that happened to sit in front of it, so it gets peeled off.
CASE_RE = re.compile(r"\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,2})\s+v\.\s+([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,2})")
LEAD_WORDS = {"in", "see", "but", "and", "so", "then", "when", "because", "under",
              "after", "before", "here", "the", "that", "both", "like", "compare", "cf"}
NOT_PARTIES = {"trust", "trusts", "estate", "estates", "court", "act", "code", "section",
               "chapter", "state", "united", "internal"}

FRONT_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)


def front_matter(text):
    m = FRONT_RE.match(text)
    if not m:
        return {}, text
    fm, body = {}, text[m.end():]
    for line in m.group(1).splitlines():
        k = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if not k:
            continue
        v = k.group(2).strip()
        if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        fm[k.group(1)] = v
    return fm, body


def flatten_links(md):
    """[text](url) becomes text (url). The answering model must be able to name where a
    rule came from, and a bare markdown link hides the source behind the anchor text."""
    return re.sub(r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", r"\1 (\2)", md)


def authorities(text):
    """Citations this post actually made, named by the body of law they belong to."""
    seen, out = [], []

    def add(v):
        k = re.sub(r"[^a-z0-9]", "", v.lower())
        if k and k not in seen:
            seen.append(k)
            out.append(v)

    for pat, fmt in URL_RULES:
        for m in re.finditer(pat, text):
            try:
                add(fmt(m))
            except Exception:
                pass
    for pat, fmt in TEXT_RULES:
        for m in re.finditer(pat, text):
            try:
                add(fmt(m))
            except Exception:
                pass
    for m in FORM_RE.finditer(text):
        if m.group(1).upper() in REAL_FORMS:
            add("Form " + m.group(1).upper())

    cases = []
    for m in CASE_RE.finditer(text):
        a = m.group(1).strip().split()
        while a and a[0].lower() in LEAD_WORDS:
            a = a[1:]
        b = m.group(2).strip()
        if not a or a[-1].lower() in NOT_PARTIES or b.lower() in NOT_PARTIES:
            continue
        cases.append(" ".join(a) + " v. " + b)
    # Prefer the longest rendering of a case that appears more than one way.
    for c in sorted(set(cases), key=len, reverse=True):
        if not any(c != d and c in d for d in cases):
            add(c)
    return out[:12]


def chips_for(text):
    low = text.lower()
    words = _wordset(text)
    return [c for c, phrases in CHIPS.items()
            if sum(1 for p in phrases if _has_phrase(low, words, p)) >= 1]


def domain_for(text):
    low = text.lower()
    words = _wordset(text)
    best, score = "newsletter", 0
    for dom, phrases in DOMAINS.items():
        n = sum(1 for p in phrases if _has_phrase(low, words, p))
        if n > score:
            best, score = dom, n
    return best if score >= 2 else "newsletter"


def build_issue(path):
    raw = path.read_text(encoding="utf-8")
    fm, body = front_matter(raw)
    name = path.stem
    m = re.match(r"^(\d{4}-\d{2}-\d{2})-(.+)$", name)
    if not m:
        return None
    date, slug = m.group(1), m.group(2)
    title = fm.get("title") or slug.replace("-", " ")
    body = flatten_links(body).strip()
    headings = [h.strip() for h in re.findall(r"^\s{0,3}#{2,3}\s+(.+?)\s*$", body, re.M)]
    hay = title + "\n" + (fm.get("description") or "") + "\n" + body
    return {
        "id": "nl-" + slug,
        "domain": domain_for(hay),
        "title": title,
        "chips": chips_for(hay),
        "authority": authorities(hay),
        "where_this_stops": STOPS,
        "headings": headings,
        "body": "# " + title + "\n\n" + body,
        "words": len(re.findall(r"[A-Za-z0-9']+", body)),
        # Provenance, so an answer can say when this was written and point at the issue.
        "kind": "newsletter",
        "date": date,
        "url": SITE + "/newsletter/" + slug + "/",
        "summary": fm.get("description") or "",
    }


def main():
    check = "--check" in sys.argv
    try:
        existing = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        existing = {"docs": []}
    # Everything not generated is authored, and authored work is never touched here.
    kept = [d for d in existing.get("docs", []) if not str(d.get("id", "")).startswith("nl-")]

    issues = []
    for p in sorted(POSTS.glob("*.md")):
        try:
            doc = build_issue(p)
        except Exception as e:
            print("skip " + p.name + ": " + str(e), file=sys.stderr)
            continue
        if doc:
            issues.append(doc)
    # Newest first, so a reader scanning the file sees the current position first.
    issues.sort(key=lambda d: d["date"], reverse=True)

    docs = kept + issues
    out = {"built": datetime.date.today().isoformat(), "count": len(docs),
           "explainers": len(kept), "issues": len(issues), "docs": docs}

    prior_docs = json.dumps(existing.get("docs", []), sort_keys=True)
    if prior_docs == json.dumps(docs, sort_keys=True):
        print("no change: " + str(len(kept)) + " explainers, " + str(len(issues)) + " issues")
        return 0
    if check:
        print("would change")
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print("wrote " + str(OUT) + ": " + str(len(kept)) + " explainers + " + str(len(issues)) + " issues")
    for d in issues[:3]:
        print("  newest: " + d["date"] + " " + d["title"] + "  [" + ", ".join(d["authority"][:4]) + "]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
