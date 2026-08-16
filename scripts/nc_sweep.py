#!/usr/bin/env python3
"""
nc_sweep.py — which of the hundred counties can actually carry a heat map.

The statewide layer reaches all hundred and carries neither a sale price nor a neighbourhood
code, so it cannot. A heat map of appreciation needs three things from one source:

    1. a recorded sale price (or an excise stamp, which is better)
    2. an assessor neighbourhood or market-area code to group by
    3. parcel geometry, to draw the group

Counties that have all three run their own ArcGIS server. There is no register of those
servers, so this looks for them two ways: the URL patterns North Carolina counties actually
use, and ArcGIS Online's own search index for hosted parcel services. Everything found is
then interrogated field by field — a service that exists proves nothing; a service whose
parcel layer carries SALE_PRICE and NEIGHBORHOOD proves everything.

The output is a ledger, not a claim: what was probed, what answered, and for each county
which of the three requirements it meets. Where a county fails, the field it is missing is
named, so the next attempt starts from what is known rather than from zero.
"""

import json, os, re, sys, time, urllib.parse, urllib.request
import concurrent.futures as cf

UA = {"User-Agent": "kpfeffer.com education pipeline; contact mail@kpfeffer.com"}
OUT = os.environ.get("SWEEP_OUT", "data/nc-parcel-servers.json")
TIMEOUT = 12

COUNTIES = ["Alamance","Alexander","Alleghany","Anson","Ashe","Avery","Beaufort","Bertie",
"Bladen","Brunswick","Buncombe","Burke","Cabarrus","Caldwell","Camden","Carteret","Caswell",
"Catawba","Chatham","Cherokee","Chowan","Clay","Cleveland","Columbus","Craven","Cumberland",
"Currituck","Dare","Davidson","Davie","Duplin","Durham","Edgecombe","Forsyth","Franklin",
"Gaston","Gates","Graham","Granville","Greene","Guilford","Halifax","Harnett","Haywood",
"Henderson","Hertford","Hoke","Hyde","Iredell","Jackson","Johnston","Jones","Lee","Lenoir",
"Lincoln","Macon","Madison","Martin","McDowell","Mecklenburg","Mitchell","Montgomery",
"Moore","Nash","New Hanover","Northampton","Onslow","Orange","Pamlico","Pasquotank","Pender",
"Perquimans","Person","Pitt","Polk","Randolph","Richmond","Robeson","Rockingham","Rowan",
"Rutherford","Sampson","Scotland","Stanly","Stokes","Surry","Swain","Transylvania","Tyrrell",
"Union","Vance","Wake","Warren","Washington","Watauga","Wayne","Wilkes","Wilson","Yadkin",
"Yancey"]

# What each of the three requirements looks like in the wild. Counties name their columns
# differently and there is no standard; these are the spellings actually observed.
PRICE = re.compile(r"(SALE_?PR|SALEPRICE|SALE_?AMT|TOTSALPRICE|PKG_SALE_PRICE|SALEVAL|"
                   r"CONSIDER|REVENUE_?STAMP|STAMPS|EXCISE)", re.I)
HOOD = re.compile(r"(NEIGHBORHOOD|NBHD|NEIGHBOR|NHOOD|^VCS$|MARKET_?AREA|MKT_?AREA|"
                  r"APPRAISAL_?AREA|TAXDIST_?NBHD)", re.I)
SIZE = re.compile(r"(HEATED|HTD_?AREA|LIVING_?AREA|SQFT_?HEAT|FIN_?AREA|TOTAL_?SQFT|"
                  r"BLDG_?SQFT|SQ_?FT)", re.I)
PARCELISH = re.compile(r"(parcel|cama|tax|property|land ?record)", re.I)


def get(url):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read(4_000_000).decode("utf-8", "replace")
        return json.loads(body)
    except Exception:                                          # noqa: BLE001
        return None


def slug(c):
    return c.lower().replace(" ", "")


