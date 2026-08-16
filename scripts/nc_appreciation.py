#!/usr/bin/env python3
"""
nc_appreciation.py — a repeat-market index by assessor neighbourhood, from the public record.

WHY THIS EXISTS

"Fayetteville appreciated six percent" is a sentence that helps nobody. It is the median of
a distribution whose tenth and ninetieth percentiles, in Cumberland County over 2022 to
2025, are one percent and thirteen percent a year. A buyer standing in one of those
neighbourhoods and reading the county number is reading a number about a place they are not
standing in.

The county assessor already draws the lines. Every parcel carries a NEIGHBORHOOD — the mass
appraisal market area the assessor uses precisely because those parcels move together — and
every sale carries a date, a price and, beside it, the excise stamp. N.C. Gen. Stat.
105-228.30 charges one dollar per five hundred of consideration, so the stamp is not an
estimate of the price, it is the price the parties swore to. Across 4,271 Cumberland sales
in 2025 the stamp and the stated price agreed on 98.1 percent of them.

So the index is: median sale price per heated square foot, by assessor neighbourhood, by
year. Not a mean, because one estate sale of a mansion moves a mean and not a median. Not
an average price, because a neighbourhood that sold small houses one year and large ones the
next has not appreciated, it has changed mix, and dividing by heated area removes most of
that.

WHAT THIS IS NOT

It is not a Case-Shiller repeat-sales index. Case-Shiller pairs the SAME house selling
twice, which controls for quality absolutely; this pairs different houses in the same
neighbourhood and controls for it only through size. It is not an appraisal of anything. A
neighbourhood with eight sales in a year has an honest median and a wide one, and the count
is published beside every figure so nobody reads a thin cell as a thick one.

THE FIGURE LAW

Nothing here is remembered. Every number in the output was computed from rows fetched from
the county's own server at the moment this ran, and the run date and row counts travel with
the file so a stale file can be recognised as stale.

Counties are added here as their sale prices and neighbourhood codes are confirmed
publishable. Cumberland publishes both, in dedicated sales layers by year and property
class, and is the first.
"""

import json, math, os, sys, time, urllib.parse, urllib.request, datetime

OUT = os.environ.get("APPRECIATION_OUT", "data/nc-appreciation.json")
UA = {"User-Agent": "kpfeffer.com education pipeline; contact mail@kpfeffer.com"}

# Cumberland publishes residential sales as one layer per year. The layer ids are stable;
# the year they carry is read back out of the layer name at runtime rather than assumed,
# so a year rolling over does not silently mislabel a column.
CUMBERLAND = {
    "county": "Cumberland",
    "service": "https://gis.co.cumberland.nc.us/server/rest/services/Tax/ParcelSales/MapServer",
    "residential_layers": [13, 14, 15, 16, 17],
}

MIN_SALES = 8          # below this a median is a rumour
MIN_SF = 400
PSF_FLOOR, PSF_CEIL = 20.0, 500.0     # a $6/sf sale is a transfer, not a market event


