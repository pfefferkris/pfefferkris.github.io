// /api/rent-estimate — Vercel serverless function
// What the market says this address rents for, so the equity guide can start a rent roll
// from a real number instead of the owner's memory of what the last tenant paid.
// Proxies the Rentcast long term rent AVM so the API key never reaches the browser.
// Same RENTCAST_API_KEY the value and record lookups use. Nothing the visitor types is
// stored: no logging of the address, no cookie, no analytics hop.

const cache = new Map(); // per warm instance, address -> {t, data}
const TTL = 1000 * 60 * 60 * 24; // 24 hours, which also stretches the free tier

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");

  const key = process.env.RENTCAST_API_KEY;
  if (!key) return res.status(503).json({ error: "lookup not configured" });

  const address = (req.query.address || "").toString().trim().slice(0, 200);
  if (address.length < 8 || !/\d/.test(address)) {
    return res.status(400).json({ error: "send a full street address" });
  }
  // Optional shape hints. A duplex asked about as a single family comes back wrong, and
  // the caller usually knows which it is because the record lookup just told it.
  const beds = Math.min(12, Math.max(0, parseInt(req.query.bedrooms, 10) || 0));
  const baths = Math.min(12, Math.max(0, parseFloat(req.query.bathrooms) || 0));

  const k = [address.toLowerCase(), beds, baths].join("|");
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  try {
    let u = "https://api.rentcast.io/v1/avm/rent/long-term?address=" + encodeURIComponent(address);
    if (beds) u += "&bedrooms=" + beds;
    if (baths) u += "&bathrooms=" + baths;
    const r = await fetch(u, { headers: { "X-Api-Key": key, Accept: "application/json" } });
    if (!r.ok) return res.status(502).json({ error: "rent service unavailable", upstream: r.status });
    const d = await r.json();
    const out = {
      rent: d.rent ?? null,
      low: d.rentRangeLow ?? null,
      high: d.rentRangeHigh ?? null,
      source: "Rentcast long term rent model",
    };
    if (!out.rent) return res.status(404).json({ error: "no rent estimate for that address" });
    cache.set(k, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "rent service unavailable" });
  }
}
