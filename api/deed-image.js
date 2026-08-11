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
  // a container recycled from an older deployment can hold a half-extracted
  // /tmp/chromium without its shared libraries; sweep unless libnss3 is really there
  try {
    const fs = await import("fs");
    const hasNss = ["/tmp/al2023", "/tmp/lib", "/tmp/aws/lib"].some(d => {
      try { return fs.readdirSync(d).some(f => f.indexOf("libnss3") === 0); } catch (e) { return false; }
    });
    if (!hasNss) ["/tmp/chromium", "/tmp/al2023", "/tmp/lib", "/tmp/swiftshader"].forEach(p => {
      try { fs.rmSync(p, { force: true, recursive: true }); } catch (e) {}
    });
  } catch (e) {}
  // Vercel strips the AWS runtime env vars the package keys its library
  // extraction on; restore one so libnss3 and friends actually extract
  process.env["AWS_LAMBDA_JS_RUNTIME"] = process.env["AWS_LAMBDA_JS_RUNTIME"] || "nodejs22.x";
  const chromium = (await import("@sparticuz/chromium-min")).default;
  const puppeteer = await import("puppeteer-core");
  const br = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath("https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar"),
    headless: chromium.headless
  });
  try {
    const pg = await br.newPage();
    await pg.setUserAgent(UA);

    // capture the generated PDF the moment the viewer requests it
    let pdfUrl = null, pdfBuf = null;
    let resolvePdf; const pdfSeen = new Promise(ok => { resolvePdf = ok; });
    pg.on("response", async r => {
      if (r.url().indexOf("/PDFs/") >= 0 && r.status() === 200) {
        pdfUrl = r.url();
        try { const b = await r.buffer(); if (b && b.length > 500) pdfBuf = b; } catch (e) {}
        resolvePdf();
      }
    });

    await pg.goto(base + "Imaging", { waitUntil: "load", timeout: 25000 });
    // welcome screen -> the imaging form
    const enter = await pg.waitForSelector('::-p-aria([role="button"][name="Imaging System Only"])', { timeout: 20000 });
    await enter.click();
    const bookBox = await pg.waitForSelector('::-p-aria([role="textbox"][name="Book"])', { timeout: 20000 });
    // books 10000+ live in the "Deed 10000" image set; older books in "Deed"
    if (parseInt(book, 10) >= 10000) {
      const combo = await pg.waitForSelector('::-p-aria([role="combobox"][name="Image Set"])', { timeout: 10000 });
      await combo.click();
      const opt = await pg.waitForSelector('::-p-aria([role="option"][name="Deed 10000"])', { timeout: 10000 });
      await opt.click();
      await new Promise(r => setTimeout(r, 400));
    }
    await bookBox.click();
    await bookBox.type(book, { delay: 20 });
    const pageBox = await pg.waitForSelector('::-p-aria([role="textbox"][name="Page"])', { timeout: 10000 });
    await pageBox.click();
    await pageBox.type(page, { delay: 20 });
    const view = await pg.waitForSelector('::-p-aria([role="button"][name="View Pages"])', { timeout: 10000 });
    await view.click();

    await Promise.race([pdfSeen, new Promise(r => setTimeout(r, 35000))]);
    if (pdfBuf) return pdfBuf;
    if (pdfUrl) { await br.close(); return await tryDirect(pdfUrl); }
    return null;
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
      let diag = "";
      try {
        const fs = await import("fs");
        diag = " tmp=" + fs.readdirSync("/tmp").join(",").slice(0, 200) + " ld=" + (process.env.LD_LIBRARY_PATH || "").slice(0, 200);
      } catch (e2) {}
      return res.status(404).json({ error: "no image at that book and page", detail: String(e && e.message || e).slice(0, 300) + diag });
    }
  }
  return res.status(404).json({ error: "no image at that book and page" });
}
