// /api/comps — the sales comparison grid, built entirely from public records.
//
// WHY THIS IS NOT AN MLS PRODUCT, DELIBERATELY.
//
// An IDX feed would be the obvious source and it is the wrong one. NAR's IDX policy says a
// participant "may not use IDX-provided listings for any purpose other than IDX display,"
// the MLSs serving North Carolina adopt that verbatim, Doorify's rules say in terms that
// "no display of Closed listing data may be identified as a CMA, comparable market
// analysis, broker price opinion, or appraisal," and every MLS requires non-MLS data to be
// "clearly separated" from MLS data rather than fused into one row — which is precisely
// what a comparison grid does. Valuation use of MLS data exists as a separate licensed
// feed scoped to "clients and customers," not to anonymous visitors.
//
// County records carry no such limit. N.C. Gen. Stat. 132-1(b) makes public records "the
// property of the people," and 132-10, which lets a county restrict commercial resale of
// GIS data, expressly carves out "use of information without resale by a licensed
// professional in the course of practicing the professional's profession."
//
// WHAT THIS IS NOT. Not an appraisal, not a CMA, not a broker price opinion, not a
// valuation. Under N.C.G.S. 93A-83(f) a broker's comparison "shall not under any
// circumstances be referred to as a valuation or appraisal," and an estimate of value
// rather than price "shall be deemed to be an appraisal." So this returns no conclusion of
// value and no adjustments. It returns the same rows an appraiser lines up before the
// adjusting starts, and says out loud that the adjusting has not happened — because a grid
// of unadjusted comparables presented as if it were finished is not neutral, it is
// misleading, and that is its own problem under 93A-6(a)(1).
//
// Owner names are never returned.

const cache = new Map();
const TTL = 1000 * 60 * 60 * 6;
const UA = { "User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com" };

const NCPTS = ["beaufort", "burke", "forsyth", "guilford", "henderson", "hertford",
               "hyde", "madison", "pitt", "rutherford", "stokes"];

const ONEMAP = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0/query";
const WAKE = "https://maps.wake.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query";
const MECK = "https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcel_camadata/MapServer/0/query";
const MECK_H = { Referer: "https://meckgis.mecklenburgcountync.gov/" };

const SUFFIX = new Set(["ST","STREET","DR","DRIVE","RD","ROAD","AVE","AVENUE","LN","LANE","CT","COURT",
  "CIR","CIRCLE","BLVD","BOULEVARD","WAY","PL","PLACE","TRL","TRAIL","PKWY","PARKWAY","HWY","HIGHWAY",
  "TER","TERRACE","LOOP","RUN","XING","CROSSING","SQ","SQUARE"]);
function streetOf(raw) {
  const full = String(raw || "").split(",")[0].toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const t = full.split(" ").filter(Boolean);
  while (t.length > 2 && SUFFIX.has(t[t.length - 1])) t.pop();
  return t.join(" ");
}
// A field that is present but blank is not a value. Mecklenburg writes a single space into
// its non-arms-length reason for every ordinary sale, and " " is truthy, which quietly threw
// away every comparable in the county.
function str(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
}
function num(v) {
  const x = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  return typeof x === "number" && isFinite(x) && x !== 0 ? x : null;
}
function iso(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") { const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
async function getJson(url, headers, body) {
  const opt = { headers: Object.assign({}, UA, headers || {}) };
  if (body !== undefined) { opt.method = "POST"; opt.headers["Content-Type"] = "application/json";
                            opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error("upstream " + r.status);
  return r.json();
}
function q(base, params, headers) {
  const u = base + "?" + Object.keys(params).map(k => k + "=" + encodeURIComponent(params[k])).join("&") + "&f=json";
  return getJson(u, headers);
}
// the middle of a parcel, good enough to measure a neighbourhood by
function centroid(geom) {
  if (!geom) return null;
  if (geom.x !== undefined && geom.y !== undefined) return { x: geom.x, y: geom.y };
  const rings = geom.rings || geom.paths;
  if (!rings || !rings.length) return null;
  let sx = 0, sy = 0, n = 0;
  rings[0].forEach(p => { sx += p[0]; sy += p[1]; n++; });
  return n ? { x: sx / n, y: sy / n } : null;
}
function milesBetween(a, b) {
  if (!a || !b) return null;
  const R = 3958.8, d2r = Math.PI / 180;
  const dLat = (b.y - a.y) * d2r, dLon = (b.x - a.x) * d2r;
  const la1 = a.y * d2r, la2 = b.y * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(h)) * 100) / 100;
}
const NOT_ARMS = /QUIT ?CLAIM|TRUSTEE|SUBSTITUTE|FORECLOS|EXECUTOR|ADMINISTRAT|ESTATE|GIFT|TAX DEED|SHERIFF|COMMISSIONER|CORRECT|DIVORCE|SEPARAT/i;
function yearsAgo(dateIso) {
  if (!dateIso) return null;
  const d = new Date(dateIso + "T00:00:00Z");
  if (isNaN(d)) return null;
  return (Date.now() - d.getTime()) / (365.2425 * 86400000);
}

