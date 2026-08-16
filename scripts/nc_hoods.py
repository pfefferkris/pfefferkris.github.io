#!/usr/bin/env python3
"""
nc_hoods.py — neighbourhood boundaries, dissolved out of the assessor's own parcels.

No North Carolina county publishes its mass-appraisal neighbourhoods as a boundary layer.
Every county that uses them publishes the code on each parcel instead. So the boundary is
recoverable: take every parcel carrying a neighbourhood code, union the ones that share it,
and what falls out is the shape the assessor has been drawing implicitly all along.

Three details make the result look like a map instead of a rash:

  - Parcels that abut do not quite touch after generalisation, so a plain union leaves hairline
    gaps and the shape comes apart. Each parcel is grown by about ten metres before the union
    and shrunk by the same after, which closes the seams without moving the outer edge.
  - A neighbourhood is often not one blob. Assessors reuse a code across a road or a creek.
    Multipolygons are kept as multipolygons rather than being forced into one hull, because a
    hull would swallow the land between and claim territory the code does not cover.
  - Rings smaller than about two acres left over after the shrink are dropped. They are
    almost always a single outlying parcel and they read as noise at map scale.

The output is GeoJSON in WGS84, one feature per neighbourhood, carrying the appreciation
figures computed by nc_appreciation.py so the map is one file.

Nothing here is remembered or assumed. The parcels are fetched at run time.
"""

import json, math, os, sys, time, urllib.parse, urllib.request, datetime
from shapely.geometry import Polygon, MultiPolygon, shape, mapping
from shapely.ops import unary_union

UA = {"User-Agent": "kpfeffer.com education pipeline; contact mail@kpfeffer.com"}
INDEX = os.environ.get("APPRECIATION_OUT", "data/nc-appreciation.json")
OUT = os.environ.get("HOODS_OUT", "data/nc-neighborhoods.json")

COUNTIES = {
    "Cumberland": {
        "parcels": "https://gis.co.cumberland.nc.us/server/rest/services/Tax/Parcels/MapServer/0/query",
        "field": "NEIGHBORHOOD",
    },
}

GROW = 0.00012          # ~13 m in degrees at this latitude: closes the seam between parcels
SIMPLIFY = 0.00008      # ~9 m: enough to halve the file, not enough to see
MIN_RING = 8000.0       # square metres, roughly two acres
DEG2M2 = (111320.0 ** 2) * math.cos(math.radians(35.05))


def get(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:                                    # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError("gave up on %s: %s" % (url[:110], last))


def esri_to_shapely(geom):
    rings = geom.get("rings")
    if not rings:
        return None
    outers, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        # Esri signs its rings: clockwise is an outer ring, counter-clockwise is a hole
        a = 0.0
        for i in range(len(r) - 1):
            a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
        (outers if a < 0 else holes).append(r)
    polys = []
    for o in outers:
        try:
            p = Polygon(o)
            if not p.is_valid:
                p = p.buffer(0)
            if not p.is_empty:
                polys.append(p)
        except Exception:                                          # noqa: BLE001
            continue
    if not polys:
        return None
    return unary_union(polys) if len(polys) > 1 else polys[0]


def pull(spec, field):
    rows, off, t0 = {}, 0, time.time()
    while True:
        u = (spec["parcels"] + "?where=" + urllib.parse.quote("1=1") +
             "&outFields=" + field +
             "&returnGeometry=true&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0002" +
             "&f=json&resultOffset=" + str(off) + "&resultRecordCount=2000")
        j = get(u)
        feats = j.get("features", [])
        for f in feats:
            name = (f.get("attributes", {}).get(field) or "").strip()
            if not name:
                continue
            g = esri_to_shapely(f.get("geometry") or {})
            if g is None or g.is_empty:
                continue
            rows.setdefault(name, []).append(g)
        if len(feats) < 2000:
            break
        off += 2000
        if off % 20000 == 0:
            print("    %d parcels, %.0fs" % (off, time.time() - t0))
        if off > 400000:
            break
    return rows


def dissolve(parts):
    grown = [p.buffer(GROW, resolution=2) for p in parts]
    u = unary_union(grown).buffer(-GROW * 0.8, resolution=2)
    if u.is_empty:
        return None
    u = u.simplify(SIMPLIFY, preserve_topology=True)
    keep = []
    for g in ([u] if u.geom_type == "Polygon" else list(u.geoms)):
        if g.is_empty:
            continue
        if g.area * DEG2M2 >= MIN_RING:
            keep.append(g)
    if not keep:
        return None
    return keep[0] if len(keep) == 1 else MultiPolygon(keep)


def main():
    if not os.path.exists(INDEX):
        print("run nc_appreciation.py first: %s is missing" % INDEX, file=sys.stderr)
        return 1
    idx = json.load(open(INDEX, encoding="utf-8"))
    out = {"generated": datetime.datetime.now(datetime.timezone.utc)
                          .strftime("%Y-%m-%dT%H:%M:%SZ"), "counties": {}}

    for county, spec in COUNTIES.items():
        ci = (idx.get("counties") or {}).get(county)
        if not ci:
            print("  no index for %s, skipping" % county)
            continue
        wanted = {h["name"]: h for h in ci["neighborhoods"]}
        print("  %s: pulling parcels..." % county)
        groups = pull(spec, spec["field"])
        print("  %s: %d neighbourhood codes on the ground, %d with an index"
              % (county, len(groups), len(wanted)))

        feats, done = [], 0
        for name, parts in groups.items():
            h = wanted.get(name)
            if not h:
                continue
            try:
                g = dissolve(parts)
            except Exception as e:                                 # noqa: BLE001
                print("    %s failed to dissolve: %s" % (name[:40], e))
                continue
            if g is None:
                continue
            done += 1
            # Assessors use the same field for two different things: a subdivision of
            # three hundred houses, and a rural catch-all covering a third of a township.
            # Both are honest; they are not the same object, and a map that shades them
            # identically lets the big one dominate by area rather than by meaning. Anything
            # over about four square miles is flagged so it can be drawn and read as what
            # it is — a district, whose figure is an average over a lot of ground.
            sq_mi = g.area * DEG2M2 / 2_589_988.0
            feats.append({
                "type": "Feature",
                "properties": {
                    "name": name, "city": h.get("city"),
                    "cagr": h.get("cagr"), "recent": h.get("recent"),
                    "sales": h.get("sales"), "thin": h.get("thin"),
                    "series": h.get("series"), "parcels": len(parts),
                    "sqmi": round(sq_mi, 2), "district": sq_mi > 4.0,
                },
                "geometry": mapping(g),
            })
        feats.sort(key=lambda f: -(f["properties"]["cagr"] or 0))
        out["counties"][county] = {
            "type": "FeatureCollection", "features": feats,
            "indexYears": ci.get("indexYears"), "partialYear": ci.get("partialYear"),
            "countyMedianCagr": ci.get("countyMedianCagr"),
            "spread": ci.get("spread"), "stampCheck": ci.get("stampCheck"),
            "method": ci.get("method"), "notWhat": ci.get("notWhat"),
            "boundaries": ("Dissolved from the parcels carrying each neighbourhood code in the "
                           "county's own tax parcel layer. No county publishes these as "
                           "boundaries; this is the shape implied by the codes."),
        }
        print("  %s: %d neighbourhood shapes built" % (county, done))

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote %s (%.1f MB)" % (OUT, os.path.getsize(OUT) / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
