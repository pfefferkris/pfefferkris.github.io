// /api/search — live symbol lookup across U.S. listings, for the Grow analysis picker.
// Proxies Yahoo Finance search so a visitor can type any company name or ticker and
// find the real listing. Nothing the visitor types is stored.

const cache = new Map();
const TTL = 1000 * 60 * 60;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");

  const q = (req.query.q || "").toString().trim().slice(0, 40);
  if (q.length < 2) return res.status(400).json({ error: "type at least two characters" });

  const k = q.toLowerCase();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  try {
    const r = await fetch(
      "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(q) +
      "&quotesCount=8&newsCount=0&listsCount=0",
      { headers: { "User-Agent": "Mozilla/5.0 (kpfeffer.com education proxy; contact mail@kpfeffer.com)" } }
    );
    if (!r.ok) return res.status(502).json({ error: "search unavailable", upstream: r.status });
    const j = await r.json();
    const results = (j.quotes || [])
      .filter(x => (x.quoteType === "EQUITY" || x.quoteType === "ETF" || x.quoteType === "MUTUALFUND") && x.symbol)
      .map(x => ({ symbol: x.symbol, name: (x.shortname || x.longname || x.symbol) + (x.quoteType === "ETF" ? " (fund)" : x.quoteType === "MUTUALFUND" ? " (mutual fund)" : "") }))
      .slice(0, 8);
    const out = { results };
    cache.set(k, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "search unavailable" });
  }
}