def get(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:                              # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError("gave up on %s: %s" % (url[:110], last))


def layer_year(service, lid):
    """Read the year off the layer's own name. 'Residential Sales 2025' -> 2025."""
    meta = get(service + "/" + str(lid) + "?f=json")
    for tok in str(meta.get("name", "")).split():
        if tok.isdigit() and len(tok) == 4:
            return int(tok)
    return None


def page_layer(service, lid, fields, where):
    """Every row, not the first two thousand. The server caps a page; the caller pages."""
    rows, off = [], 0
    while True:
        u = (service + "/" + str(lid) + "/query?where=" + urllib.parse.quote(where) +
             "&outFields=" + urllib.parse.quote(fields) +
             "&returnGeometry=true&outSR=4326&maxAllowableOffset=0.002&geometryPrecision=5" +
             "&f=json&resultOffset=" + str(off) + "&resultRecordCount=2000")
        j = get(u)
        f = j.get("features", [])
        rows.extend(f)
        if len(f) < 2000:
            return rows
        off += 2000
        if off > 60000:                                     # a runaway guard, never reached
            return rows


def point_of(geom):
    """One representative point per parcel. Averaged over a neighbourhood's sales this
    lands where the neighbourhood is; it is not, and is not presented as, a boundary."""
    if not geom:
        return None
    rings = geom.get("rings") or geom.get("paths")
    if rings and rings[0]:
        pts = rings[0]
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    if "x" in geom and "y" in geom:
        return (geom["x"], geom["y"])
    return None


def median(v):
    v = sorted(v)
    n = len(v)
    if not n:
        return None
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0


def collect(spec):
    svc = spec["service"]
    by_year, stamp_ok, stamp_n = {}, 0, 0
    for lid in spec["residential_layers"]:
        year = layer_year(svc, lid)
        if not year:
            continue
        feats = page_layer(
            svc, lid,
            "NEIGHBORHOOD,VCS,PKG_SALE_PRICE,PKG_SALE_DATE,HEATED_AREA,BEDROOMS,"
            "BATH_FULL,YEAR_BUILT,CITY,ZIP,REVENUE_STAMPS",
            "PKG_SALE_PRICE > 20000")
        rows = []
        for f in feats:
            a = f.get("attributes", {})
            try:
                sf = float(str(a.get("HEATED_AREA") or 0).replace(",", ""))
            except ValueError:
                continue
            price = a.get("PKG_SALE_PRICE") or 0
            if sf < MIN_SF or not price:
                continue
            psf = price / sf
            if psf < PSF_FLOOR or psf > PSF_CEIL:
                continue
            # the stamp check, reported rather than assumed
            try:
                st = float(str(a.get("REVENUE_STAMPS") or 0))
            except ValueError:
                st = 0.0
            if st > 0:
                stamp_n += 1
                if abs(st * 500 - price) <= 500:
                    stamp_ok += 1
            rows.append({
                "n": (a.get("NEIGHBORHOOD") or "").strip() or ("VCS " + str(a.get("VCS") or "")),
                "psf": psf, "price": price, "sf": sf,
                "city": (a.get("CITY") or "").strip(),
                "pt": point_of(f.get("geometry")),
            })
        by_year[year] = rows
        print("  %s %d: %d usable residential sales" % (spec["county"], year, len(rows)))
    return by_year, stamp_ok, stamp_n


def build(spec):
    by_year, stamp_ok, stamp_n = collect(spec)
    years = sorted(by_year)
    if len(years) < 2:
        return None
    # The current year is partway through. Ending the index on it would compare a full year
    # against a fraction of one and call the difference appreciation. It stays in the series
    # so it can be read, flagged as partial; it is never an endpoint.
    this_year = datetime.date.today().year
    complete = [y for y in years if y < this_year]
    if len(complete) < 2:
        return None
    first, last = complete[0], complete[-1]

    hoods = {}
    for y in years:
        for r in by_year[y]:
            h = hoods.setdefault(r["n"], {"psf": {}, "pts": [], "city": {}})
            h["psf"].setdefault(y, []).append(r["psf"])
            if r["pt"]:
                h["pts"].append(r["pt"])
            if r["city"]:
                h["city"][r["city"]] = h["city"].get(r["city"], 0) + 1

    out = []
    for name, h in hoods.items():
        series = {}
        for y in years:
            v = h["psf"].get(y, [])
            if len(v) >= 3:                                  # publish thin cells, flagged
                series[y] = {"psf": round(median(v), 1), "n": len(v)}
        if first not in series or last not in series:
            continue
        a, b = series[first], series[last]
        if a["n"] < MIN_SALES or b["n"] < MIN_SALES:
            thin = True
        else:
            thin = False
        span = last - first
        cagr = (b["psf"] / a["psf"]) ** (1.0 / span) - 1.0 if span else 0.0
        # last completed year over the one before it, where both are present
        recent = None
        if (last - 1) in series and series[last - 1]["psf"]:
            recent = series[last]["psf"] / series[last - 1]["psf"] - 1.0
        pts = h["pts"]
        centre = None
        if pts:
            centre = [round(sum(p[0] for p in pts) / len(pts), 5),
                      round(sum(p[1] for p in pts) / len(pts), 5)]
        city = max(h["city"], key=h["city"].get) if h["city"] else None
        out.append({
            "name": name, "city": city, "at": centre,
            "series": {str(k): v for k, v in series.items()},
            "cagr": round(cagr * 1000) / 10.0,
            "recent": None if recent is None else round(recent * 1000) / 10.0,
            "sales": sum(series[y]["n"] for y in series),
            "thin": thin,
        })

    out.sort(key=lambda r: -r["cagr"])
    solid = [r["cagr"] for r in out if not r["thin"]]
    solid.sort()

    def pct(p):
        if not solid:
            return None
        return solid[min(len(solid) - 1, int(len(solid) * p))]

    return {
        "county": spec["county"],
        "years": years,
        "indexYears": [first, last],
        "partialYear": this_year if this_year in years else None,
        "neighborhoods": out,
        "countyMedianCagr": pct(0.5),
        "spread": {"p10": pct(0.10), "p90": pct(0.90)},
        "counts": {"neighborhoods": len(out),
                   "withEnoughSales": len(solid),
                   "sales": sum(len(by_year[y]) for y in years)},
        "stampCheck": {"checked": stamp_n, "agreed": stamp_ok,
                       "rate": round(1000.0 * stamp_ok / stamp_n) / 10.0 if stamp_n else None},
        "method": ("Median recorded sale price per heated square foot, by the county "
                   "assessor's own neighbourhood, by year. Medians, not averages, so one "
                   "unusual sale cannot move a cell. Per square foot, not per house, so a "
                   "change in what sizes sold is not mistaken for appreciation. Neighbourhoods "
                   "with fewer than %d sales in either end year are marked thin and left out "
                   "of the county figures." % MIN_SALES),
        "notWhat": ("This is not a repeat-sales index: it compares different houses in the "
                    "same neighbourhood, not the same house twice, so it does not control for "
                    "condition or renovation. It is not an appraisal and reaches no conclusion "
                    "about any particular property."),
        "source": spec["service"],
        "authority": ("Sale prices are as recorded. Where the excise stamp is published it is "
                      "the consideration the parties swore to, at $1 per $500 under N.C. Gen. "
                      "Stat. 105-228.30."),
    }


def main():
    built = {}
    for spec in [CUMBERLAND]:
        try:
            r = build(spec)
            if r:
                built[spec["county"]] = r
        except Exception as e:                               # noqa: BLE001
            print("  %s failed: %s" % (spec["county"], e), file=sys.stderr)
    if not built:
        print("no county produced an index; leaving the existing file alone", file=sys.stderr)
        return 1
    doc = {"generated": datetime.datetime.now(datetime.timezone.utc)
                            .strftime("%Y-%m-%dT%H:%M:%SZ"),
           "counties": built}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    for c, r in built.items():
        print("%s: %d neighbourhoods, %d with enough sales, median %.1f%%/yr, "
              "p10 %.1f%% p90 %.1f%%, stamps agreed on %.1f%%"
              % (c, r["counts"]["neighborhoods"], r["counts"]["withEnoughSales"],
                 r["countyMedianCagr"], r["spread"]["p10"], r["spread"]["p90"],
                 r["stampCheck"]["rate"]))
    print("wrote " + OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