/* THE SCHOOL ZONE, WHICH IS WHERE PRICE BANDS ACTUALLY LIVE.
   A broker running comparables starts inside the elementary attendance area and widens to
   middle and then high, because school assignment is what turns a set of streets into a
   market: buyers self select into it, and the boundary shows up in the prices whether or
   not anyone can see it on a map. Very few North Carolina districts publish their
   attendance boundaries as data. Charlotte-Mecklenburg does, at all three levels. Where
   nobody publishes, the nearest public school is the honest fallback and the page says so
   rather than implying an assignment it does not know. */
const CMS = "https://meckgis.mecklenburgcountync.gov/server/rest/services/";
async function schoolZone(county, c) {
  if (!c) return null;
  const pt = JSON.stringify({ x: c.x, y: c.y, spatialReference: { wkid: 4326 } });
  const base = { geometry: pt, geometryType: "esriGeometryPoint", inSR: "4326",
                 spatialRel: "esriSpatialRelIntersects", where: "1=1",
                 returnGeometry: "false", resultRecordCount: "1" };
  if (String(county || "").toUpperCase().indexOf("MECKLENBURG") === 0) {
    const want = [["CMSElementarySchoolDistricts", "elem_name", "elementary"],
                  ["CMSMiddleSchoolDistricts", "middle_nam,mid_name,middle_name", "middle"],
                  ["CMSHighSchoolDistricts", "high_name,hs_name", "high"]];
    const out = { source: "Charlotte-Mecklenburg Schools attendance boundaries", assigned: true };
    for (const [svc, fields, level] of want) {
      try {
        const j = await q(CMS + svc + "/MapServer/0/query",
          Object.assign({}, base, { outFields: "*" }), MECK_H);
        const a = ((j.features || [])[0] || {}).attributes || {};
        const key = Object.keys(a).find(k => /name/i.test(k) && str(a[k]));
        if (key) out[level] = str(a[key]);
      } catch (e) {}
    }
    return (out.elementary || out.middle || out.high) ? out : null;
  }
  // statewide: the school points layer, nearest one, clearly labelled as proximity
  try {
    const j = await q("https://services.nconemap.gov/secure/rest/services/NC1Map_Education/MapServer/3/query",
      { geometry: pt, geometryType: "esriGeometryPoint", inSR: "4326", distance: "26400",
        units: "esriSRUnit_Foot", spatialRel: "esriSpatialRelIntersects", where: "1=1",
        outFields: "*", returnGeometry: "true", outSR: "4326", resultRecordCount: "60" });
    const rows = (j.features || []).map(f => {
      const a = {};
      Object.keys(f.attributes).forEach(k => { a[k.toLowerCase()] = f.attributes[k]; });
      return { name: str(a.school_nam) || str(a.name) || str(a.schoolname),
               kind: str(a.type) || str(a.grades) || str(a.level) || str(a.lea_school) || null,
               miles: milesBetween(c, centroid(f.geometry)) };
    }).filter(x => x.name && x.miles !== null).sort((x, y) => x.miles - y.miles);
    if (!rows.length) return null;
    return { source: "NC OneMap public schools, nearest by distance",
             assigned: false, nearest: rows.slice(0, 3) };
  } catch (e) { return null; }
}

/* ---------------- subject + neighbours, per source ---------------- */

