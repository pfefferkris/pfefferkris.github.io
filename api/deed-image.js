// /api/deed-image — streams the scanned deed page from a county Register of Deeds
// public imaging system, so the guide can display the actual recorded document.
//
// The county (Logan Systems Blazor viewer) generates /PDFs/{book}{page}.pdf files
// ON DEMAND when someone views a document, and purges them later. So this function:
//   1. tries the direct public file first (fast path, also served by the CDN cache),
//   2. if absent, drives the county's own public viewer headlessly to regenerate it,
//      exactly as a citizen clicking "View Pages" would, then streams the result.
// Public records, education use, served with attribution by the guide.

const COUNTIES = {
  "CUMBERLAND": { base: "https://www.ccrodinternet.org/", loganBlazor: true }
};

const UA = "Mozilla/5.0 (kpfeffer.com education viewer; contact mail@kpfeffer.com)";

async function tryDirect(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500 || buf.slice(0, 5).toString() !== "%PDF-") return null;
    return buf;
  } catch (e) { return null; }
}

// Drive the county's public Logan/Blazor imaging viewer to make it generate the PDF.
async function generateViaViewer(base, book, page) {
  const chromium = (await import("@sparticuz/chromium")).default;
  const { chromium: pw } = await import("playwright-core");
  const br = await pw.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true
  });
  try {
    const pg = await br.newPage({ userAgent: UA });
    await pg.goto(base + "Imaging", { waitUntil: "load", timeout: 25000 });
    // welcome screen -> the imaging form
    await pg.getByRole("button", { name: "Imaging System Only" }).click({ timeout: 20000 });
    const bookBox = pg.getByRole("textbox", { name: "Book", exact: true });
    await bookBox.waitFor({ timeout: 20000 });
    // books 10000+ live in the "Deed 10000" image set; older books in "Deed"
    if (parseInt(book, 10) >= 10000) {
      await pg.getByRole("combobox", { name: "Image Set" }).click({ timeout: 10000 });
      await pg.getByRole("option", { name: "Deed 10000" }).click({ timeout: 10000 });
    }
    await bookBox.fill(book);
    await pg.getByRole("textbox", { name: "Page", exact: true }).fill(page);
    const waitPdf = pg.waitForResponse(
      r => r.url().indexOf("/PDFs/") >= 0 && r.ok(),
      { timeout: 35000 }
    );
    await pg.getByRole("button", { name: "View Pages" }).click({ timeout: 10000 });
    const resp = await waitPdf;
    try {
      const body = await resp.body();
      if (body && body.length > 500) return body;
    } catch (e) { /* fall through to refetch */ }
    const url = resp.url();
    await br.close();
    return await tryDirect(url);
  } finally {
    try { await br.close(); } catch (e) {}
  }
}

export default async function handler(req, res) {
  const county = (req.query.county || "").toString().trim().toUpperCase();
  const book = (req.query.book || "").toString().replace(/[^0-9]/g, "").slice(0, 6);
  const page = (req.query.page || "").toString().replace(/[^0-9]/g, "").slice(0, 5);
  const n = Math.min(30, Math.max(1, parseInt(req.query.n, 10) || 1));

  const c = COUNTIES[county];
  if (!c) return res.status(404).json({ error: "no imaging integration for that county yet" });
  if (!book || !page) return res.status(400).json({ error: "book and page required" });

  const stem = book + page.padStart(4, "0");
  // whole-document file first, then the suffixed variant the viewer sometimes writes
  const candidates = n > 1 ? [stem + "_" + n + ".pdf"] : [stem + ".pdf", stem + "_1.pdf"];

  const send = buf => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
    res.setHeader("Content-Disposition", "inline; filename=deed-" + book + "-" + page + ".pdf");
    return res.status(200).send(buf);
  };

  for (const f of candidates) {
    const buf = await tryDirect(c.base + "PDFs/" + f);
    if (buf) return send(buf);
  }
  if (n > 1) return res.status(404).json({ error: "no image at that book and page" });

  if (c.loganBlazor) {
    try {
      const buf = await generateViaViewer(c.base, book, page);
      if (buf) return send(buf);
    } catch (e) {
      return res.status(404).json({ error: "no image at that book and page", detail: String(e && e.message || e).slice(0, 160) });
    }
  }
  return res.status(404).json({ error: "no image at that book and page" });
}
