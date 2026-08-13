#!/usr/bin/env python3
"""Refresh data/rates.json from public sources. Runs inside GitHub Actions, no PC required.
Sources: IRS Section 7520 page, U.S. Treasury daily par yield curve XML, Yahoo Finance S&P 500 chart.
Fails soft: if a source cannot be parsed, the existing value is kept."""
import json
import pathlib, re, sys, urllib.request, datetime

UA = {"User-Agent": "Mozilla/5.0 (rates updater for kpfeffer.com; contact mail@kpfeffer.com)"}
OUT = pathlib.Path("data/rates.json")

def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")

def load_existing():
    try:
        return json.loads(OUT.read_text())
    except Exception:
        return {}

def keep(existing, keys):
    return {k: existing[k] for k in keys if k in existing}

def fetch_7520(existing):
    """IRS row format: Month Year | 120 percent midterm | 7520 rate | Rev Rul. Take the SECOND number.
    A 7520 rate is 120 percent of the midterm AFR rounded to the nearest 0.2, so valid values are even tenths."""
    try:
        html = get("https://www.irs.gov/businesses/small-businesses-self-employed/section-7520-interest-rates")
        text = re.sub(r"<[^>]+>", " ", html)
        months = "January|February|March|April|May|June|July|August|September|October|November|December"
        rows = re.findall(r"(" + months + r")\s+(20\d\d)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)", text)
        rows = [r for r in rows if float(r[3]) * 5 == int(float(r[3]) * 5) and 0 < float(r[3]) < 20]
        if not rows:
            raise ValueError("no valid 7520 shaped rates found")
        order = ("January","February","March","April","May","June","July","August","September","October","November","December")
        rows.sort(key=lambda r: (int(r[1]), order.index(r[0])))
        m, y, _midterm, rate = rows[-1]
        return {"rate7520": float(rate), "rate7520Month": f"{m} {y}", "rate7520Source": "IRS Section 7520 interest rates page"}
    except Exception as e:
        print(f"7520 fetch failed, keeping existing: {e}", file=sys.stderr)
        return keep(existing, ("rate7520","rate7520Month","rate7520Source"))

def fetch_tenyear(existing):
    try:
        ym = datetime.date.today().strftime("%Y%m")
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
               f"?data=daily_treasury_yield_curve&field_tdr_date_value_month={ym}")
        xml = get(url)
        dates = re.findall(r"<d:NEW_DATE[^>]*>([\d\-T:]+)</d:NEW_DATE>", xml)
        tens = re.findall(r"<d:BC_10YEAR[^>]*>([0-9.]+)</d:BC_10YEAR>", xml)
        if not tens:
            prior = (datetime.date.today().replace(day=1) - datetime.timedelta(days=1)).strftime("%Y%m")
            xml = get(url.replace(ym, prior))
            dates = re.findall(r"<d:NEW_DATE[^>]*>([\d\-T:]+)</d:NEW_DATE>", xml)
            tens = re.findall(r"<d:BC_10YEAR[^>]*>([0-9.]+)</d:BC_10YEAR>", xml)
        if not tens:
            raise ValueError("no 10 year entries found")
        d = datetime.datetime.fromisoformat(dates[-1].split("T")[0]).strftime("%B %d, %Y").replace(" 0", " ")
        return {"tenYear": float(tens[-1]), "tenYearDate": d, "tenYearSource": "U.S. Treasury daily par yield curve"}
    except Exception as e:
        print(f"Treasury fetch failed, keeping existing: {e}", file=sys.stderr)
        return keep(existing, ("tenYear","tenYearDate","tenYearSource"))

