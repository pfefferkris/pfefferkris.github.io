#!/usr/bin/env python3
"""Refresh data/rates.json from public sources. Runs inside GitHub Actions, no PC required.
Sources: IRS Section 7520 page, U.S. Treasury daily par yield curve XML, Yahoo Finance S&P 500 chart.
Fails soft: if a source cannot be parsed, the existing value is kept."""
import json, re, sys, urllib.request, datetime, pathlib

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

def fetch_transfer_tax(existing):
    """Federal transfer tax figures straight from the IRS gift tax FAQ.

    These move once a year, in the autumn Revenue Procedure, but a stale one is the
    most damaging error this site can make. Quoting last year's exclusion is how a
    reader works out that nobody is minding the page, and on a page about money that
    costs more than being silent would have. Ask Kristian reads these and is forbidden
    from stating any figure it did not get from here or from a sourced explainer."""
    keys = ("giftAnnualExclusion", "giftAnnualExclusionYear", "basicExclusion",
            "basicExclusionYear", "transferTaxSource", "transferTaxChecked")
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

        return {"giftAnnualExclusion": ae, "giftAnnualExclusionYear": ye,
                "basicExclusion": be, "basicExclusionYear": yb,
                "transferTaxSource": "IRS frequently asked questions on gift taxes",
                "transferTaxChecked": datetime.date.today().isoformat()}
    except Exception as e:
        print(f"transfer tax fetch failed, keeping existing: {e}", file=sys.stderr)
        return keep(existing, keys)


def main():
    existing = load_existing()
    data = dict(existing)
    data.update(fetch_7520(existing))
    data.update(fetch_tenyear(existing))
    data.update(fetch_sp500(existing))
    data.update(fetch_transfer_tax(existing))
    data["updated"] = datetime.date.today().isoformat()
    if {k: v for k, v in data.items() if k != "updated"} == {k: v for k, v in existing.items() if k != "updated"}:
        print("no change")
        return
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print("updated:", json.dumps(data))

if __name__ == "__main__":
    main()
