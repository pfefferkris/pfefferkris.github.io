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

  try {
    let where = "UPPER(SITEADD) LIKE '" + street.replace(/'/g, "''") + "%'";
    if (county) where += " AND UPPER(CNTYNAME) LIKE '" + county + "%'";
    const url = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0/query" +
      "?where=" + encodeURIComponent(where) +
      "&outFields=SITEADD,CNTYNAME,SOURCEREF,LEGDECFULL,SOURCEDATX,PARUSEDESC&resultRecordCount=3&f=json";
    const r = await fetch(url, { headers: { "User-Agent": "kpfeffer.com education proxy; contact mail@kpfeffer.com" } });
    if (!r.ok) return res.status(502).json({ error: "parcel service unavailable", upstream: r.status });
    const j = await r.json();
    const feats = j.features || [];
    if (!feats.length) return res.status(404).json({ error: "no parcel matched that address" });
    const a = feats[0].attributes || {};
    const ref = pick(a, "sourceref") || "";
    const m = ref.match(/(\d{2,6})\s*[\/\\ -]\s*0*(\d{1,6})/);
    const out = {
      county: pick(a, "cntyname"),
      siteAddress: pick(a, "sitead") || pick(a, "siteadd"),
      sourceRef: ref || null,
      book: m ? m[1] : null,
      page: m ? m[2] : null,
      legal: pick(a, "legdecfull") || null,
      recorded: pick(a, "sourcedatx") || null,
      use: pick(a, "parusedesc") || null,
      source: "NC OneMap statewide parcels (county GIS records)"
    };
    cache.set(key, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "parcel service unavailable" });
  }
}