def fetch_sp500(existing):
    """Benchmark: S&P 500 level and trailing 12 month return, Yahoo Finance chart JSON, no key."""
    try:
        data = json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1y&interval=1mo"))
        res = data["chart"]["result"][0]
        closes = [c for c in res["indicators"]["quote"][0]["close"] if c]
        level = res["meta"].get("regularMarketPrice") or closes[-1]
        if len(closes) < 12:
            raise ValueError("not enough monthly closes")
        ret = round((level / closes[0] - 1) * 100, 1)
        ts = res["meta"].get("regularMarketTime")
        d = datetime.datetime.fromtimestamp(ts).strftime("%B %d, %Y").replace(" 0", " ") if ts else datetime.date.today().strftime("%B %d, %Y")
        return {"sp500": round(float(level), 2), "sp500Date": d, "sp500Return1y": ret,
                "benchmark": "S&P 500", "benchmarkSource": "Yahoo Finance chart data"}
    except Exception as e:
        print(f"sp500 fetch failed, keeping existing: {e}", file=sys.stderr)
        return keep(existing, ("sp500","sp500Date","sp500Return1y","benchmark","benchmarkSource"))

def fetch_sp500_longrun(existing):
    """The long run stock return, computed rather than remembered.

    The comparison line on the equity page used to be a hardcoded ten percent, described
    in the code as a teaching constant, which is exactly the shape of thing the figure law
    exists to stop: a number typed once, carried forever, and never dated. So it is
    computed here from the index itself over its whole available history, the same way the
    house price rate is.

    It is a PRICE return. Dividends are not in an index level, so this understates what an
    investor holding the index actually earned, and the page says so rather than quietly
    grossing it up. A floor a reader can check beats a total anyone could have made up.
    """
    try:
        data = json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/"
                              "%5EGSPC?range=max&interval=1mo"))
        res = data["chart"]["result"][0]
        stamps = res["timestamp"]
        closes = res["indicators"]["quote"][0]["close"]
        pts = [(t, c) for t, c in zip(stamps, closes) if c]
        if len(pts) < 100:
            raise ValueError("not enough history for a long run rate")
        t0, c0 = pts[0]
        t1, c1 = pts[-1]
        years = (t1 - t0) / (365.2425 * 86400)
        if years < 30 or c0 <= 0:
            raise ValueError("span too short")
        cagr = ((c1 / c0) ** (1.0 / years) - 1) * 100
        if not (2 < cagr < 20):
            raise ValueError("long run rate implausible: %.2f" % cagr)
        return {"sp500LongRun": round(cagr, 1),
                "sp500LongRunYears": int(round(years)),
                "sp500LongRunFrom": datetime.date.fromtimestamp(t0).strftime("%B %Y"),
                "sp500LongRunBasis": ("price return only; dividends are not in an index "
                                      "level, so a total return investor earned more"),
                "sp500LongRunSource": "S&P 500 index history, Yahoo Finance chart data"}
    except Exception as e:
        print(f"sp500 long run fetch failed, keeping existing: {e}", file=sys.stderr)
        return keep(existing, ("sp500LongRun", "sp500LongRunYears", "sp500LongRunFrom",
                               "sp500LongRunBasis", "sp500LongRunSource"))