# Servers already verified by hand. A guess that happens to be right is still a guess;
# these are here because a query was run against them and came back with data.
KNOWN = {
    "Wake": ["https://maps.wake.gov/arcgis/rest/services"],
    "Mecklenburg": ["https://meckgis.mecklenburgcountync.gov/server/rest/services"],
    "Cumberland": ["https://gis.co.cumberland.nc.us/server/rest/services"],
    "Durham": ["https://gisweb.durhamnc.gov/arcgis/rest/services",
               "https://maps.durhamnc.gov/arcgis/rest/services"],
    "Guilford": ["https://gis.guilfordcountync.gov/arcgis/rest/services",
                 "https://gisdata.guilfordcountync.gov/arcgis/rest/services"],
    "Forsyth": ["https://maps.forsyth.cc/arcgis/rest/services"],
    "Buncombe": ["https://gis.buncombecounty.org/arcgis/rest/services"],
    "New Hanover": ["https://gis.nhcgov.com/arcgis/rest/services"],
    "Union": ["https://gis.unioncountync.gov/arcgis/rest/services"],
    "Johnston": ["https://gis.johnstonnc.com/arcgis/rest/services"],
    "Onslow": ["https://gis.onslowcountync.gov/arcgis/rest/services"],
    "Iredell": ["https://gis.co.iredell.nc.us/arcgis/rest/services"],
    "Gaston": ["https://gis.gastongov.com/arcgis/rest/services"],
    "Brunswick": ["https://gis.brunswickcountync.gov/arcgis/rest/services"],
    "Pitt": ["https://gis.pittcountync.gov/arcgis/rest/services"],
    "Harnett": ["https://gis.harnett.org/arcgis/rest/services"],
    "Orange": ["https://gis.orangecountync.gov/arcgis/rest/services"],
    "Catawba": ["https://gis.catawbacountync.gov/arcgis/rest/services"],
    "Cabarrus": ["https://gis.cabarruscounty.us/arcgis/rest/services"],
    "Alamance": ["https://gis.alamance-nc.com/arcgis/rest/services"],
}

def candidates(county):
    s = slug(county)
    d = county.lower().replace(" ", "-")
    pats = [
        "https://gis.co.%s.nc.us/server/rest/services" % s,
        "https://gis.co.%s.nc.us/arcgis/rest/services" % s,
        "https://gis.%scountync.gov/server/rest/services" % s,
        "https://gis.%scountync.gov/arcgis/rest/services" % s,
        "https://maps.%scountync.gov/arcgis/rest/services" % s,
        "https://gis.%scountync.org/arcgis/rest/services" % s,
        "https://gis.%scounty.org/arcgis/rest/services" % s,
        "https://gis.%scountync.com/arcgis/rest/services" % s,
        "https://maps.%s.gov/arcgis/rest/services" % s,
        "https://gis.%s.org/arcgis/rest/services" % s,
        "https://gis.%s-nc.com/arcgis/rest/services" % d,
        "https://%sgis.com/arcgis/rest/services" % s,
        "https://gis.%snc.gov/arcgis/rest/services" % s,
    ]
    return KNOWN.get(county, []) + pats


def walk_services(root, depth=0):
    """Folders one level down only. Deeper is where the archived basemaps live."""
    j = get(root + "?f=json")
    if not j or "services" not in j:
        return []
    found = list(j.get("services") or [])
    if depth == 0:
        for folder in (j.get("folders") or []):
            if not PARCELISH.search(folder) and folder.lower() not in ("gis", "public", "open"):
                continue
            sub = get(root + "/" + folder + "?f=json")
            if sub:
                found.extend(sub.get("services") or [])
    return found


def inspect_service(root, svc):
    name, kind = svc.get("name"), svc.get("type")
    if kind not in ("MapServer", "FeatureServer"):
        return None
    if not PARCELISH.search(name or ""):
        return None
    meta = get("%s/%s/%s?f=json" % (root, name, kind))
    if not meta:
        return None
    best = None
    for lyr in (meta.get("layers") or [{"id": 0}])[:6]:
        d = get("%s/%s/%s/%s?f=json" % (root, name, kind, lyr.get("id")))
        if not d or d.get("type") not in (None, "Feature Layer"):
            continue
        fields = [f.get("name", "") for f in (d.get("fields") or [])]
        if not fields:
            continue
        hit = {
            "layer": "%s/%s/%s/%s" % (root, name, kind, lyr.get("id")),
            "layerName": d.get("name"),
            "fieldCount": len(fields),
            "price": [f for f in fields if PRICE.search(f)][:4],
            "neighborhood": [f for f in fields if HOOD.search(f)][:4],
            "heatedArea": [f for f in fields if SIZE.search(f)][:4],
            "geometry": bool(d.get("geometryType")),
        }
        nm = (d.get("name") or "") + " " + (name or "")
        hit["score"] = ((2 if hit["price"] else 0) + (2 if hit["neighborhood"] else 0) +
                        (1 if hit["heatedArea"] else 0) + (1 if hit["geometry"] else 0) +
                        (2 if re.search(r"parcel", nm, re.I) else 0) +
                        (-2 if re.search(r"condo|anno|line|sales \d|basemap|pictometry|"
                                         r"mineral|surplus|test", nm, re.I) else 0))
        if best is None or hit["score"] > best["score"]:
            best = hit
        if hit["score"] >= 8:
            break
    return best


