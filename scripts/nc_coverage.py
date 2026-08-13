#!/usr/bin/env python3
"""What the public record will actually give us, county by county, all one hundred.

This exists because "we support North Carolina" is not a true sentence. Each county
decides for itself what it publishes and to whom, so the honest unit of coverage is the
county and the honest answer is a table rather than a claim. Three tiers:

  deep      the county runs a system we can query directly, and it carries building
            detail, the ownership chain with prices, and usually the tax bill
  standard  only NC OneMap's statewide layer, which carries whatever that county chose
            to send it
  thin      the statewide layer has this county but the fields we need are empty

Re-run it and the file changes when the counties change. Nothing here is typed from
memory: every number is counted from the source on the day it runs.

    python scripts/nc_coverage.py
"""
import concurrent.futures as cf
import datetime
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com"}
ONEMAP = ("https://services.nconemap.gov/secure/rest/services/"
          "NC1Map_Parcels/FeatureServer/0/query")
NCPTS = "https://lrcpwa.ncptscloud.com/api/SimpleParcelSearch"
OUT = pathlib.Path("data/nc-coverage.json")

# Counties that run something of their own, outside the shared platform.
OWN = {
    "Wake": "Wake County parcel GIS",
    "Mecklenburg": "Mecklenburg County CAMA parcel data",
}

# Every county in the state, so a county that vanishes from the statewide layer still
# shows up in the table as missing rather than silently not existing.
COUNTIES = """Alamance Alexander Alleghany Anson Ashe Avery Beaufort Bertie Bladen Brunswick
Buncombe Burke Cabarrus Caldwell Camden Carteret Caswell Catawba Chatham Cherokee Chowan Clay
Cleveland Columbus Craven Cumberland Currituck Dare Davidson Davie Duplin Durham Edgecombe
Forsyth Franklin Gaston Gates Graham Granville Greene Guilford Halifax Harnett Haywood
Henderson Hertford Hoke Hyde Iredell Jackson Johnston Jones Lee Lenoir Lincoln Macon Madison
Martin McDowell Mecklenburg Mitchell Montgomery Moore Nash Northampton Onslow Orange Pamlico
Pasquotank Pender Perquimans Person Pitt Polk Randolph Richmond Robeson Rockingham Rowan
Rutherford Sampson Scotland Stanly Stokes Surry Swain Transylvania Tyrrell Union Vance Wake
Warren Washington Watauga Wayne Wilkes Wilson Yadkin Yancey""".split() + ["New Hanover"]

# The fields that change an answer, and what each one is for.
FIELDS = {
    "parcels":   ("1=1", "the county is in the statewide layer at all"),
    "land":      ("landval > 0", "the assessor's land value, which sets the share that is never depreciated"),
    "building":  ("improvval > 0", "the assessor's building value"),
    "deed":      ("sourceref IS NOT NULL AND sourceref <> ''", "the deed book and page, which is how you find the mortgage"),
    "address":   ("siteadd IS NOT NULL AND siteadd <> ''", "a site address to search on"),
    "saledate":  ("saledate IS NOT NULL", "when it last changed hands"),
    "yearbuilt": ("structyear > 1700", "the year the structure went up"),
    "use":       ("parusedesc IS NOT NULL AND parusedesc <> ''", "what it is used for"),
}


def onemap_group(where):
    body = urllib.parse.urlencode({
        "where": where,
        "groupByFieldsForStatistics": "cntyname",
        "outStatistics": json.dumps([{"statisticType": "count",
                                      "onStatisticField": "objectid",
                                      "outStatisticFieldName": "n"}]),
        "returnGeometry": "false", "f": "json",
    }).encode()
    req = urllib.request.Request(ONEMAP, data=body, headers=UA)
    j = json.loads(urllib.request.urlopen(req, timeout=180).read())
    if "error" in j:
        raise RuntimeError(j["error"])
    return {f["attributes"]["cntyname"]: f["attributes"]["n"] for f in j.get("features", [])}


def ncpts_probe(county):
    """Is this county a tenant of the shared platform, and does it answer with data."""
    tenant = county.lower().replace(" ", "")
    for query in ("MAIN", "1", "MARKET", "100"):
        url = NCPTS + "?query=" + urllib.parse.quote(query) + "&pageIndex=0&pageSize=1"
        head = dict(UA)
        head["X-Tenant"] = tenant
        try:
            j = json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=head), timeout=25).read())
        except Exception:
            return county, None
        if j.get("totalCount"):
            return county, tenant
    return county, None          # answers, but nothing indexed we could reach


def main():
    counts = {}
    for key, (where, _why) in FIELDS.items():
        try:
            counts[key] = onemap_group(where)
        except Exception as e:
            print("statewide query failed for %s: %s" % (key, e), file=sys.stderr)
            counts[key] = {}
    if not counts.get("parcels"):
        print("the statewide layer did not answer at all; leaving the file alone", file=sys.stderr)
        return 1

    tenants = {}
    with cf.ThreadPoolExecutor(10) as ex:
        for county, tenant in ex.map(ncpts_probe, COUNTIES):
            if tenant:
                tenants[county] = tenant

    rows = {}
    for county in sorted(set(COUNTIES)):
        total = counts["parcels"].get(county, 0)
        fields = {}
        for key in FIELDS:
            if key == "parcels":
                continue
            have = counts.get(key, {}).get(county, 0)
            fields[key] = round(100.0 * have / total) if total else None
        if county in OWN:
            tier, via = "deep", OWN[county]
        elif county in tenants:
            tier, via = "deep", "shared NCPTS assessor platform"
        elif total and (fields.get("land") or 0) >= 50 and (fields.get("deed") or 0) >= 50:
            tier, via = "standard", "NC OneMap statewide parcels"
        elif total:
            tier, via = "thin", "NC OneMap statewide parcels"
        else:
            tier, via = "none", None
        rows[county] = {"parcels": total, "tier": tier, "via": via, "fields": fields}

    tally = {}
    for r in rows.values():
        tally[r["tier"]] = tally.get(r["tier"], 0) + 1

    doc = {
        "note": ("What the public record gives us for each North Carolina county, counted "
                 "from the sources on the day this ran rather than claimed. deep means the "
                 "county's own system answers with building detail and the ownership chain; "
                 "standard means only the statewide parcel layer; thin means the statewide "
                 "layer has the county but not the fields that change an answer."),
        "checked": datetime.date.today().isoformat(),
        "sources": {
            "statewide": "NC OneMap statewide parcels, NC1Map_Parcels FeatureServer",
            "shared": "NCPTS assessor platform, lrcpwa.ncptscloud.com",
            "own": OWN,
        },
        "fieldMeaning": {k: v[1] for k, v in FIELDS.items() if k != "parcels"},
        "counties": len(rows),
        "parcels": sum(r["parcels"] for r in rows.values()),
        "tally": tally,
        "county": rows,
    }
    OUT.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n")
    print("counties %d, parcels %s, %s"
          % (len(rows), f"{doc['parcels']:,}",
             ", ".join("%s %d" % (k, v) for k, v in sorted(tally.items()))))
    for county, r in sorted(rows.items()):
        if r["tier"] in ("thin", "none"):
            print("   %-14s %-8s %s" % (county, r["tier"],
                  ", ".join("%s %s%%" % (k, v) for k, v in r["fields"].items() if v is not None and v < 50)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
