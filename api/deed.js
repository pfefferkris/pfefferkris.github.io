// /api/deed — deed book and page from the North Carolina statewide parcel record (NC OneMap).
// Public GIS data; no key required. Returns the recording reference and legal description
// so the guide can show the actual book and page a home's story is recorded under.
// Owner names are deliberately NOT returned. Nothing the visitor types is stored.

const cache = new Map();
const TTL = 1000 * 60 * 60 * 24;

function pick(attrs, name) {
  if (!attrs) return null;
  const k = Object.keys(attrs).find(x => x.toLowerCase() === name);
  return k ? attrs[k] : null;
}


// The assessor's own split of land from building. This is the figure tax practitioners
// actually use to allocate basis, because it is a third party's allocation on the public
// record rather than the taxpayer's opinion of it, and land is the part that is never
// depreciated. Values are the assessment, not market value, but the RATIO is what matters
// and the ratio is the point. Owner names are still deliberately not returned.
function num(v) {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  return typeof n === "number" && isFinite(n) && n > 0 ? Math.round(n) : null;
}
function dateOf(v) {
  if (!v) return null;
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function assessedFrom(land, bldg, total, salePrice, saleDate, units, area, built, who) {
  const L = num(land), B = num(bldg), T = num(total);
  const out = {
    land: L, building: B, total: T || (L && B ? L + B : null),
    salePrice: num(salePrice), saleDate: dateOf(saleDate),
    units: num(units), heatedArea: num(area), yearBuilt: num(built),
    source: who
  };
  // the only derived number, and the one the guide is actually after
  out.landShare = (L && out.total) ? Math.round((L / out.total) * 1000) / 10 : null;
  const any = out.land || out.building || out.salePrice || out.saleDate || out.heatedArea;
  return any ? out : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

  const raw = (req.query.address || "").toString().trim();
  const county = (req.query.county || "").toString().trim().toUpperCase().replace(/[^A-Z ]/g, "").slice(0, 30);
  const full = raw.split(",")[0].toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  // match on house number + street NAME only: parcel data abbreviates suffixes (DRIVE vs DR)
  const toks = full.split(" ").filter(Boolean);
  const SUFFIX = new Set(["ST","STREET","DR","DRIVE","RD","ROAD","AVE","AVENUE","LN","LANE","CT","COURT","CIR","CIRCLE","BLVD","BOULEVARD","WAY","PL","PLACE","TRL","TRAIL","PKWY","PARKWAY","HWY","HIGHWAY","TER","TERRACE","LOOP","RUN"]);
  while (toks.length > 2 && SUFFIX.has(toks[toks.length - 1])) toks.pop();
  const street = toks.join(" ");
  if (street.length < 5 || !/^\d/.test(street)) {
    return res.status(400).json({ error: "send a street address" });
  }

  const key = street + "|" + county;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  // Wake keeps its own parcel layer with the deed book, page AND the recording
  // date, which the statewide layer lacks. Raleigh addresses get the county's
  // own record; everything else falls through to the statewide layer below.
  async function wakeCounty() {
    const w = "SITE_ADDRESS LIKE '" + street.replace(/'/g, "''") + "%'";
    const u = "https://maps.wake.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query?where=" +
      encodeURIComponent(w) + "&outFields=SITE_ADDRESS,DEED_BOOK,DEED_PAGE,DEED_DATE,PIN_NUM,LAND_VAL,BLDG_VAL,TOTAL_VALUE_ASSD,TOTSALPRICE,SALE_DATE,YEAR_BUILT,HEATEDAREA,TOTUNITS,TYPE_USE_DECODE&returnGeometry=false&resultRecordCount=1&f=json";
    const r = await fetch(u, { headers: { "User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com" } });
    if (!r.ok) return null;
    const j = await r.json();
    const f = (j.features || [])[0];
    if (!f) return null;
    const a = f.attributes || {};
    const bk = (a.DEED_BOOK || "").toString().replace(/^0+(?=\d)/, "");
    const pg = (a.DEED_PAGE || "").toString().replace(/^0+(?=\d)/, "");
    if (!bk || !pg) return null;
    return {
      county: "Wake",
      siteAddress: a.SITE_ADDRESS || null,
      sourceRef: "Deed Book/Page " + a.DEED_BOOK + "/" + a.DEED_PAGE,
      book: bk, page: pg,
      legal: null,
      recorded: a.DEED_DATE ? new Date(a.DEED_DATE).toISOString().slice(0, 10) : null,
      use: a.TYPE_USE_DECODE || null,
      assessed: assessedFrom(a.LAND_VAL, a.BLDG_VAL, a.TOTAL_VALUE_ASSD, a.TOTSALPRICE,
                            a.SALE_DATE, a.TOTUNITS, a.HEATEDAREA, a.YEAR_BUILT,
                            "Wake County assessor"),
      source: "Wake County parcel record (the county's own GIS)"
    };
  }

  // Guilford's statewide record carries the deed BOOK but no page, and no site
  // address at all. The county's own property system has book, page and date.
  async function guilfordCounty() {
    const H = { "X-Tenant": "guilford", "User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com" };
    const s = await fetch("https://lrcpwa.ncptscloud.com/api/SimpleParcelSearch?query=" +
      encodeURIComponent(street) + "&pageIndex=0&pageSize=5", { headers: H });
    if (!s.ok) return null;
    const sj = await s.json();
    const hit = (sj.results || [])[0];
    if (!hit || !hit.formattedPin) return null;
    const pin = hit.formattedPin.replace(/[^0-9]/g, "");
    const d = await fetch("https://lrcpwa.ncptscloud.com/api/GetParcelDetailsByQueryParam", {
      method: "POST", headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ searchKey: "pin", searchValue: pin })
    });
    if (!d.ok) return null;
    const j = await d.json();
    const bk = (j.deedBook || "").toString().replace(/^0+(?=\d)/, "");
    const pg = (j.deedPage || "").toString().replace(/^0+(?=\d)/, "");
    if (!bk || !pg) return null;
    // owner names are deliberately not carried through
    return {
      county: "Guilford",
      siteAddress: hit.propertyAddress1 || null,
      sourceRef: "Deed Book/Page " + j.deedBook + "/" + j.deedPage,
      book: bk, page: pg,
      legal: hit.propertyDescription || null,
      recorded: j.deedDate ? String(j.deedDate).slice(0, 10) : null,
      use: null,
      source: "Guilford County property record (the county's own system)"
    };
  }

  try {
    if (county.indexOf("GUILFORD") === 0) {
      try {
        const g = await guilfordCounty();
        if (g) { cache.set(key, { t: Date.now(), data: g }); return res.status(200).json(g); }
      } catch (e) {}
    }
    if (!county || county.indexOf("WAKE") === 0) {
      try {
        const wk = await wakeCounty();
        if (wk) { cache.set(key, { t: Date.now(), data: wk }); return res.status(200).json(wk); }
      } catch (e) {}
    }
    let where = "UPPER(SITEADD) LIKE '" + street.replace(/'/g, "''") + "%'";
    if (county) where += " AND UPPER(CNTYNAME) LIKE '" + county + "%'";
    const url = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0/query" +
      "?where=" + encodeURIComponent(where) +
      "&outFields=SITEADD,CNTYNAME,SOURCEREF,LEGDECFULL,SOURCEDATX,PARUSEDESC,LANDVAL,IMPROVVAL,PARVAL,SALEDATE,SALEDATETX,STRUCTYEAR&resultRecordCount=3&f=json";
    const r = await fetch(url, { headers: { "User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com" } });
    if (!r.ok) return res.status(502).json({ error: "parcel service unavailable", upstream: r.status });
    const j = await r.json();
    const feats = j.features || [];
    if (!feats.length) return res.status(404).json({ error: "no parcel matched that address" });
    const a = feats[0].attributes || {};
    const ref = pick(a, "sourceref") || "";
    const m = ref.match(/(\d{2,6})\s*[\/\\, -]\s*0*(\d{1,6})/);
    const out = {
      county: pick(a, "cntyname"),
      siteAddress: pick(a, "sitead") || pick(a, "siteadd"),
      sourceRef: ref || null,
      book: m ? m[1].replace(/^0+(?=\d)/, "") : null,
      page: m ? m[2] : null,
      legal: pick(a, "legdecfull") || null,
      // normalized: Wake already answers in ISO and the statewide layer answers M/D/Y,
      // and a consumer that feeds this straight into a date input needs one shape
      recorded: dateOf(pick(a, "sourcedatx")) || pick(a, "sourcedatx") || null,
      use: pick(a, "parusedesc") || null,
      assessed: assessedFrom(pick(a, "landval"), pick(a, "improvval"), pick(a, "parval"),
                             null, pick(a, "saledate") || pick(a, "saledatetx"),
                             null, null, pick(a, "structyear"),
                             (pick(a, "cntyname") || "County") + " assessor, via NC OneMap"),
      source: "NC OneMap statewide parcels (county GIS records)"
    };
    cache.set(key, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "parcel service unavailable" });
  }
}