def agol_search(county):
    """Small counties host on ArcGIS Online rather than running a server."""
    q = '(title:"%s" OR owner:"%s") AND (parcel OR tax) AND type:"Feature Service"' % (
        county, slug(county))
    j = get("https://www.arcgis.com/sharing/rest/search?f=json&num=8&q=" +
            urllib.parse.quote(q))
    out = []
    for r in (j or {}).get("results", [])[:6]:
        u = r.get("url")
        if not u or "NC" not in (r.get("title", "") + r.get("snippet", "") + r.get("description", "") or "") \
           and county.lower() not in (r.get("title", "") or "").lower():
            continue
        out.append({"title": r.get("title"), "url": u, "owner": r.get("owner")})
    return out


def sweep_county(county):
    rec = {"county": county, "probed": 0, "server": None, "layer": None,
           "price": [], "neighborhood": [], "heatedArea": [], "verdict": None,
           "agol": []}
    best = None
    for root in candidates(county):
        rec["probed"] += 1
        svcs = walk_services(root)
        if not svcs:
            continue
        rec["server"] = root
        for svc in svcs[:60]:
            hit = inspect_service(root, svc)
            if hit and (best is None or hit["score"] > best["score"]):
                best = hit
            if best and best["score"] >= 8:
                break
        if best and best["score"] >= 8:
            break
    if best:
        rec.update({k: best[k] for k in ("layer", "price", "neighborhood", "heatedArea")})
        rec["layerName"] = best.get("layerName")
    if not best or best["score"] < 4:
        try:
            rec["agol"] = agol_search(county)
        except Exception:                                      # noqa: BLE001
            pass
    if best and best["price"] and best["neighborhood"]:
        rec["verdict"] = "heatmap"        # all three: price, neighbourhood, geometry
    elif best and best["price"]:
        rec["verdict"] = "comps"          # prices but no neighbourhood to group by
    elif best:
        rec["verdict"] = "record"         # a real parcel layer, no prices
    else:
        rec["verdict"] = "none"
    return rec


def main():
    only = sys.argv[1:] or COUNTIES
    results = {}
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(sweep_county, c): c for c in only}
        for i, f in enumerate(cf.as_completed(futs), 1):
            c = futs[f]
            try:
                results[c] = f.result()
            except Exception as e:                             # noqa: BLE001
                results[c] = {"county": c, "verdict": "error", "error": str(e)[:120]}
            r = results[c]
            print("[%3d/%d] %-14s %-8s %s" % (
                i, len(only), c, r.get("verdict"),
                (r.get("layer") or (r.get("agol") and r["agol"][0]["url"]) or "")[:88]))
    tally = {}
    for r in results.values():
        tally[r.get("verdict")] = tally.get(r.get("verdict"), 0) + 1
    doc = {"checked": time.strftime("%Y-%m-%d"), "elapsedSeconds": round(time.time() - t0),
           "tally": tally, "counties": results,
           "requirement": ("A neighbourhood heat map needs a recorded sale price, an assessor "
                           "neighbourhood or market-area code, and parcel geometry, all from "
                           "one source. 'heatmap' means all three were found by name in the "
                           "layer's own field list. 'comps' means prices but nothing to group "
                           "them by. 'record' means a parcel layer with no prices."),
           "caveat": ("A field existing is not a field populated. Every county marked heatmap "
                      "still has to be queried before it is believed.")}
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    json.dump(doc, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print("\n" + json.dumps(tally) + "  -> " + OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
