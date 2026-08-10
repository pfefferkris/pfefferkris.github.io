#!/usr/bin/env python3
"""Refresh data/rates.json from public sources. Runs inside GitHub Actions, no PC required.
Sources: IRS Section 7520 page (HTML table) and U.S. Treasury daily par yield curve XML.
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

def fetch_7520(existing):
    """Parse the IRS 7520 page for the newest 'Month Year ... x.x' rate row."""
    try:
        html = get("https://www.irs.gov/businesses/small-businesses-self-employed/section-7520-interest-rates")
        text = re.sub(r"<[^>]+>", " ", html)
        months = "January|February|March|April|May|June|July|August|September|October|November|December"
        rows = re.findall(r"(" + months + r")\s+(20\d\d)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)", text)
        if not rows:
            raise ValueError("no rate rows found")
        # a 7520 rate is 120 percent of the midterm AFR rounded to the nearest 0.2,
        # so valid values are always even tenths; anything else is a misparse
        rows = [r for r in rows if float((__import__("decimal").Decimal(r[3]) * 5) % 1) == 0 and 0 < float(r[3]) < 20]
        if not rows:
            raise ValueError("no valid 7520 shaped rates found")
        # newest by (year, month index)
        order = ("January","February","March","April","May","June","July","August","September","October","November","December")
        rows.sort(key=lambda r: (int(r[1]), order.index(r[0])))
        m, y, _midterm, rate = rows[-1]
        return {"rate7520": float(rate), "rate7520Month": f"{m} {y}", "rate7520Source": "IRS Section 7520 interest rates page"}
    except Exception as e:
        print(f"7520 fetch failed, keeping existing: {e}", file=sys.stderr)
        return {k: existing[k] for k in ("rate7520","rate7520Month","rate7520Source") if k in existing}

def fetch_tenyear(existing):
    """Parse the Treasury daily par yield curve XML for the latest 10 year yield."""
    try:
        ym = datetime.date.today().strftime("%Y%m")
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
               f"?data=daily_treasury_yield_curve&field_tdr_date_value_month={ym}")
        xml = get(url)
        dates = re.findall(r"<d:NEW_DATE[^>]*>([\d\-T:]+)</d:NEW_DATE>", xml)
        tens = re.findall(r"<d:BC_10YEAR[^>]*>([0-9.]+)</d:BC_10YEAR>", xml)
        if not tens:  # month just started, fall back to prior month
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
        return {k: existing[k] for k in ("tenYear","tenYearDate","tenYearSource") if k in existing}

def main():
    existing = load_existing()
    data = dict(existing)
    data.update(fetch_7520(existing))
    data.update(fetch_tenyear(existing))
    data["updated"] = datetime.date.today().isoformat()
    if {k: v for k, v in data.items() if k != "updated"} == {k: v for k, v in existing.items() if k != "updated"}:
        print("no change")
        return
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print("updated:", json.dumps(data))

if __name__ == "__main__":
    main()
