// /api/home-value — Vercel serverless function
// Proxies a single address to the Rentcast AVM so the API key never reaches the browser.
// Env var required (set in Vercel project settings): RENTCAST_API_KEY
// Rentcast free tier is about 50 calls per month; the tiny cache below stretches it.

const cache = new Map(); // per warm instance, address -> {t, data}
const TTL = 1000 * 60 * 60 * 24; // 24 hours

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
      "https://api.rentcast.io/v1/avm/value?address=" + encodeURIComponent(address),
      { headers: { "X-Api-Key": key, Accept: "application/json" } }
    );
    if (!r.ok) { const body = await r.text(); console.log("rentcast", r.status, body.slice(0,300)); return res.status(502).json({ error: "valuation service unavailable", upstream: r.status }); }
    const d = await r.json();
    const out = {
      price: d.price ?? null,
      low: d.priceRangeLow ?? null,
      high: d.priceRangeHigh ?? null,
      source: "Rentcast AVM",
    };
    if (!out.price) return res.status(404).json({ error: "no estimate for that address" });
    cache.set(k, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "valuation service unavailable" });
  }
}
