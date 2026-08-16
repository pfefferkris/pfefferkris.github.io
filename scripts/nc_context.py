#!/usr/bin/env python3
"""
nc_context.py — the geography under the colour, carried in the file.

The first version of the map leaned on a public tile service for its roads. It looked right
until the tiles did not arrive, and then the county was 390 shapes floating in nothing. A
map whose legibility depends on somebody else's CDN is a map that is sometimes not a map.

So the context is baked in: the arterial roads, the water, and the municipal boundaries,
pulled from the same county server the parcels came from and generalised hard. Only the
roads a person navigates by — interstates, US and state routes, the named arterials — not
every cul-de-sac, which would triple the file to say nothing. The result is a few hundred
kilobytes and it renders with the network off.
"""

import json, os, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "kpfeffer.com education pipeline; contact mail@kpfeffer.com"}
OUT = os.environ.get("CONTEXT_OUT", "data/nc-context.json")

SOURCES = {
    "Cumberland": {
        "roads": ("https://gis.co.cumberland.nc.us/server/rest/services/GIS/Streets/MapServer/0/query",
                  # the county classifies its own centrelines; these are the ones a person
                  # gives directions by, and they are five thousand lines instead of twenty-four
                  "TYPE IN ('INTERSTATE','EXPRESSWAY','FREEWAY','MAJOR','SECONDARY')",
                  "STREETNAME,TYPE", 0.0006),
        "water": ("https://gis.co.cumberland.nc.us/server/rest/services/SoilsTopoHydro/Hydrology/MapServer/0/query",
                  "1=1", "", 0.0012),
        "cities": ("https://gis.co.cumberland.nc.us/server/rest/services/AdminBoundaries/CityLimits/MapServer/0/query",
                   "1=1", "*", 0.0004),
    },
}


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:                                   # noqa: BLE001
            last = e
            time.sleep(1.2 * (i + 1))
    print("    %s" % str(last)[:90], file=sys.stderr)
    return None


def pull(spec):
    url, where, fields, offset = spec
    rows, off = [], 0
    while True:
        u = (url + "?where=" + urllib.parse.quote(where) +
             "&outFields=" + urllib.parse.quote(fields or "") +
             "&returnGeometry=true&outSR=4326&geometryPrecision=5&maxAllowableOffset=" +
             str(offset) + "&f=json&resultOffset=" + str(off) + "&resultRecordCount=2000")
        j = get(u)
        if not j:
            break
        f = j.get("features", [])
        rows.extend(f)
        if len(f) < 2000:
            break
        off += 2000
        if off > 40000:
            break
    return rows


def to_geojson(feats, keep=None):
    out = []
    for f in feats:
        g = f.get("geometry") or {}
        if "paths" in g:
            geom = {"type": "MultiLineString", "coordinates": g["paths"]}
        elif "rings" in g:
            geom = {"type": "Polygon", "coordinates": g["rings"]}
        else:
            continue
        props = {}
        if keep:
            a = f.get("attributes", {})
            for k in keep:
                if a.get(k) not in (None, "", " "):
                    props[k] = a[k]
        out.append({"type": "Feature", "properties": props, "geometry": geom})
    return {"type": "FeatureCollection", "features": out}


def main():
    doc = {}
    for county, specs in SOURCES.items():
        layers = {}
        for name, spec in specs.items():
            feats = pull(spec)
            keep = ["STREETNAME","TYPE"] if name == "roads" else (["NAME"] if name == "cities" else None)
            gj = to_geojson(feats, keep)
            layers[name] = gj
            print("  %s %s: %d features" % (county, name, len(gj["features"])))
        doc[county] = layers
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    json.dump(doc, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print("wrote %s (%.1f MB)" % (OUT, os.path.getsize(OUT) / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
