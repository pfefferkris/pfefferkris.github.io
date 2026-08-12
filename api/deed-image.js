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
  "CUMBERLAND": { base: "https://www.ccrodinternet.org/", type: "loganBlazor" },
  "NEW HANOVER": { base: "https://search.newhanoverdeeds.com/", type: "bis", detail: "DetailScreen.php", bookcode: "RB" },
  "FORSYTH": { base: "https://www.forsythdeeds.com/", type: "bis", detail: "forsythDetailScreen.php", bookcode: "RE" },
  "GUILFORD": { base: "https://rdlxweb.guilfordcountync.gov/", type: "bis", detail: "guilfordDetailScreen.php", bookcode: "R" },
  "MECKLENBURG": { base: "https://meckrod.manatron.com/", type: "aumentum" }
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

    // the click makes the county server WRITE the file; headless chromium never
    // surfaces the embed's PDF response, so poll the public URL until it answers
    const stem = book + page.padStart(4, "0");
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      if (pdfBuf) return pdfBuf;
      if (pdfUrl) { const b = await tryDirect(pdfUrl); if (b) return b; }
      for (const f of [stem + ".pdf", stem + "_1.pdf"]) {
        const b = await tryDirect(base + "PDFs/" + f);
        if (b) return b;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    return null;
  } finally {
    try { await br.close(); } catch (e) {}
  }
}