async function wakeSet(street, radiusFt) {
  const s = await q(WAKE, {
    where: "SITE_ADDRESS LIKE '" + street.replace(/'/g, "''") + "%'",
    outFields: "SITE_ADDRESS,PIN_NUM,HEATEDAREA,YEAR_BUILT,TOTSALPRICE,SALE_DATE,TOTAL_VALUE_ASSD," +
               "LAND_VAL,BLDG_VAL,TYPE_USE_DECODE,DESIGN_STYLE_DECODE,TOTUNITS,DEED_ACRES,TOTSTRUCTS",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "1"
  });
  const f = (s.features || [])[0];
  if (!f) return null;
  const c = centroid(f.geometry);
  const subj = wakeRow(f.attributes, c, c);
  if (!c) return { subject: subj, comps: [] };
  const nb = await q(WAKE, {
    geometry: JSON.stringify({ x: c.x, y: c.y, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", inSR: "4326", distance: String(radiusFt),
    units: "esriSRUnit_Foot", spatialRel: "esriSpatialRelIntersects",
    where: "TOTSALPRICE > 1000 AND HEATEDAREA > 200",
    outFields: "SITE_ADDRESS,PIN_NUM,HEATEDAREA,YEAR_BUILT,TOTSALPRICE,SALE_DATE,TOTAL_VALUE_ASSD," +
               "LAND_VAL,BLDG_VAL,TYPE_USE_DECODE,DESIGN_STYLE_DECODE,TOTUNITS,DEED_ACRES,TOTSTRUCTS",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "400"
  });
  const comps = (nb.features || []).map(x => wakeRow(x.attributes, centroid(x.geometry), c));
  return { subject: subj, comps: comps, origin: c,
           source: "Wake County parcel record (the county's own GIS)" };
}
function wakeRow(a, c, origin) {
  return {
    address: str(a.SITE_ADDRESS), pin: str(a.PIN_NUM),
    heatedArea: num(a.HEATEDAREA), yearBuilt: num(a.YEAR_BUILT),
    structures: num(a.TOTSTRUCTS),
    units: num(a.TOTUNITS), acres: num(a.DEED_ACRES),
    use: str(a.TYPE_USE_DECODE), style: str(a.DESIGN_STYLE_DECODE),
    salePrice: num(a.TOTSALPRICE), saleDate: iso(a.SALE_DATE),
    assessed: num(a.TOTAL_VALUE_ASSD), land: num(a.LAND_VAL), building: num(a.BLDG_VAL),
    miles: milesBetween(origin, c)
  };
}

async function meckSet(street, radiusFt) {
  const F = "address,pid,heatedarea,saleprice,saledate,totalvalue,totlandval,totalbldgval," +
            "landuse_description,legalacres,naldesc,neighbordesc";
  const BOUND = "https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcelBoundaries/MapServer/0/query";
  const s = await q(MECK, { where: "UPPER(address) LIKE '" + street.replace(/'/g, "''") + "%'",
    outFields: F, returnGeometry: "false", resultRecordCount: "1" }, MECK_H);
  const f = (s.features || [])[0];
  if (!f) return null;
  const pid = f.attributes.pid;
  const subj = meckRow(f.attributes, null, null);
  // the shape lives in a different layer, keyed by the same parcel id
  const g = await q(BOUND, { where: "pid='" + String(pid).replace(/'/g, "") + "'", outFields: "pid",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "1" }, MECK_H).catch(() => null);
  const c = centroid(((g || {}).features || [])[0] && g.features[0].geometry);
  if (!c) return { subject: subj, comps: [],
                   source: "Mecklenburg County CAMA parcel data (the county's own GIS)" };
  const nb = await q(BOUND, {
    geometry: JSON.stringify({ x: c.x, y: c.y, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", inSR: "4326", distance: String(radiusFt),
    units: "esriSRUnit_Foot", spatialRel: "esriSpatialRelIntersects", where: "1=1",
    outFields: "pid", returnGeometry: "true", outSR: "4326", resultRecordCount: "300"
  }, MECK_H);
  const where = {};
  (nb.features || []).forEach(x => {
    const id = x.attributes.pid;
    if (id && id !== pid) where[id] = centroid(x.geometry);
  });
  const ids = Object.keys(where).slice(0, 240);
  if (!ids.length) return { subject: subj, comps: [],
                            source: "Mecklenburg County CAMA parcel data (the county's own GIS)" };
  // Mecklenburg keeps the price in a third place again: the CAMA table often carries no
  // sale at all, and the transfer history lives in TaxParcelSales with the county's own
  // judgement on whether each one was arm's length.
  const SALES = "https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcelSales/MapServer/0/query";
  const comps = [];
  const byPid = {};
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80).map(x => "'" + x.replace(/'/g, "") + "'").join(",");
    const r = await q(MECK, { where: "pid IN (" + chunk + ")", outFields: F,
      returnGeometry: "false", resultRecordCount: "80" }, MECK_H).catch(() => null);
    ((r || {}).features || []).forEach(x => {
      const row = meckRow(x.attributes, where[x.attributes.pid], c);
      byPid[x.attributes.pid] = row; comps.push(row);
    });
    const sv = await q(SALES, { where: "parcelid IN (" + chunk + ") AND saleprice > 1000",
      outFields: "parcelid,saleprice,saledate,deeddescription,naldesc",
      returnGeometry: "false", resultRecordCount: "300" }, MECK_H).catch(() => null);
    ((sv || {}).features || []).map(x => x.attributes)
      .sort((x, y) => (x.saledate || 0) - (y.saledate || 0))     // newest last, so it wins
      .forEach(a => {
        const row = byPid[a.parcelid];
        if (!row) return;
        row.salePrice = num(a.saleprice); row.saleDate = iso(a.saledate);
        row.deedType = str(a.deeddescription);
        const nal = str(a.naldesc), dd = str(a.deeddescription);
        if (nal) row.notArms = nal;
        else if (dd && NOT_ARMS.test(dd)) row.notArms = dd;
        else row.notArms = null;
      });
  }
  // the subject's own last sale, same place
  const ssv = await q(SALES, { where: "parcelid='" + String(pid).replace(/'/g, "") + "'",
    outFields: "parcelid,saleprice,saledate,deeddescription", returnGeometry: "false",
    resultRecordCount: "12" }, MECK_H).catch(() => null);
  const mine = (((ssv || {}).features || []).map(x => x.attributes)
    .filter(a => num(a.saleprice)).sort((x, y) => (y.saledate || 0) - (x.saledate || 0)))[0];
  if (mine) { subj.salePrice = num(mine.saleprice); subj.saleDate = iso(mine.saledate); }
  return { subject: subj, comps: comps, origin: c,
           source: "Mecklenburg County CAMA parcel data (the county's own GIS)" };
}
function meckRow(a, c, origin) {
  return {
    address: str(a.address), pin: str(a.pid),
    heatedArea: num(a.heatedarea), yearBuilt: null,
    acres: num(a.legalacres), use: str(a.landuse_description),
    neighborhood: str(a.neighbordesc),
    salePrice: num(a.saleprice), saleDate: iso(a.saledate),
    assessed: num(a.totalvalue), land: num(a.totlandval), building: num(a.totalbldgval),
    notArms: str(a.naldesc), miles: milesBetween(origin, c)
  };
}

/* Statewide: the parcel layer knows where everything is and what the assessor thinks it is
   worth, but not what it sold for. In the eleven counties on the shared tax platform the
   price can be fetched per parcel, so the neighbours are found spatially and then priced
   one at a time, capped so a page load cannot turn into a crawl. */
async function stateSet(street, city, county, radiusFt, tenant) {
  let where = "UPPER(SITEADD) LIKE '" + street.replace(/'/g, "''") + "%'";
  if (county) where += " AND UPPER(CNTYNAME) LIKE '" + county.toUpperCase() + "%'";
  else if (city) where += " AND UPPER(SCITY) LIKE '" + city.replace(/'/g, "''") + "%'";
  let s = await q(ONEMAP, { where: where, outFields: "SITEADD,SCITY,CNTYNAME,PARNO,LANDVAL,IMPROVVAL,PARVAL,STRUCTYEAR,PARUSEDESC,GISACRES",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "1" });
  let f = (s.features || [])[0];
  if (!f && tenant) {
    // Nine counties publish no site address statewide. Find the parcel through the tax
    // platform instead, then locate it by its parcel number.
    const hit = await getJson("https://lrcpwa.ncptscloud.com/api/SimpleParcelSearch?query=" +
      encodeURIComponent(street) + "&pageIndex=0&pageSize=1", { "X-Tenant": tenant }).catch(() => null);
    const pin = hit && (hit.results || [])[0] && (hit.results[0].formattedPin || "").replace(/[^0-9]/g, "");
    if (pin) {
      s = await q(ONEMAP, { where: "PARNO LIKE '" + pin + "%'",
        outFields: "SITEADD,SCITY,CNTYNAME,PARNO,LANDVAL,IMPROVVAL,PARVAL,STRUCTYEAR,PARUSEDESC,GISACRES",
        returnGeometry: "true", outSR: "4326", resultRecordCount: "1" }).catch(() => ({}));
      f = (s.features || [])[0];
    }
  }
  if (!f) return null;
  const c = centroid(f.geometry);
  const subj = stateRow(f.attributes, c, c);
  if (!c) return { subject: subj, comps: [] };
  const nb = await q(ONEMAP, {
    geometry: JSON.stringify({ x: c.x, y: c.y, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint", inSR: "4326", distance: String(radiusFt),
    units: "esriSRUnit_Foot", spatialRel: "esriSpatialRelIntersects",
    where: "improvval > 1000",
    outFields: "SITEADD,SCITY,CNTYNAME,PARNO,LANDVAL,IMPROVVAL,PARVAL,STRUCTYEAR,PARUSEDESC,GISACRES",
    returnGeometry: "true", outSR: "4326", resultRecordCount: "300"
  });
  let comps = (nb.features || []).map(x => stateRow(x.attributes, centroid(x.geometry), c));
  let priced = false;
  if (tenant) {
    const pick = comps.filter(x => x.pin).slice(0, 14);
    const H = { "X-Tenant": tenant };
    const got = await Promise.all(pick.map(row =>
      getJson("https://lrcpwa.ncptscloud.com/api/GetParcelDetailsByQueryParam", H,
        { searchKey: "pin", searchValue: String(row.pin).replace(/[^0-9]/g, "") })
        .then(d => ({ row, d })).catch(() => null)));
    got.filter(Boolean).forEach(({ row, d }) => {
      const b = (d.buildings || [])[0] || {};
      row.heatedArea = num(b.heatedArea) || num(d.heatedArea);
      row.bedrooms = num(b.bedrooms);
      row.baths = num(b.totalFixtures) ? b.totalFixtures + " fixtures" : null;
      row.yearBuilt = num(b.yearBuilt) || row.yearBuilt;
      row.style = str(b.style);
      row.grade = str(b.grade);
      row.condition = str(b.condition);
      row.exterior = str(b.exterior);
      row.address = d.formattedPhysicalAddress || row.address;
      row.assessed = num(d.totalPropertyValue) || row.assessed;
      const deed = (d.deeds || []).slice().sort((x, y) =>
        String(y.deedDate || "").localeCompare(String(x.deedDate || "")))[0];
      if (deed) {
        const stamps = num(deed.revenueStamps);
        row.salePrice = num(deed.salePrice) || (stamps ? stamps * 500 : null);
        row.stamps = stamps; row.saleDate = iso(deed.deedDate); row.deedType = str(deed.deedType);
        if (deed.deedType && NOT_ARMS.test(deed.deedType)) row.notArms = deed.deedType;
      }
      priced = true;
    });
    // and the subject itself
    if (subj.pin) {
      const d = await getJson("https://lrcpwa.ncptscloud.com/api/GetParcelDetailsByQueryParam", H,
        { searchKey: "pin", searchValue: String(subj.pin).replace(/[^0-9]/g, "") }).catch(() => null);
      if (d) {
        const b = (d.buildings || [])[0] || {};
        subj.heatedArea = num(b.heatedArea) || num(d.heatedArea);
        subj.bedrooms = num(b.bedrooms);
        subj.yearBuilt = num(b.yearBuilt) || subj.yearBuilt;
        subj.style = b.style || null; subj.grade = b.grade || null;
        subj.condition = b.condition || null; subj.exterior = b.exterior || null;
        subj.address = d.formattedPhysicalAddress || subj.address;
        subj.assessed = num(d.totalPropertyValue) || subj.assessed;
      }
    }
    comps = comps.filter(x => x.salePrice || x.heatedArea);
  }
  return { subject: subj, comps: comps, origin: c,
           source: tenant
             ? "NC OneMap statewide parcels for location, the shared NCPTS assessor platform for detail"
             : "NC OneMap statewide parcels (county GIS records)",
           priced: priced };
}
function stateRow(a, c, origin) {
  const at = {};
  Object.keys(a).forEach(k => { at[k.toLowerCase()] = a[k]; });
  return {
    address: str(at.siteadd), pin: str(at.parno), city: str(at.scity),
    county: at.cntyname || null, heatedArea: null, yearBuilt: num(at.structyear),
    acres: num(at.gisacres), use: str(at.parusedesc),
    salePrice: null, saleDate: null,
    assessed: num(at.parval) || ((num(at.landval) || 0) + (num(at.improvval) || 0)) || null,
    land: num(at.landval), building: num(at.improvval),
    miles: milesBetween(origin, c)
  };
}

/* ---------------- pick the ones that are actually comparable ---------------- */
function score(subject, row) {
  let s = 0;
  if (row.miles !== null) s += row.miles * 40;                    // distance dominates, as it should
  if (subject.heatedArea && row.heatedArea) {
    s += Math.abs(row.heatedArea - subject.heatedArea) / subject.heatedArea * 60;
  } else s += 12;
  if (subject.yearBuilt && row.yearBuilt) s += Math.abs(row.yearBuilt - subject.yearBuilt) / 12;
  else s += 4;
  const age = yearsAgo(row.saleDate);
  if (age !== null) s += age * 3;                                 // a stale sale is a weak sale
  else s += 15;
  if (subject.use && row.use && subject.use !== row.use) s += 25;
  return s;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");

  const street = streetOf(req.query.address);
  const city = (req.query.address || "").toString().split(",")[1] || "";
  const cityU = city.toUpperCase().replace(/[^A-Z ]/g, "").trim();
  const county = (req.query.county || "").toString().toUpperCase().replace(/[^A-Z ]/g, "").slice(0, 30);
  if (street.length < 5 || !/^\d/.test(street)) {
    return res.status(400).json({ error: "send a street address with a number" });
  }
  const key = [street, cityU, county].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  try {
    const C = county;
    const tenant = NCPTS.find(x => C.indexOf(x.toUpperCase()) === 0) || null;
    let set = null;
    /* A broker starts small and widens: a quarter mile, then a half, then a mile, then two.
       Widening is not free, and the page reports how far it had to go. */
    for (const radius of [1320, 2640, 5280, 10560]) {
      // a wider ring that fails must not throw away the narrower one that worked
      let got = null;
      if (C.indexOf("WAKE") === 0) got = await wakeSet(street, radius).catch(() => null);
      else if (C.indexOf("MECKLENBURG") === 0) got = await meckSet(street, radius).catch(() => null);
      else got = await stateSet(street, cityU, C, radius, tenant).catch(() => null);
      if (got) { got.radiusFeet = radius; set = got; }
      else if (set) break;
      const usable = set ? (set.comps || []).filter(r => r.salePrice && r.heatedArea).length : 0;
      if (usable >= 5) break;
      if (radius === 10560) break;
      if (!set) break;
    }
    if (!set) return res.status(404).json({ error: "no parcel matched that address" });

    const subject = set.subject;
    let out_band = null;
    let comps = (set.comps || [])
      .filter(r => r.pin !== subject.pin && r.address !== subject.address)
      .filter(r => !r.notArms)
      .filter(r => !r.salePrice || r.salePrice > 5000);
    /* Selection, in the order a broker actually applies it: square footage first, because a
       house of the wrong size is not the same product; then bedroom count; and only then
       everything else. The size band tightens to ten percent and loosens only when that
       leaves too few to be worth showing. */
    let band = null;
    if (subject.heatedArea) {
      for (const tol of [0.10, 0.20, 0.30, 0.45]) {
        const t = comps.filter(r => r.heatedArea &&
          Math.abs(r.heatedArea - subject.heatedArea) <= subject.heatedArea * tol);
        if (t.filter(r => r.salePrice).length >= 3 || tol === 0.45) { band = { tol: tol, rows: t }; break; }
      }
      if (band && band.rows.length >= 3) comps = band.rows;
    }
    if (subject.bedrooms) {
      const bd = comps.filter(r => !r.bedrooms || Math.abs(r.bedrooms - subject.bedrooms) <= 1);
      if (bd.filter(r => r.salePrice).length >= 3) comps = bd;
    }
    comps.sort((a, b) => score(subject, a) - score(subject, b));
    /* Three to five. More than five is not more rigour, it is a wider net catching worse
       fish, and every one you add is one you matched less well than the one before. */
    comps = comps.filter(r => r.salePrice && r.heatedArea).slice(0, 5)
      .concat(comps.filter(r => !(r.salePrice && r.heatedArea)).slice(0, 0));
    if (comps.length < 3) {
      comps = (set.comps || []).filter(r => r.pin !== subject.pin && !r.notArms)
        .sort((a, b) => score(subject, a) - score(subject, b)).slice(0, 5);
    }
    if (band) out_band = band.tol;
    comps.forEach(r => {
      if (r.salePrice && r.heatedArea) r.pricePerFoot = Math.round(r.salePrice / r.heatedArea);
      if (r.assessed && r.heatedArea) r.assessedPerFoot = Math.round(r.assessed / r.heatedArea);
    });
    if (subject.assessed && subject.heatedArea) {
      subject.assessedPerFoot = Math.round(subject.assessed / subject.heatedArea);
    }

    const sold = comps.filter(r => r.pricePerFoot);
    let range = null;
    if (sold.length >= 3) {
      const v = sold.map(r => r.pricePerFoot).sort((a, b) => a - b);
      range = { low: v[0], high: v[v.length - 1], middle: v[Math.floor(v.length / 2)], n: v.length };
    }

    const school = await schoolZone(subject.county || C, set.origin).catch(() => null);
    const out = {
      subject: subject, comps: comps, source: set.source,
      soldCount: sold.length, perFoot: range,
      school: school,
      searchMiles: set.radiusFeet ? Math.round((set.radiusFeet / 5280) * 100) / 100 : null,
      sizeBand: out_band ? Math.round(out_band * 100) : null,
      method: "Selected on square footage first, then bedroom count, then distance and how " +
              "recent the sale is. Three to five, never more: past five you are widening the " +
              "net rather than sharpening the match.",
      // the sentence that has to be on this, every time
      disclosure: "This is not an appraisal, a comparative market analysis, a broker price " +
        "opinion, or a valuation, and it reaches no conclusion of value. It is a list of what " +
        "nearby properties are recorded as having sold for, with the characteristics the county " +
        "assessor has on file, so you can read them yourself. NOTHING HERE IS ADJUSTED. An " +
        "appraiser would adjust every line for condition, updates, lot, view, date of sale and " +
        "terms before comparing anything, and those adjustments are the whole craft. Sale prices " +
        "come from recorded deeds; where a county publishes the excise stamp the price is the " +
        "stamp times 500 under N.C. Gen. Stat. 105-228.30.",
      excluded: "Transfers that were not sales — quitclaims, trustee's and executor's deeds, " +
        "gifts, transfers between family — are left out, because a comparable built on one is " +
        "worse than no comparable at all.",
      limits: []
    };
    if (!sold.length) out.limits.push("No recorded sale price came back for any neighbour" +
      (set.priced === false || /statewide/.test(out.source || "")
        ? ". This county publishes assessments to the statewide layer but not prices, so the only " +
          "comparison available here is what the assessor thinks each property is worth."
        : ". Either nothing nearby has changed hands, or every transfer that did was something " +
          "other than a sale.") );
    else if (sold.length < 3) out.limits.push("Only " + sold.length + " nearby sale" +
      (sold.length === 1 ? "" : "s") + " came back. Three is the conventional minimum and it is a " +
      "minimum, not a target.");
    if (!subject.heatedArea) out.limits.push("The county does not publish heated area for the " +
      "subject, so the rows could not be matched on size and price per foot is missing.");
    const stale = sold.filter(r => (yearsAgo(r.saleDate) || 0) > 3).length;
    if (sold.length && stale === sold.length) out.limits.push("Every sale shown is more than three " +
      "years old. A market moves; an old sale is a fact about a different market.");

    cache.set(key, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "comparable service unavailable" });
  }
}