def fetch_transfer_tax(existing):
    """Federal transfer tax figures straight from the IRS gift tax FAQ.

    These move once a year, in the autumn Revenue Procedure, but a stale one is the
    most damaging error this site can make. Quoting last year's exclusion is how a
    reader works out that nobody is minding the page, and on a page about money that
    costs more than being silent would have. Ask Kristian reads these and is forbidden
    from stating any figure it did not get from here or from a sourced explainer."""
    keys = ("giftAnnualExclusion", "giftAnnualExclusionYear", "basicExclusion",
            "basicExclusionYear", "basicExclusionBasis", "transferTaxSource",
            "transferTaxChecked")
    try:
        flat = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", get(
            "https://www.irs.gov/businesses/small-businesses-self-employed/"
            "frequently-asked-questions-on-gift-taxes")))
        now = datetime.date.today().year

        # The IRS publishes a year to amount table: "2025 $19,000 2026 $19,000"
        pairs = [(int(y), int(a.replace("$", "").replace(",", ""))) for y, a in
                 re.findall(r"(20[0-9]{2})(?:\s*through\s*20[0-9]{2})?\s*(\$[0-9]{2},000)\b", flat)]
        pairs = [p for p in pairs if 10000 <= p[1] <= 100000]
        usable = [p for p in pairs if p[0] <= now] or pairs
        if not usable:
            raise ValueError("no annual exclusion rows found")
        ye, ae = max(usable, key=lambda p: p[0])

        bx = re.findall(r"basic exclusion amount to \$([0-9,]{7,14}) for gifts for calendar year (20[0-9]{2})", flat)
        if bx:
            be, yb = int(bx[-1][0].replace(",", "")), int(bx[-1][1])
        else:
            cands = [int(x.replace("$", "").replace(",", "")) for x in re.findall(r"\$[0-9]{1,2},[0-9]{3},000\b", flat)]
            cands = [c for c in cands if 5000000 <= c <= 50000000]
            if not cands:
                raise ValueError("no basic exclusion found")
            be, yb = max(cands), now
        if not 5000000 <= be <= 50000000:
            raise ValueError(f"basic exclusion out of plausible range: {be}")

        # The story around a figure goes stale the same way the figure does. A model
        # trained before July 2025 still believes the exclusion sunsets, because for
        # years it did. Capture what actually set it so the narrative travels with it.
        basis = ""
        if re.search(r"Public Law 119-21", flat):
            basis = ("Set by Public Law 119-21, signed 4 July 2025, amending IRC 2010(c)(3). "
                     "This replaced the earlier scheduled sunset, so it does NOT drop back at the "
                     "end of 2025. Do not repeat the old sunset story.")

        return {"giftAnnualExclusion": ae, "giftAnnualExclusionYear": ye,
                "basicExclusion": be, "basicExclusionYear": yb,
                "basicExclusionBasis": basis,
                "transferTaxSource": "IRS frequently asked questions on gift taxes",
                "transferTaxChecked": datetime.date.today().isoformat()}
    except Exception as e:
        print(f"transfer tax fetch failed, keeping existing: {e}", file=sys.stderr)
        return keep(existing, keys)


def fetch_retirement_limits(existing):
    """The figures the retirement math actually runs on, from the two agencies that set them.

    These were hardcoded in the guide, which is the exact failure the figure law names: a
    page that states $24,500 with confidence and no idea what year it is. Worse, the
    replacement rate credited every reader with Social Security worth 40 percent of their
    final salary, with nothing capping it, so a reader projecting a million dollar final
    year was handed a Social Security benefit of nearly four hundred thousand a year. The
    taxable maximum is what makes that impossible, so the taxable maximum has to be here.

    Both sources are plain HTML tables and both are picky about being scraped, so each is
    tried on its own and a failure keeps the previous answer rather than blanking it.
    """
    out = {}
    # Social Security: the contribution and benefit base, which is the ceiling on covered
    # earnings and therefore the ceiling on what a benefit can ever be built from.
    try:
        text = re.sub(r"<[^>]+>", " ", get("https://www.ssa.gov/oact/cola/cbb.html"))
        text = re.sub(r"\s+", " ", text)
        rows = re.findall(r"\b(20[2-9]\d)\s+\$?([\d,]{6,12})", text)
        rows = [(int(y), int(v.replace(",", ""))) for y, v in rows]
        rows = [r for r in rows if 100000 < r[1] < 1000000]
        if not rows:
            raise ValueError("no contribution and benefit base found")
        year, base = max(rows, key=lambda r: r[0])
        out.update({"ssTaxableMax": base, "ssTaxableMaxYear": year,
                    "ssSource": "Social Security Administration, contribution and benefit base"})
    except Exception as e:
        print(f"ssa base fetch failed, keeping existing: {e}", file=sys.stderr)
        out.update(keep(existing, ("ssTaxableMax", "ssTaxableMaxYear", "ssSource")))

    # IRS: the elective deferral limit, and the compensation limit that caps a match.
    try:
        text = re.sub(r"<[^>]+>", " ", get("https://www.irs.gov/retirement-plans/plan-participant-employee/"
                                           "retirement-topics-401k-and-profit-sharing-plan-contribution-limits"))
        text = re.sub(r"\s+", " ", text)
        yr = None
        m = re.search(r"\$([\d,]{5,9})\s+in\s+(20\d\d)", text)
        if m:
            out["deferral402g"] = int(m.group(1).replace(",", ""))
            yr = int(m.group(2))
        c = re.search(r"limited to \$([\d,]{5,9}) for (20\d\d)", text)
        if c:
            out["comp401a17"] = int(c.group(1).replace(",", ""))
            yr = yr or int(c.group(2))
        if not out.get("deferral402g") and not out.get("comp401a17"):
            raise ValueError("no retirement limits parsed")
        if yr:
            out["retirementLimitsYear"] = yr
        out["retirementLimitsSource"] = "IRS 401(k) and profit sharing plan contribution limits"
    except Exception as e:
        print(f"irs limits fetch failed, keeping existing: {e}", file=sys.stderr)
        out.update(keep(existing, ("deferral402g", "comp401a17", "retirementLimitsYear",
                                   "retirementLimitsSource")))

    # Plausibility, the same way the transfer tax figures are guarded. A parse that comes
    # back with something absurd is worse than one that fails, because it ships.
    if out.get("ssTaxableMax") and not (100000 < out["ssTaxableMax"] < 1000000):
        out.pop("ssTaxableMax", None)
    if out.get("deferral402g") and not (10000 < out["deferral402g"] < 100000):
        out.pop("deferral402g", None)
    if out.get("comp401a17") and not (100000 < out["comp401a17"] < 2000000):
        out.pop("comp401a17", None)
    out["retirementChecked"] = datetime.date.today().isoformat()
    return out


