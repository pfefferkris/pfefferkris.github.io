// /api/deed-image — streams the scanned deed page from a county Register of Deeds
// public imaging system, so the guide can display the actual recorded document.
// Currently wired for Logan Systems counties whose PDF path pattern is verified
// (Cumberland). Public records, education use, served with attribution by the guide.

const BASES = {
  "CUMBERLAND": "https://www.ccrodinternet.org/PDFs/"
};

export default async function handler(req, res) {
  const county = (req.query.county || "").toString().trim().toUpperCase();
  const book = (req.query.book || "").toString().replace(/[^0-9]/g, "").slice(0, 6);
  const page = (req.query.page || "").toString().replace(/[^0-9]/g, "").slice(0, 5);
  const n = Math.min(30, Math.max(1, parseInt(req.query.n, 10) || 1));

  const base = BASES[county];
  if (!base) return res.status(404).json({ error: "no imaging integration for that county yet" });
  if (!book || !page) return res.status(400).json({ error: "book and page required" });

  const file = book + page.padStart(4, "0") + "_" + n + ".pdf";
  try {
    const r = await fetch(base + file, {
      headers: { "User-Agent": "Mozilla/5.0 (kpfeffer.com education viewer; contact mail@kpfeffer.com)" }
    });
    if (!r.ok) return res.status(404).json({ error: "no image at that book and page", upstream: r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) return res.status(404).json({ error: "no image at that book and page" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
    res.setHeader("Content-Disposition", "inline; filename=deed-" + book + "-" + page + "-p" + n + ".pdf");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(502).json({ error: "county imaging system unavailable" });
  }
}
