// /api/history — one year of daily closes for one symbol, for the Grow portfolio analysis.
// Same pattern as the Rentcast proxies: no key needed here, cached, education only.
// The guide computes log returns, covariance, beta, Sharpe, and Jensen's alpha in the browser;
// nothing the visitor enters is ever stored.

const cache = new Map();
const TTL = 1000 * 60 * 60 * 6;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate");

  const sym = (req.query.symbol || "").toString().trim().toUpperCase().slice(0, 12);
  if (!/^[A-Z0-9^.\-]{1,12}$/.test(sym)) {
    return res.status(400).json({ error: "bad symbol" });
  }

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.data);

  try {
    const r = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(sym) + "?range=1y&interval=1d",
      { headers: { "User-Agent": "Mozilla/5.0 (kpfeffer.com education proxy; contact mail@kpfeffer.com)" } }
    );
    if (!r.ok) {
      console.log("history", sym, r.status);
      return res.status(502).json({ error: "quote service unavailable", upstream: r.status });
    }
    const j = await r.json();
    const res0 = j.chart && j.chart.result && j.chart.result[0];
    if (!res0 || !res0.timestamp) return res.status(404).json({ error: "no data for symbol" });
    const ts = res0.timestamp;
    const q = res0.indicators.quote[0] || {};
    const cl = q.close || [];
    const points = ts.map((t, i) => [t, cl[i]]).filter(p => p[1] != null);
    if (points.length < 30) return res.status(404).json({ error: "not enough history" });
    // Open/high/low/close for the candlestick pane. Same request, no extra call upstream.
    // Rows where any leg is missing are dropped: a candle with a hole in it is worse than no candle.
    const op = q.open || [], hi = q.high || [], lo = q.low || [];
    const ohlc = ts
      .map((t, i) => [t, op[i], hi[i], lo[i], cl[i]])
      .filter(r => r[1] != null && r[2] != null && r[3] != null && r[4] != null);
    const out = { symbol: sym, currency: res0.meta.currency || null, points, ohlc };
    cache.set(sym, { t: Date.now(), data: out });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "quote service unavailable" });
  }
}