def write_pmms_history(csv_text):
    """The whole survey, every week since 1971, so a page can ask what a mortgage cost on
    the day a particular deed was recorded.

    A property page that asks an owner for their interest rate is asking the one number
    they are least likely to have to hand and most likely to guess. But the county knows
    the day the deed was recorded, and Freddie Mac knows what the market charged that
    week, and between the two the loan can be reconstructed instead of guessed. So the
    history is published alongside the current figure rather than thrown away after the
    last row is read.

    Stored as day offsets from the first week rather than date strings: same data, forty
    percent of the bytes, and the file is only fetched when somebody actually asks for a
    reconstruction.
    """
    weeks, r30, r15 = [], [], []
    for line in csv_text.splitlines():
        if not line or not line[0].isdigit():
            continue
        p = line.split(",")
        try:
            d = datetime.datetime.strptime(p[0].strip(), "%m/%d/%Y").date()
        except ValueError:
            continue
        a = p[1].strip()
        if not a:
            continue
        b = p[3].strip() if len(p) > 3 else ""
        weeks.append(d)
        r30.append(float(a))
        r15.append(float(b) if b else None)
    if len(weeks) < 500:
        raise ValueError("PMMS history too short to publish")
    base = weeks[0]
    doc = {
        "source": "Freddie Mac Primary Mortgage Market Survey, weekly history",
        "url": "https://www.freddiemac.com/pmms/docs/PMMS_history.csv",
        "note": "day is the number of days after base; rate30 and rate15 are percent",
        "base": base.isoformat(),
        "from": base.isoformat(),
        "to": weeks[-1].isoformat(),
        "n": len(weeks),
        "day": [(w - base).days for w in weeks],
        "rate30": r30,
        "rate15": r15,
    }
    path = pathlib.Path("data/pmms.json")
    path.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print("pmms history: %d weeks, %s to %s, %d bytes"
          % (len(weeks), doc["from"], doc["to"], path.stat().st_size), file=sys.stderr)