// BIS counties (New Hanover): the DetailScreen deep link resolves the instrument,
// its page carries a view_image.php link, and the county serves the scanned TIFF
// sessionless. We convert TIFF -> PDF so the viewer and the in-browser reader
// work identically to Cumberland.
// FAST PATH: county scans are CCITT G4 fax TIFFs, and PDF supports that stream
// natively (CCITTFaxDecode) — so we embed the raw strips without decoding a
// single pixel. 29 pages convert in ~15ms instead of ~90s.
const REV = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let v = 0; for (let b = 0; b < 8; b++) if (i & (1 << b)) v |= 1 << (7 - b); REV[i] = v; }
function g4TiffToPdf(UTIF, buf, maxPages) {
  const ifds = UTIF.decode(buf).slice(0, maxPages || 40);
  if (!ifds.length) throw new Error("no pages");
  const chunks = []; let pos = 0; const offsets = [];
  const push = b => { chunks.push(b); pos += b.length; };
  const obj = (num, body) => { offsets[num] = pos; push(Buffer.from(num + " 0 obj\n")); push(body); push(Buffer.from("\nendobj\n")); };
  push(Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1"));
  const nPages = ifds.length;
  const pageRefs = [];
  for (let i = 0; i < nPages; i++) pageRefs.push((3 + i * 3) + " 0 R");
  obj(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, Buffer.from("<< /Type /Pages /Kids [" + pageRefs.join(" ") + "] /Count " + nPages + " >>"));
  ifds.forEach((ifd, i) => {
    const w = ifd.t256[0], h = ifd.t257[0];
    if (!(ifd.t259 && ifd.t259[0] === 4)) throw new Error("not G4");
    if ((ifd.t273 || []).length !== 1) throw new Error("multi-strip");
    let data = Buffer.from(buf.buffer, buf.byteOffset + ifd.t273[0], ifd.t279[0]);
    if (ifd.t266 && ifd.t266[0] === 2) { const d = Buffer.alloc(data.length); for (let k = 0; k < data.length; k++) d[k] = REV[data[k]]; data = d; }
    const pw = 612, ph = Math.round(612 * h / w);
    const pn = 3 + i * 3, cn = 4 + i * 3, xn = 5 + i * 3;
    obj(pn, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Resources << /XObject << /Im" + i + " " + xn + " 0 R >> >> /Contents " + cn + " 0 R >>"));
    const cs = Buffer.from("q " + pw + " 0 0 " + ph + " 0 0 cm /Im" + i + " Do Q");
    obj(cn, Buffer.concat([Buffer.from("<< /Length " + cs.length + " >>\nstream\n"), cs, Buffer.from("\nendstream")]));
    const dict = "<< /Type /XObject /Subtype /Image /Width " + w + " /Height " + h + " /BitsPerComponent 1 /ColorSpace /DeviceGray /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns " + w + " /Rows " + h + " /BlackIs1 false >> /Length " + data.length + " >>\nstream\n";
    obj(xn, Buffer.concat([Buffer.from(dict), data, Buffer.from("\nendstream")]));
  });
  const xrefPos = pos;
  const total = 2 + nPages * 3 + 1;
  let xr = "xref\n0 " + total + "\n0000000000 65535 f \n";
  for (let n2 = 1; n2 < total; n2++) xr += String(offsets[n2]).padStart(10, "0") + " 00000 n \n";
  push(Buffer.from(xr + "trailer\n<< /Size " + total + " /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF"));
  return Buffer.concat(chunks);
}

// SLOW PATH fallback for non-G4 or multi-strip TIFFs: decode pixels, re-embed.
async function tiffToPdf(buf) {
  const UTIF = (await import("utif2")).default;
  const { PNG } = await import("pngjs");
  const { PDFDocument } = await import("pdf-lib");
  const ifds = UTIF.decode(buf).slice(0, 30);
  const pdf = await PDFDocument.create();
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const png = new PNG({ width: ifd.width, height: ifd.height });
    png.data = Buffer.from(rgba);
    const img = await pdf.embedPng(PNG.sync.write(png));
    const page = pdf.addPage([612, 792]);
    const s = Math.min(612 / ifd.width, 792 / ifd.height);
    page.drawImage(img, { x: (612 - ifd.width * s) / 2, y: (792 - ifd.height * s) / 2, width: ifd.width * s, height: ifd.height * s });
  }
  return Buffer.from(await pdf.save());
}

async function fetchBis(c, book, page) {
  const base = c.base;
  // some BIS counties (Guilford) mint a per-session image id on the detail page,
  // so the image request has to carry the cookie that page handed out
  const cookies = {};
  const jar = () => Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; ");
  const grab = r => {
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    sc.forEach(x => { const kv = x.split(";")[0]; const i = kv.indexOf("="); if (i > 0) cookies[kv.slice(0, i)] = kv.slice(i + 1); });
  };
  const detailUrl = base + (c.detail || "DetailScreen.php") + "?Accept=Accept&book%5Bbookcode%5D=" + (c.bookcode || "RB") +
    "&book%5Bbooknum%5D=" + encodeURIComponent(book.replace(/^0+/, "")) + "&book%5Bpagenum%5D=" + encodeURIComponent(page.replace(/^0+/, ""));
  const r = await fetch(detailUrl, { headers: { "User-Agent": UA } });
  grab(r);
  if (!r.ok) return null;
  const html = await r.text();
  // prefer the TIFF: some counties' own PDF rendering places the scan in a
  // corner of an oversized page, while the TIFF converts cleanly here
  const links = [...html.matchAll(/view_image\.php\?[^"'\s>]+/g)].map(x => x[0].replace(/&amp;/g, "&"));
  const m = [links.find(l => l.indexOf("type=tif") >= 0) || links[0]];
  if (!m[0]) return null;
  const ir = await fetch(base + m[0], { headers: { "User-Agent": UA, "Cookie": jar(), "Referer": detailUrl } });
  grab(ir);
  if (!ir.ok) return null;
  const buf = Buffer.from(await ir.arrayBuffer());
  if (buf.length < 500) return null;
  if (buf.slice(0, 5).toString() === "%PDF-") return buf;
  const magic = buf.slice(0, 2).toString("hex");
  if (magic === "4949" || magic === "4d4d") {
    const UTIF = (await import("utif2")).default;
    try { return g4TiffToPdf(UTIF, buf, 40); }
    catch (e) { return await tiffToPdf(buf); }
  }
  return null;
}

// Mecklenburg (Charlotte) runs Aumentum/Manatron: an ASP.NET app whose imaging
// viewer is stateful, so the document only becomes reachable after walking the
// same path a citizen walks. All plain HTTP, no browser needed:
//   deep link (opens a session) -> acknowledge the disclaimer -> the record ->
//   the image page -> the viewer, which reveals the internal image id ->
//   the page image itself.
async function fetchAumentum(base, book, page) {
  const cookies = {};
  const jar = () => Object.entries(cookies).map(([k, v]) => k + "=" + v).join("; ");
  const grab = r => {
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    sc.forEach(c => { const kv = c.split(";")[0]; const i = kv.indexOf("="); if (i > 0) cookies[kv.slice(0, i)] = kv.slice(i + 1); });
  };
  const F = (u, o = {}) => fetch(u, { ...o, redirect: "manual", headers: { "User-Agent": UA, "Cookie": jar(), ...(o.headers || {}) } });
  const DL = "RealEstate/SearchDetail.aspx?bk=" + encodeURIComponent(book.replace(/^0+(?=\d)/, "")) +
    "&pg=" + encodeURIComponent(page.replace(/^0+(?=\d)/, "")) + "&type=BkPg";

  let r = await F(base + DL); grab(r);              // opens a session
  r = await F(base); grab(r);
  const home = await r.text();
  const fld = n => { const m = home.match(new RegExp('id="' + n + '"[^>]*value="([^"]*)"')); return m ? m[1] : ""; };
  r = await F(base, {                                // acknowledge the disclaimer
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "__EVENTTARGET": "ctl00$cph1$lnkAccept", "__EVENTARGUMENT": "",
      "__VIEWSTATE": fld("__VIEWSTATE"), "__VIEWSTATEGENERATOR": fld("__VIEWSTATEGENERATOR"),
      "__EVENTVALIDATION": fld("__EVENTVALIDATION")
    })
  });
  grab(r);
  r = await F(base + DL); grab(r);                   // now the record itself
  const detail = await r.text();
  const gm = detail.match(/SearchImage\.aspx\?global_id=([A-Za-z0-9]+)/);
  if (!gm) return null;
  r = await F(base + "RealEstate/SearchImage.aspx?global_id=" + gm[1] + "&type=img", { headers: { Referer: base + DL } });
  grab(r);
  await r.text();
  r = await F(base + "Controls/LTViewer.aspx", { headers: { Referer: base + "RealEstate/SearchImage.aspx" } });
  grab(r);
  const viewer = await r.text();
  // the viewer carries the app's own internal image URL; its query is what the
  // image handler actually answers to (IMAGE_ID here is not the one in the markup)
  const um = viewer.match(/name="WIV1_url"[^>]*value="([^"]*)"/);
  if (!um) return null;
  const q = um[1].replace(/&amp;/g, "&").split("?")[1];
  if (!q || q.indexOf("IMAGE_ID") < 0) return null;
  r = await F(base + "Controls/GetImage.aspx?" + q.replace(/(^|&)pg=\d+/, "$1pg=0"), { headers: { Referer: base + "Controls/LTViewer.aspx" } });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || buf.length < 2000) return null;
  const magic = buf.slice(0, 2).toString("hex");
  if (buf.slice(0, 5).toString() === "%PDF-") return buf;
  if (magic !== "4949" && magic !== "4d4d") return null;
  const UTIF = (await import("utif2")).default;
  try { return g4TiffToPdf(UTIF, buf, 40); }
  catch (e) { return await tiffToPdf(buf); }
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

  if (c.type === "aumentum") {
    if (n > 1) return res.status(404).json({ error: "no image at that book and page" });
    try {
      const buf = await fetchAumentum(c.base, book, page);
      if (buf) return send(buf);
    } catch (e) {
      return res.status(404).json({ error: "no image at that book and page", detail: String(e && e.message || e).slice(0, 200) });
    }
    return res.status(404).json({ error: "no image at that book and page" });
  }

  if (c.type === "bis") {
    if (n > 1) return res.status(404).json({ error: "no image at that book and page" });
    try {
      const buf = await fetchBis(c, book, page);
      if (buf) return send(buf);
    } catch (e) {
      return res.status(404).json({ error: "no image at that book and page", detail: String(e && e.message || e).slice(0, 200) });
    }
    return res.status(404).json({ error: "no image at that book and page" });
  }

  for (const f of candidates) {
    const buf = await tryDirect(c.base + "PDFs/" + f);
    if (buf) return send(buf);
  }
  if (n > 1) return res.status(404).json({ error: "no image at that book and page" });

  if (c.type === "loganBlazor") {
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
