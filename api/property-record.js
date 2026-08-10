// /api/property-record — Vercel serverless function
// Pulls the public property record (last sale, year built, county) from Rentcast
// so the guide can find the owner's basis starting point instead of asking for it.
// Uses the same RENTCAST_API_KEY env var. Owner names are deliberately NOT returned.

const cache = new Map();
const TTL = 1000 * 60 * 60 * 24;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

  const key = process.env.RENTCAST_API_KEY;
  if (!key) return res.status(503).json({ error: "lookup not configured" });

  const address = (req.query.address || "").toString().trim().slice(0, 200);
  if (address.length < 8 || !/\d/.test(address)) {
    return res.status(400).json({ error: "send a full street address" });
  }

  const k = address.toLowerCase();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  try {
    const r = await fetch(
      "https://api.rentcast.io/v1/properties?address=" + encodeURIComponent(address),
      { headers: { "X-Api-Key": key, Accept: "application/json" } }
    );
    if (!r.ok) {
      const body = await r.text();
      console.log("rentcast-prop", r.status, body.slice(0, 300));
      return res.status(502).json({ error: "records service unavailable", upstream: r.status });
    }
    const arr = await r.json();
    const p = Array.isArray(arr) ? arr[0] : arr;
    if (!p) return res.status(404).json({ error: "no record for that address" });
    const out = {
      lastSaleDate: p.lastSaleDate ?? null,
      lastSalePrice: p.lastSalePrice ?? null,
      yearBuilt: p.yearBuilt ?? null,
      county: p.county ?? null,
      squareFootage: p.squareFootage ?? null,
      source: "Rentcast public property records",
    };
    cache.set(k, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "records service unavailable" });
  }
}