def fetch_mortgage(existing):
    """The two numbers a property page cannot be honest without: what a mortgage costs
    this week, and what houses have actually done.

    Freddie Mac's Primary Mortgage Market Survey is the rate every lender quote is
    measured against, and Freddie publishes the whole history as a CSV, so this is the
    primary source rather than somebody's summary of it. The FHFA House Price Index is
    the same idea for appreciation: a repeat sales index built from actual conforming
    transactions, which is the only kind of house price average that compares a house to
    itself instead of to a different house.

    Appreciation is the figure people guess worst. A page that assumes a number for it
    is a page that manufactures equity out of nothing, so the long run rate is computed
    here from the index itself, start to latest, and carries the span it was measured
    over so a reader can see it is fifty years and not a good decade.
    """
    out = {}
    try:
        csv_text = get("https://www.freddiemac.com/pmms/docs/PMMS_history.csv")
        rows = [r for r in csv_text.splitlines() if r and r[0].isdigit()]
        if not rows:
            raise ValueError("no PMMS rows")
        try:
            write_pmms_history(csv_text)
        except Exception as e:            # the history is a bonus; never lose the rate over it
            print("pmms history not written: %s" % e, file=sys.stderr)
        last = rows[-1].split(",")
        d = datetime.datetime.strptime(last[0].strip(), "%m/%d/%Y").date()
        r30 = float(last[1]) if last[1].strip() else None
        r15 = float(last[3]) if len(last) > 3 and last[3].strip() else None
        if not r30 or not (1 < r30 < 20):
            raise ValueError("30 year rate out of range")
        out.update({"mortgage30": r30,
                    "mortgageDate": d.strftime("%B %d, %Y").replace(" 0", " "),
                    "mortgageWeek": d.isoformat(),
                    "mortgageSource": "Freddie Mac Primary Mortgage Market Survey"})
        if r15 and 1 < r15 < 20:
            out["mortgage15"] = r15
    except Exception as e:
        print(f"PMMS fetch failed, keeping existing: {e}", file=sys.stderr)
        out.update(keep(existing, ("mortgage30", "mortgage15", "mortgageDate",
                                   "mortgageWeek", "mortgageSource")))

    try:
        pts = []
        for line in get("https://www.fhfa.gov/hpi/download/quarterly_datasets/"
                        "hpi_at_us_and_census.csv").splitlines():
            p = line.split(",")
            if len(p) >= 4 and p[0].strip() == "USA":
                try:
                    pts.append((int(p[1]), int(p[2]), float(p[3])))
                except ValueError:
                    continue
        pts.sort()
        if len(pts) < 8:
            raise ValueError("not enough FHFA quarters")
        first, last = pts[0], pts[-1]
        prior = next((p for p in reversed(pts) if (p[0], p[1]) == (last[0] - 1, last[1])), None)
        years = (last[0] - first[0]) + (last[1] - first[1]) / 4.0
        if years < 10 or first[2] <= 0:
            raise ValueError("FHFA span implausible")
        longrun = ((last[2] / first[2]) ** (1.0 / years) - 1) * 100
        if not (0 < longrun < 15):
            raise ValueError("FHFA long run rate implausible")
        out.update({"hpiLongRun": round(longrun, 1),
                    "hpiSpanYears": int(round(years)),
                    "hpiFrom": "%dQ%d" % (first[0], first[1]),
                    "hpiAsOf": "%dQ%d" % (last[0], last[1]),
                    "hpiSource": "FHFA House Price Index, purchase only, U.S. quarterly"})
        if prior and prior[2] > 0:
            out["hpi1y"] = round((last[2] / prior[2] - 1) * 100, 1)
    except Exception as e:
        print(f"FHFA fetch failed, keeping existing: {e}", file=sys.stderr)
        out.update(keep(existing, ("hpiLongRun", "hpiSpanYears", "hpiFrom", "hpiAsOf",
                                   "hpiSource", "hpi1y")))

    out["propertyChecked"] = datetime.date.today().isoformat()
    return out

def main():
    existing = load_existing()
    data = dict(existing)
    data.update(fetch_7520(existing))
    data.update(fetch_tenyear(existing))
    data.update(fetch_sp500(existing))
    data.update(fetch_sp500_longrun(existing))
    data.update(fetch_transfer_tax(existing))
    data.update(fetch_retirement_limits(existing))
    data.update(fetch_mortgage(existing))
    data["updated"] = datetime.date.today().isoformat()
    if {k: v for k, v in data.items() if k != "updated"} == {k: v for k, v in existing.items() if k != "updated"}:
        print("no change")
        return
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print("updated:", json.dumps(data))

if __name__ == "__main__":
    main()
