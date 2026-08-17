/* /assets/property-room.js — the property engine as one shared module.
   The same tool the Wealth Guide and the Equity Guide run, mountable on any page:
   the record, the scanned deed with the chain walker and the automatic title read,
   the equity engine with the comparable sales, and the honest county coverage panel.
   Consumers: wealth-guide.html, equity-guide.html, ricardo.html (the capstone portal).
   Everything renders as liquid glass tiles; no naked hyperlinks, ever.
   Nothing a visitor types is stored or transmitted beyond the lookup itself. */
(function () {
  "use strict";
  if (window.PropertyRoom) return;

  /* ---------- shared state, one per page ---------- */
  var DATA = { rodmap: null, coverage: null, pmms: null, rates: null };
  var IMG_COUNTIES = ["MECKLENBURG", "CUMBERLAND", "GUILFORD", "FORSYTH", "NEW HANOVER"];
  var SEQ = 0;

  function getJson(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function siteData(name) {
    if (DATA[name]) return Promise.resolve(DATA[name]);
    var path = { rodmap: "/data/rodmap.json", coverage: "/data/nc-coverage.json", pmms: "/data/pmms.json", rates: "/data/rates.json" }[name];
    return getJson(path).then(function (j) { DATA[name] = j; return j; });
  }
  function money(n) { if (!(n || n === 0)) return ""; var r = Math.round(n); return (r < 0 ? "-$" : "$") + Math.abs(r).toLocaleString("en-US"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }

  /* ---------- styles, injected once ---------- */
  function injectCss() {
    if (document.getElementById("prcss")) return;
    var s = document.createElement("style");
    s.id = "prcss";
    s.textContent = "" +
      ".pr{margin-top:14px;font-size:14px;line-height:1.6;color:var(--ink,#1e2b36)}" +
      ".prtile{border:1px solid rgba(169,136,79,.4);border-radius:14px;margin-top:10px;" +
      "background:linear-gradient(135deg,rgba(255,255,255,.55),rgba(255,255,255,.28));" +
      "backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);" +
      "box-shadow:0 6px 24px rgba(18,41,63,.08);overflow:hidden}" +
      ".prhead{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;user-select:none}" +
      ".prhead b{color:var(--navy,#12293f);font-size:13.5px;letter-spacing:.02em}" +
      ".prhead .prsub{display:block;font-weight:400;font-size:12px;color:var(--muted,#5a6a78)}" +
      ".prhead .prarrow{color:var(--goldtext,#8a6d3b);font-size:15px;transition:transform .25s;flex:none}" +
      ".prtile.on>.prhead .prarrow{transform:rotate(90deg)}" +
      ".prbody{display:none;padding:2px 16px 14px}" +
      ".prtile.on>.prbody{display:block;animation:prfade .4s ease}" +
      "@keyframes prfade{from{opacity:0}to{opacity:1}}" +
      ".prrow{display:flex;justify-content:space-between;gap:14px;padding:5px 0;border-bottom:1px dashed rgba(169,136,79,.22);font-size:13.5px}" +
      ".prrow span:last-child{text-align:right;font-variant-numeric:tabular-nums}" +
      ".prgood{color:var(--good,#2e7d4f);font-weight:700}" +
      ".prbad{color:var(--brick,#8a3d3a);font-weight:700}" +
      ".prnote{margin-top:9px;font-size:12.5px;color:var(--muted,#5a6a78)}" +
      ".prmatch{margin-top:6px;padding:9px 12px;border-radius:10px;border:1px solid rgba(169,136,79,.45);" +
      "background:rgba(255,251,240,.6);font-size:13px}" +
      ".prlab{display:block;font-size:12px;color:var(--muted,#5a6a78);margin-bottom:2px}" +
      ".prin{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0}" +
      ".prin input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid rgba(169,136,79,.4);border-radius:10px;" +
      "background:rgba(255,255,255,.65);font:inherit;font-size:13px;color:var(--ink,#1e2b36)}" +
      ".prbtn{display:inline-block;border:1px solid rgba(169,136,79,.65);border-radius:12px;padding:9px 16px;margin-top:8px;" +
      "background:linear-gradient(135deg,rgba(255,255,255,.6),rgba(255,255,255,.3));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
      "color:var(--navy,#12293f);font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.04em;cursor:pointer;text-decoration:none}" +
      ".prbtn:hover{background:var(--navy,#12293f);color:#fff;border-color:var(--navy,#12293f)}" +
      ".prtab{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}" +
      ".prtab th{color:var(--muted,#5a6a78);text-align:left;font-weight:600;padding:4px 6px;border-bottom:1px solid rgba(169,136,79,.4)}" +
      ".prtab td{padding:4px 6px;border-bottom:1px dashed rgba(169,136,79,.2);font-variant-numeric:tabular-nums}" +
      ".prchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}" +
      ".prchip{border:1px solid rgba(169,136,79,.4);border-radius:999px;padding:3px 10px;font-size:11.5px;color:var(--ink,#1e2b36);background:rgba(255,255,255,.5)}" +
      ".prembed{width:100%;height:760px;border-radius:10px;background:#fff;border:1px solid rgba(169,136,79,.3);margin-top:8px}" +
      ".prwait{font-size:12.5px;font-style:italic;color:var(--muted,#5a6a78);margin-top:8px}";
    document.head.appendChild(s);
  }

  function tile(id, title, sub) {
    return "<div class=\"prtile\" id=\"" + id + "\"><div class=\"prhead\"><b>" + title +
      "<span class=\"prsub\">" + sub + "</span></b><span class=\"prarrow\">&#10148;</span></div>" +
      "<div class=\"prbody\"></div></div>";
  }

  /* ---------- record normalization: /api/parcel (deep or statewide) or /api/deed ---------- */
  function normalize(j) {
    if (!j || j.error) return null;
    var d = j.deed || {};
    var a = j.assessed || {};
    var b = j.building || {};
    var sale = (j.sales && j.sales[0]) || {};
    return {
      county: j.county || null,
      address: j.address || j.siteAddress || null,
      book: d.book || j.book || j.deedBook || null,
      page: d.page || j.page || j.deedPage || null,
      recorded: d.recorded || j.recorded || j.deedDate || null,
      legal: j.legal || null,
      use: j.use || (j.land && j.land.use) || null,
      assessedTotal: a.total || j.totalAssessed || null,
      land: a.land || null, buildingVal: a.building || null, landShare: a.landShare || null,
      salePrice: sale.price || a.salePrice || j.salePrice || null,
      saleDate: sale.date || a.saleDate || j.saleDate || null,
      yearBuilt: b.yearBuilt || a.yearBuilt || j.yearBuilt || null,
      heatedArea: b.heatedArea || a.heatedArea || null,
      bedrooms: b.bedrooms || null,
      baths: b.bathsFull || null,
      source: j.source || (j.sources && j.sources.join("; ")) || null,
      depth: j.depth || null
    };
  }

  /* =====================================================================
     the title reader: OCR the scanned deed entirely in the browser.
     Lifted from the Wealth Guide; identical analysis, module scoped.
     ===================================================================== */
  var OCRREADY = null;
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error("load " + src)); }; document.head.appendChild(s); }); }
  function loadOCR() {
    if (OCRREADY) return OCRREADY;
    OCRREADY = (async function () {
      if (!window.pdfjsLib) {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
      if (!window.Tesseract) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.5/tesseract.min.js");
    })();
    return OCRREADY;
  }
  async function ocrPdf(url, maxPages) {
    var pdf = await window.pdfjsLib.getDocument(url).promise;
    var n = Math.min(maxPages || 1, pdf.numPages);
    var txt = "";
    for (var i = 1; i <= n; i++) {
      var page = await pdf.getPage(i);
      var vp = page.getViewport({ scale: 2 });
      var cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      var r = await window.Tesseract.recognize(cv, "eng");
      txt += "\n" + ((r && r.data && r.data.text) || "");
    }
    try { pdf.destroy(); } catch (e) {}
    return txt;
  }
  function analyzeDeedText(txt) {
    var t = (txt || "").toUpperCase().replace(/\s+/g, " ").replace(/\bP\.?L\.?L\.?C\b/g, "PLC");
    t = t.replace(/(?:NORTH CAROLINA|N\.?\s?C\.?)?\s*(?:BAR )?ASSOCIATION OF RE[A-Z]{3,9}S?,?\s*INC\.?/g, " ")
      .replace(/(?:NORTH CAROLINA|N\.?\s?C\.?)\s*BAR ASSOCIATION[^.]{0,70}/g, " ")
      .replace(/PRINTED BY AGREEMENT WITH[^.]{0,70}/g, " ");
    var a = { form: "sole", refs: [], quit: false, warranty: false, easement: false, subjectTo: false, dot: false, doc: "deed", span: null };
    var head = t.slice(0, 2600);
    var isDeed = /(?:GENERAL |SPECIAL |LIMITED )?WARRANTY DEED|QUIT\s?-?\s?CLAIM DEED|TRUSTEE.?S DEED|EXECUTOR.?S DEED|ADMINISTRATOR.?S DEED|DEED OF GIFT|CORRECTIVE DEED|SUBSTITUTE TRUSTEE.?S DEED|\bTHIS DEED\b/.test(head);
    if (isDeed) a.doc = "deed";
    else if (/DECLARATION OF (UNIT OWNERSHIP|CONDOMINIUM)|CONDOMINIUM DECLARATION/.test(head)) a.doc = "condo";
    else if (/EASEMENT AGREEMENT|GRANT OF EASEMENT|RIGHT[- ]OF[- ]WAY AGREEMENT/.test(head)) a.doc = "easement";
    else if (/DECLARATION OF (RESTRICTIVE COVENANTS|RESTRICTIONS|PROTECTIVE COVENANTS)|RESTRICTIVE COVENANTS/.test(head)) a.doc = "covenants";
    else if (/\bDEED OF TRUST\b/.test(head)) a.doc = "dot";
    else if (/SATISFACTION|CANCELLATION OF/.test(head)) a.doc = "satisfaction";
    else if (/POWER OF ATTORNEY/.test(head)) a.doc = "poa";
    else if (/\bPLAT\b.{0,30}\bMAP\b|MAP OF SURVEY/.test(head)) a.doc = "plat";
    var sp = t.match(/(?:START PAGE|PG:?)\s*0*(\d{1,6})\s*(?:-|END PAGE|TO)\s*0*(\d{1,6})/);
    if (sp) a.span = [+sp[1], +sp[2]];
    var severed = /SEVER\w*[^.]{0,80}ENTIRET/.test(t);
    if (/JOINT\s+TENAN\w*[^.]{0,60}SURVIVORSHIP|RIGHTS?\s+OF\s+SURVIVORSHIP/.test(t)) a.form = "jtwros";
    else if (!severed && /TENAN\w*\s+BY\s+THE\s+ENTIRET/.test(t)) a.form = "tbe";
    else if (/TENAN\w*\s+IN\s+COMMON/.test(t)) a.form = "tic";
    else if (/\bTRUSTEES?\b|REVOCABLE\s+TRUST|LIVING\s+TRUST|\bU\/?A\/?D\b/.test(t)) a.form = "trust";
    else if (/LIFE\s+ESTATE|REMAINDERM[AE]N|RESERV\w*[^.]{0,80}(LIFE|LIFETIME)/.test(t)) a.form = "life";
    else if (!severed && /HUSBAND\s+AND\s+WIFE|WIFE\s+AND\s+HUSBAND|A\s+MARRIED\s+COUPLE|MARRIED\s+COUPLE|,\s*(?:HIS|HER)\s+(?:WIFE|HUSBAND)|AND\s+SPOUSE\b/.test(t)) a.form = "tbe";
    else if (/\bL\.?L\.?C\b|LIMITED\s+LIABILITY\s+COMPAN|\bINCORPORATED\b|,\s?INC\b/.test(t)) a.form = "entity";
    a.quit = /QUIT\s?-?\s?CLAIM|REMISE,?\s+RELEASE/.test(t);
    a.warranty = /\bWARRANT(S|Y|ED)?\b/.test(t) && !a.quit;
    a.easement = /EASEMENT|RIGHT[\s-]OF[\s-]WAY|INGRESS|EGRESS/.test(t);
    a.subjectTo = /SUBJECT\s+TO/.test(t);
    a.dot = /DEED\s+OF\s+TRUST/.test(t);
    var re = /(PLAT\s+|MAP\s+)?BOOK\s*(?:NO\.?|NUMBER)?\s*(\d{2,6})\s*,?\s*(?:AT\s+)?PAGE\s*(\d{1,5})/gi, m2;
    while ((m2 = re.exec(t)) !== null) {
      if (m2[1]) continue;
      a.refs.push({ b: m2[2], g: String(+m2[3]) });
    }
    return a;
  }
  var TITLEM = {
    sole: "<b>One name alone.</b> This home rides through probate: at death it follows the will, or with no will the intestacy formula, through the public court process before anyone can sell or refinance. The fixes are the containers this plan is built from: a revocable trust holding title, no probate and incapacity covered.",
    jtwros: "<b>Joint tenants with right of survivorship.</b> This deed IS the estate plan for this house: at the first death the survivor owns it all, automatically, outside probate. The deed beats the will. The last survivor still needs a plan, and in a blended family survivorship can quietly disinherit one side of the children.",
    tbe: "<b>Tenants by the entirety</b>, the married couple form, North Carolina's quiet gift to spouses: survivorship at the first death plus creditor armor, because a creditor of only one spouse generally cannot touch the home. It only works once; the survivor holds alone.",
    tic: "<b>Tenants in common.</b> Each share probates separately under its own owner's will, and any co owner can force a partition sale of the whole property under Chapter 46A. If this is family land, the vessels in this plan were built for exactly this.",
    trust: "<b>Held in trust already.</b> The chassis is on the road: no probate, incapacity covered, privacy kept. The examiner's check is exact naming, trustee, trust, and its date, and remembering that anything bought after the trust was signed must be deeded in too.",
    life: "<b>A life estate.</b> The remainder passes outside probate automatically at death. Read the reservation paragraph closely: if the owner kept the power to sell, gift, and mortgage, it is the enhanced version and they kept full control for life.",
    entity: "<b>Titled in a company.</b> The deed conveys this property to a business entity, so the company owns it, not a person. The real estate never probates because a company never dies; what passes at death is the membership interest, and that follows the will or the trust it was assigned to."
  };

  /* =====================================================================
     mount
     ===================================================================== */
  function mount(host, opts) {
    injectCss();
    opts = opts || {};
    var id = "pr" + (++SEQ);
    var root = document.createElement("div");
    root.className = "pr";
    root.id = id;
    host.appendChild(root);

    var st = { rec: null, address: opts.address || "", county: opts.county || "" };

    var html = "";
    if (!opts.record && !opts.skipRecord) html += "<div class=\"prmatch\" id=\"" + id + "rec\">Asking the record.</div>";
    html += tile(id + "deed", "The deed itself", "the scanned page from the county, the chain, and the automatic title read");
    html += tile(id + "eq", "The equity engine", "net income, the cap rate built from the money, cash on cash, return on equity");
    html += tile(id + "cmp", "The comparable sales", "what actually sold nearby, from the county record");
    html += tile(id + "cov", "Every county, honestly", "which of the 100 North Carolina counties answer, and how deep");
    root.innerHTML = html;

    root.querySelectorAll(".prtile > .prhead").forEach(function (h) {
      h.addEventListener("click", function () {
        var t = h.parentElement;
        var was = t.classList.contains("on");
        t.classList.toggle("on");
        if (!was && !t.dataset.loaded) { t.dataset.loaded = "1"; loaders[t.id.slice(id.length)](); }
        if (opts.onResize) opts.onResize();
      });
    });

    /* ---------- the record ---------- */
    function drawRecord(rec) {
      st.rec = rec;
      var el = document.getElementById(id + "rec");
      if (!el) return;
      if (!rec) {
        el.innerHTML = "<b>No parcel matched that address.</b> The statewide layer reaches all 100 counties; include the city, since a street name without one lands wherever that name occurs first in the state.";
        return;
      }
      var rows = [];
      rows.push("<div class=\"prrow\"><span><b>The record I matched</b></span><span><b>" + esc(rec.address || st.address) + (rec.county ? ", " + esc(rec.county) + " County" : "") + "</b></span></div>");
      if (rec.book) rows.push("<div class=\"prrow\"><span>Deed book and page</span><span>" + esc(rec.book) + " / " + esc(rec.page || "") + "</span></div>");
      if (rec.recorded) rows.push("<div class=\"prrow\"><span>Recorded</span><span>" + esc(rec.recorded) + "</span></div>");
      if (rec.assessedTotal) rows.push("<div class=\"prrow\"><span>Assessed value</span><span>" + money(rec.assessedTotal) + "</span></div>");
      if (rec.land && rec.buildingVal) rows.push("<div class=\"prrow\"><span>The assessor's split, land and building</span><span>" + money(rec.land) + " + " + money(rec.buildingVal) + (rec.landShare ? " (land " + rec.landShare + " percent)" : "") + "</span></div>");
      if (rec.salePrice) rows.push("<div class=\"prrow\"><span>Last recorded sale</span><span>" + money(rec.salePrice) + (rec.saleDate ? ", " + esc(rec.saleDate) : "") + "</span></div>");
      if (rec.yearBuilt) rows.push("<div class=\"prrow\"><span>Year built</span><span>" + esc(rec.yearBuilt) + "</span></div>");
      if (rec.heatedArea) rows.push("<div class=\"prrow\"><span>Heated area</span><span>" + rec.heatedArea.toLocaleString("en-US") + " sq ft</span></div>");
      if (rec.use) rows.push("<div class=\"prrow\"><span>Use</span><span>" + esc(rec.use) + "</span></div>");
      el.innerHTML = rows.join("") +
        "<div class=\"prnote\">Read the matched address before trusting a single number: a wrong city can silently match a real but different house." +
        (rec.source ? " Source: " + esc(rec.source) + "." : "") + "</div>";
    }
    function fetchRecord() {
      var u = "/api/parcel?address=" + encodeURIComponent(st.address) + (st.county ? "&county=" + encodeURIComponent(st.county) : "");
      return getJson(u).then(function (j) {
        var rec = normalize(j);
        if (!rec) {
          return getJson("/api/deed?address=" + encodeURIComponent(st.address) + (st.county ? "&county=" + encodeURIComponent(st.county) : ""))
            .then(function (j2) { drawRecord(normalize(j2)); });
        }
        drawRecord(rec);
      });
    }
    if (opts.record) { st.rec = normalize(opts.record); }
    else if (!opts.skipRecord) { fetchRecord(); }

    function needRec() {
      if (st.rec) return Promise.resolve(st.rec);
      var u = "/api/parcel?address=" + encodeURIComponent(st.address) + (st.county ? "&county=" + encodeURIComponent(st.county) : "");
      return getJson(u).then(function (j) { st.rec = normalize(j); return st.rec; });
    }

    /* ---------- the deed tile ---------- */
    function loadDeed() {
      var body = document.querySelector("#" + id + "deed .prbody");
      body.innerHTML = "<div class=\"prwait\">Finding the recording.</div>";
      Promise.all([needRec(), siteData("rodmap")]).then(function (rs) {
        var rec = rs[0], rodmap = rs[1];
        if (!rec || !(rec.book || rec.county)) {
          body.innerHTML = "<div class=\"prnote\">No recording reference answered for this address, so there is no book and page to open yet. The coverage tile below says which counties carry it.</div>";
          return;
        }
        var ck = String(rec.county || "").toUpperCase();
        var rod = rodmap && rodmap.counties ? rodmap.counties[ck] : null;
        var h = "";
        if (rec.book) h += "<div class=\"prrow\"><span>The recording</span><span><b>Book " + esc(rec.book) + ", Page " + esc(rec.page || "") + "</b>" + (rec.recorded ? ", recorded " + esc(rec.recorded) : "") + "</span></div>";
        if (rec.legal) h += "<div class=\"prnote\"><i>" + esc(rec.legal) + "</i></div>";
        var canImage = IMG_COUNTIES.indexOf(ck) >= 0 && rec.book && rec.page;
        if (canImage) {
          h += "<div class=\"prwait\" id=\"" + id + "dw\">Pulling the scanned deed from the county imaging system. The first pull of a document can take up to a minute while the county generates it fresh.</div>" +
            "<div id=\"" + id + "dhost\"></div>";
          body.innerHTML = h;
          var pun = function (b, g) { return "/api/deed-image?county=" + encodeURIComponent(ck) + "&book=" + encodeURIComponent(b) + "&page=" + encodeURIComponent(g) + "&n=1"; };
          fetch(pun(rec.book, rec.page)).then(function (r) { return r.ok; }).catch(function () { return false; }).then(function (probe) {
            var dw = document.getElementById(id + "dw"); if (dw) dw.remove();
            var dh = document.getElementById(id + "dhost");
            if (!probe) {
              dh.innerHTML = "<div class=\"prnote\">The county imaging system did not answer for this document just now.</div>" +
                (rod ? "<a class=\"prbtn\" href=\"" + esc(rod.url) + "\" target=\"_blank\" rel=\"noopener\">Open the " + esc(rec.county) + " County register</a>" : "");
              return;
            }
            dh.innerHTML =
              "<div style=\"font-size:12.5px;margin:8px 0 4px\"><b>Chain of custody:</b> <span id=\"" + id + "chain\"></span> <span id=\"" + id + "dpn\" style=\"color:var(--muted,#5a6a78)\"></span></div>" +
              "<embed src=\"" + pun(rec.book, rec.page) + "\" type=\"application/pdf\" class=\"prembed\"></embed>" +
              "<div class=\"prnote\">Served live from the " + esc(rec.county) + " County Register of Deeds imaging system. Scroll inside the viewer; every recorded page is there.</div>" +
              "<div style=\"margin-top:10px;padding-top:8px;border-top:1px dashed rgba(169,136,79,.35);font-size:12.5px\"><b>Walk the chain backward.</b> Every deed cites its ancestor in the derivation clause, usually BEING THE SAME PROPERTY CONVEYED BY DEED RECORDED IN BOOK ___, PAGE ___. Type it here and the prior deed loads in this same viewer. When the automatic reading below finds the citation, it fills these boxes for you." +
              "<div style=\"display:flex;gap:6px;align-items:end;margin-top:6px\"><label style=\"font-size:11px\">Book<input type=\"text\" id=\"" + id + "cb\" style=\"width:80px;padding:6px;border:1px solid rgba(169,136,79,.4);border-radius:8px;background:rgba(255,255,255,.65)\"></label>" +
              "<label style=\"font-size:11px\">Page<input type=\"text\" id=\"" + id + "cp\" style=\"width:80px;padding:6px;border:1px solid rgba(169,136,79,.4);border-radius:8px;background:rgba(255,255,255,.65)\"></label>" +
              "<button class=\"prbtn\" type=\"button\" id=\"" + id + "cgo\" style=\"margin-top:0\">Follow the chain</button></div></div>" +
              "<div id=\"" + id + "read\" class=\"prnote\" style=\"display:none\"></div>";
            var cur = { b: String(rec.book), g: String(rec.page) };
            var chain = [{ b: cur.b, g: cur.g }];
            var upd = function () { var em = dh.querySelector("embed"); if (em) em.src = pun(cur.b, cur.g); };
            var drawChain = function () {
              var el = document.getElementById(id + "chain"); if (!el) return;
              el.innerHTML = chain.map(function (c, i) { return "<a href=\"#\" data-ci=\"" + i + "\" style=\"" + (c.b === cur.b && c.g === cur.g ? "font-weight:800;color:var(--navy,#12293f)" : "") + "\">" + c.b + "/" + c.g + "</a>"; }).join(" &#8592; ");
              el.querySelectorAll("a").forEach(function (a2) {
                a2.addEventListener("click", function (ev) { ev.preventDefault(); cur = chain[+a2.dataset.ci]; upd(); drawChain(); });
              });
            };
            var cg = document.getElementById(id + "cgo");
            cg.addEventListener("click", function () {
              var b = (document.getElementById(id + "cb").value || "").replace(/[^0-9]/g, "");
              var g = (document.getElementById(id + "cp").value || "").replace(/[^0-9]/g, "");
              if (!b || !g) return;
              cg.textContent = "Pulling.";
              fetch(pun(b, g)).then(function (r) { return r.ok; }).catch(function () { return false; }).then(function (ok2) {
                cg.textContent = "Follow the chain";
                if (ok2) {
                  cur = { b: b, g: g };
                  if (!chain.some(function (c) { return c.b === b && c.g === g; })) chain.push({ b: b, g: g });
                  upd(); drawChain();
                } else {
                  var lb = document.getElementById(id + "dpn");
                  if (lb) lb.textContent = "No image answered at Book " + b + " Page " + g + ". Older books can live in a different image set at the county.";
                }
              });
            });
            drawChain();
            titleRead(ck, rec, pun);
          });
        } else {
          if (rod && rod.deep && rec.book && rec.page) {
            h += "<a class=\"prbtn\" href=\"" + esc(rod.deep.replace("{book}", encodeURIComponent(rec.book)).replace("{page}", encodeURIComponent(rec.page))) + "\" target=\"_blank\" rel=\"noopener\">Open this exact deed record at the " + esc(rec.county) + " County register</a>";
          } else if (rod) {
            h += "<a class=\"prbtn\" href=\"" + esc(rod.url) + "\" target=\"_blank\" rel=\"noopener\">Open the " + esc(rec.county) + " County register</a>" +
              "<div class=\"prnote\">" + esc(rod.note || "Enter the book and page and the scanned deed opens in the browser.") + "</div>";
          } else if (rec.county) {
            var q0 = encodeURIComponent(rec.county + " County NC register of deeds search");
            h += "<a class=\"prbtn\" href=\"https://www.google.com/search?q=" + q0 + "\" target=\"_blank\" rel=\"noopener\">Find the " + esc(rec.county) + " County register</a>";
          }
          h += "<div class=\"prnote\">Five counties serve the scanned page straight into this tile: Mecklenburg, Cumberland, Guilford, Forsyth, and New Hanover. " + (ck && IMG_COUNTIES.indexOf(ck) < 0 ? esc(rec.county || "This") + " County is not one of them yet; the register tile above opens the same document the manual way, and the coverage tile below keeps the honest list." : "") + "</div>";
          body.innerHTML = h;
        }
      });
    }

    /* the automatic title read, in place */
    var OCRBUSY = false;
    function titleRead(ck, rec, pun) {
      var oo = document.getElementById(id + "read");
      if (!oo || OCRBUSY) return;
      OCRBUSY = true;
      oo.style.display = "block";
      var prog = ""; var say = function (m) { prog += (prog ? "<br>" : "") + m; oo.innerHTML = prog; };
      (async function () {
        try {
          say("<b>Now reading the deed for you.</b> This happens entirely in your browser; the document never leaves your screen.");
          await loadOCR();
          var seen = new Set(), hops = [];
          var cur = { b: String(rec.book), g: String(rec.page) };
          var nextRef = null, unconfirmed = null;
          for (var hop = 0; hop < 4 && cur; hop++) {
            var key = cur.b + "/" + cur.g;
            if (seen.has(key)) break;
            seen.add(key);
            say((hop === 0 ? "Reading the current deed" : "Following the chain: reading the prior deed") + " at Book " + cur.b + ", Page " + cur.g + ". A scanned page takes a moment.");
            var text = "";
            try { text = await ocrPdf(pun(cur.b, cur.g), hop === 0 ? 2 : 1); }
            catch (e) { if (hop > 0) unconfirmed = { b: cur.b, g: cur.g }; say("I could not open Book " + cur.b + " Page " + cur.g + ". Scanned digits are the one thing this kind of reading gets wrong."); break; }
            var an = analyzeDeedText(text);
            hops.push({ b: cur.b, g: cur.g, an: an });
            var prior = an.refs.find(function (r) {
              var k = r.b + "/" + r.g;
              if (k === key || seen.has(k)) return false;
              if (+r.b > +cur.b) return false;
              if (+r.b === +cur.b) {
                if (+r.g >= +cur.g) return false;
                if (an.span && +r.g >= an.span[0] && +r.g <= an.span[1]) return false;
              }
              return true;
            });
            if (prior) { nextRef = prior; cur = { b: prior.b, g: prior.g }; }
            else cur = null;
          }
          if (!hops.length) throw new Error("none");
          var a = hops[0].an;
          var v = "<b>I read the deed for you.</b> " + (TITLEM[a.form] || "");
          var notes = [];
          if (a.quit) notes.push("The granting words read as <b>QUITCLAIM</b>, whatever interest I have, if anything, with no guarantee behind it. Common in family transfers, and an examiner reads the rest of the chain harder because of it.");
          else if (a.warranty) notes.push("The granting words carry a <b>warranty</b>: the seller stood behind the title, the strongest form of deed.");
          if (a.easement || a.subjectTo) notes.push("I found <b>SUBJECT TO or easement</b> language: someone else holds rights over part of this land. It rides with the land forever, so know where it runs.");
          if (a.dot) notes.push("A <b>deed of trust</b> surfaced in the text, the mortgage security instrument. Every one must be cancelled of record at payoff.");
          if (notes.length) v += "<br><br>" + notes.join("<br><br>");
          if (hops.length > 1) v += "<br><br><b>The chain I walked:</b> " + hops.map(function (h) { return "Book " + h.b + "/" + h.g; }).join(" &#8592; ") + ". Each deed cited the one before it, which is a real title search taking shape.";
          if (unconfirmed) v += "<br><br>This deed cites an earlier recording I read as <b>Book " + unconfirmed.b + ", Page " + unconfirmed.g + "</b>, but the county had nothing there, which usually means I misread a digit off the scan.";
          else if (nextRef) v += "<br><br>The oldest deed I read cites <b>Book " + nextRef.b + ", Page " + nextRef.g + "</b> before it; I loaded those numbers into the chain walker so you can keep going.";
          v += "<br><br><b>One honest limit:</b> I read a scanned image with optical character recognition, so a faded stamp can slip past me, and a clean deed is still not a clean title: liens and judgments live in the county index, not on the deed. A reading lesson, not a legal opinion.";
          oo.innerHTML = v;
          if (nextRef && !unconfirmed) {
            var cb = document.getElementById(id + "cb"), cp = document.getElementById(id + "cp");
            if (cb) cb.value = nextRef.b; if (cp) cp.value = nextRef.g;
          }
        } catch (e) {
          oo.innerHTML = prog + "<br>I could not finish reading this one; the scanned deed above still shows every page.";
        }
        OCRBUSY = false;
      })();
    }

    /* ---------- the equity tile ---------- */
    function loadEquity() {
      var body = document.querySelector("#" + id + "eq .prbody");
      body.innerHTML = "<div class=\"prwait\">Filling the inputs from the record, the rent model, and this week's mortgage survey.</div>";
      Promise.all([
        needRec(),
        getJson("/api/home-value?address=" + encodeURIComponent(st.address)),
        siteData("pmms")
      ]).then(function (rs) {
        var rec = rs[0] || {}, avm = rs[1], pmms = rs[2];
        var rate30 = 6.6;
        try {
          if (pmms && Array.isArray(pmms.rate30) && pmms.rate30.length) {
            for (var pi = pmms.rate30.length - 1; pi >= 0; pi--) {
              if (pmms.rate30[pi] != null) { rate30 = pmms.rate30[pi]; break; }
            }
          }
        } catch (e) {}
        var val = (avm && avm.price) || rec.assessedTotal || 0;
        var rentGuess = 0;
        body.innerHTML =
          "<div class=\"prnote\">Every box filled itself from a public source and every box is yours to overtype: the value from the market model" + (rec.assessedTotal ? " beside a county assessment of " + money(rec.assessedTotal) : "") + ", the rent from the rent model, the rate from the Freddie Mac weekly survey. The arithmetic is the same engine the Equity Guide runs.</div>" +
          "<div class=\"prin\">" +
          "<label><span class=\"prlab\">Value</span><input id=\"" + id + "v\" inputmode=\"numeric\" value=\"" + (val ? Math.round(val) : "") + "\"></label>" +
          "<label><span class=\"prlab\">Rent, monthly</span><input id=\"" + id + "r\" inputmode=\"numeric\" placeholder=\"asking the model\"></label>" +
          "<label><span class=\"prlab\">Taxes, yearly</span><input id=\"" + id + "t\" inputmode=\"numeric\" value=\"" + (rec.assessedTotal ? Math.round(rec.assessedTotal * 0.008) : "") + "\"></label>" +
          "<label><span class=\"prlab\">Insurance, yearly</span><input id=\"" + id + "i\" inputmode=\"numeric\" value=\"2400\"></label>" +
          "<label><span class=\"prlab\">Rate, percent</span><input id=\"" + id + "p\" inputmode=\"decimal\" value=\"" + rate30 + "\"></label>" +
          "<label><span class=\"prlab\">Down, percent</span><input id=\"" + id + "d\" inputmode=\"numeric\" value=\"25\"></label>" +
          "<label><span class=\"prlab\">Cash on cash you require, percent</span><input id=\"" + id + "c\" inputmode=\"decimal\" value=\"10\"></label>" +
          "<label><span class=\"prlab\">Appreciation, percent</span><input id=\"" + id + "a\" inputmode=\"decimal\" value=\"3\"></label>" +
          "</div><button class=\"prbtn\" id=\"" + id + "go\" type=\"button\">Run the engine</button>" +
          "<div id=\"" + id + "eqout\"></div>";
        var rentIn = document.getElementById(id + "r");
        getJson("/api/rent-estimate?address=" + encodeURIComponent(st.address) +
          (rec.bedrooms ? "&bedrooms=" + rec.bedrooms : "") + (rec.baths ? "&bathrooms=" + rec.baths : ""))
          .then(function (j) {
            if (j && j.rent && rentIn && !rentIn.value) { rentIn.value = Math.round(j.rent); rentIn.dataset.src = "model"; }
            else if (rentIn && !rentIn.value) rentIn.placeholder = "the model had no answer; type the street's number";
          });
        document.getElementById(id + "go").addEventListener("click", function () {
          var V = num(document.getElementById(id + "v").value), R = num(rentIn.value) * 12;
          var TX = num(document.getElementById(id + "t").value), INS = num(document.getElementById(id + "i").value);
          var rate = num(document.getElementById(id + "p").value) / 100, down = num(document.getElementById(id + "d").value) / 100;
          var coc = num(document.getElementById(id + "c").value) / 100, appr = num(document.getElementById(id + "a").value) / 100;
          var out = document.getElementById(id + "eqout");
          if (!V || !R) { out.innerHTML = "<div class=\"prnote\">A value and a rent first; the rest can stay as the engine guessed.</div>"; return; }
          var vac = 0.05, upkeep = 0.08, mgmt = 0.08;
          var egi = R * (1 - vac);
          var noi = egi - TX - INS - R * upkeep - R * mgmt;
          var mrate = rate / 12, nmo = 360;
          var pay = V * (1 - down) * (mrate * Math.pow(1 + mrate, nmo)) / (Math.pow(1 + mrate, nmo) - 1);
          var ds = pay * 12;
          var M = 1 - down;
          var lf = ds / (V * (1 - down));
          var capR = lf * M + down * coc;
          var incomeVal = capR > 0 ? noi / capR : 0;
          var cashIn = V * down + V * 0.03;
          var cf = noi - ds;
          var cocActual = cashIn > 0 ? cf / cashIn : 0;
          var beo = R > 0 ? (TX + INS + R * upkeep + R * mgmt + ds) / R : 0;
          var bal = V * (1 - down), principal1 = 0;
          for (var m = 0; m < 12; m++) { var intM = bal * mrate; principal1 += pay - intM; bal -= pay - intM; }
          var roe = cashIn > 0 ? (cf + principal1 + V * appr) / cashIn : 0;
          var pc = function (x) { return (x * 100).toFixed(1) + " percent"; };
          var rows = [];
          rows.push(["Net operating income, after vacancy, upkeep, and management", money(noi)]);
          rows.push(["The cap rate the money demands, band of investment", pc(capR)]);
          rows.push(["Value by the income approach at that rate", money(incomeVal)]);
          rows.push(["Cash in at closing, down plus three percent costs", money(cashIn)]);
          rows.push(["Cash flow after the whole mortgage payment", "<span class=\"" + (cf >= 0 ? "prgood" : "prbad") + "\">" + money(cf) + "</span>"]);
          rows.push(["Cash on cash, year one", "<span class=\"" + (cocActual >= 0.08 ? "prgood" : cocActual >= 0 ? "" : "prbad") + "\">" + pc(cocActual) + "</span>"]);
          rows.push(["Break even occupancy", "<span class=\"" + (beo <= 0.85 ? "prgood" : "prbad") + "\">" + pc(beo) + "</span>"]);
          rows.push(["Return on equity, year one, cash plus principal plus appreciation", "<span class=\"" + (roe >= 0.08 ? "prgood" : "") + "\">" + pc(roe) + "</span>"]);
          out.innerHTML = rows.map(function (r) { return "<div class=\"prrow\"><span>" + r[0] + "</span><span>" + r[1] + "</span></div>"; }).join("") +
            "<div class=\"prnote\">The cap rate here is not an opinion; it is built from the two parties who have to be paid, the lender's mortgage constant on " + Math.round(M * 100) + " percent of the money and your " + pc(coc) + " requirement on the rest. Above about 85 percent break even occupancy a deal has no room in it. Vacancy is held at five percent, upkeep at eight, management at eight; overtype the rent and taxes and the engine follows you. Education, not investment advice.</div>";
          if (opts.onResize) opts.onResize();
        });
        if (opts.onResize) opts.onResize();
      });
    }

    /* ---------- the comparable sales tile ---------- */
    function loadComps() {
      var body = document.querySelector("#" + id + "cmp .prbody");
      body.innerHTML = "<div class=\"prwait\">Asking the county for what actually sold nearby. The deep engines take a moment.</div>";
      Promise.all([needRec(), getJson("/api/parcel?mode=comps&address=" + encodeURIComponent(st.address) + (st.county ? "&county=" + encodeURIComponent(st.county) : ""))]).then(function (rs) {
        var d = rs[1];
        if (!d || d.error || !(d.comps || []).length) {
          body.innerHTML = "<div class=\"prnote\"><b>Nothing nearby came back.</b> " + esc((d && (d.limits || []).join(" ")) || "The deep comparable engines run where the county publishes sales with geometry; the coverage tile below names them.") + "</div>";
          return;
        }
        var s = d.subject || {};
        var h = "<table class=\"prtab\"><tr><th>Address</th><th>Sq ft</th><th>Built</th><th>Sold for</th><th>When</th></tr>";
        h += "<tr style=\"background:rgba(169,136,79,.14)\"><td><b>" + esc(s.address || "This property") + "</b></td><td>" + (s.heatedArea ? s.heatedArea.toLocaleString() : "&#8212;") + "</td><td>" + (s.yearBuilt || "&#8212;") + "</td><td>" + (s.salePrice ? money(s.salePrice) : "&#8212;") + "</td><td>" + (s.saleDate || "&#8212;") + "</td></tr>";
        var prices = [];
        (d.comps || []).forEach(function (c) {
          if (c.salePrice) prices.push(c.salePrice);
          h += "<tr><td>" + esc(c.address || "") + "</td><td>" + (c.heatedArea ? c.heatedArea.toLocaleString() : "&#8212;") + "</td><td>" + (c.yearBuilt || "&#8212;") + "</td><td>" + (c.salePrice ? money(c.salePrice) : "&#8212;") + "</td><td>" + (c.saleDate || "&#8212;") + "</td></tr>";
        });
        h += "</table>";
        var msg = "<div class=\"prnote\"><b>" + d.comps.length + " comparable" + (d.comps.length === 1 ? "" : "s") + "</b>, found inside " + esc(d.searchMiles || "a fraction") + " of a mile" + (d.sizeBand ? " and within " + esc(d.sizeBand) + " percent of the square footage" : "") + ".";
        if (prices.length) {
          prices.sort(function (a, b) { return a - b; });
          msg += " The recorded prices ran " + money(prices[0]) + " to " + money(prices[prices.length - 1]) + ", a range and the rows behind it, never an average dressed up as an answer.";
        }
        msg += " Under N.C. Gen. Stat. Section 93A-83(f) a comparison like this must never be called a valuation or an appraisal, so there is deliberately no conclusion of value here; the adjustments are the licensed half of the craft." +
          (d.source ? " Source: " + esc(d.source) + "." : "") + "</div>";
        body.innerHTML = h + msg;
        if (opts.onResize) opts.onResize();
      });
    }

    /* ---------- the coverage tile: the honest map ---------- */
    function loadCoverage() {
      var body = document.querySelector("#" + id + "cov .prbody");
      body.innerHTML = "<div class=\"prwait\">Reading the coverage ledger.</div>";
      Promise.all([siteData("coverage"), siteData("rodmap")]).then(function (rs) {
        var cov = rs[0], rodmap = rs[1];
        if (!cov || !cov.county) {
          body.innerHTML = "<div class=\"prnote\">The coverage ledger did not answer just now.</div>";
          return;
        }
        var tiers = { deep: [], standard: [], thin: [] };
        Object.keys(cov.county).forEach(function (c) {
          var t = cov.county[c].tier || "standard";
          (tiers[t] = tiers[t] || []).push(c);
        });
        var rodAll = rodmap && rodmap.counties ? Object.keys(rodmap.counties) : [];
        var rodPdf = rodAll.filter(function (k) { return rodmap.counties[k].pdf; });
        var cap = function (s) { return s.charAt(0) + s.slice(1).toLowerCase(); };
        var h = "<div class=\"prnote\" style=\"margin-top:4px\">This is a working tool, so here is its working truth, counted from the sources on " + esc(cov.checked || "the day it last ran") + " rather than claimed. Every one of the 100 North Carolina counties answers through the statewide parcel layer; how deep the answer goes differs, and the honest ledger reads like this.</div>";
        h += "<div class=\"prrow\"><span><b>Deep</b>, the county's own system answers with building detail and the ownership chain</span><span><b>" + tiers.deep.length + " counties</b></span></div>";
        h += "<div class=\"prchips\">" + tiers.deep.sort().map(function (c) { return "<span class=\"prchip\">" + esc(c) + "</span>"; }).join("") + "</div>";
        h += "<div class=\"prrow\" style=\"margin-top:8px\"><span><b>Standard</b>, the statewide layer carries the record: address, values, deed reference, sale date</span><span><b>" + tiers.standard.length + " counties</b></span></div>";
        h += "<div class=\"prrow\"><span><b>Thin</b>, the statewide layer holds only part of the record for now, and these are the ones we are still updating to get there</span><span><b>" + tiers.thin.length + " counties</b></span></div>";
        h += "<div class=\"prchips\">" + tiers.thin.sort().map(function (c) { return "<span class=\"prchip\">" + esc(c) + "</span>"; }).join("") + "</div>";
        h += "<div class=\"prrow\" style=\"margin-top:8px\"><span><b>The scanned deed opens inline</b>, served live from the county imaging system</span><span><b>" + rodPdf.length + " counties</b></span></div>";
        h += "<div class=\"prchips\">" + rodPdf.sort().map(function (c) { return "<span class=\"prchip\">" + esc(cap(c)) + "</span>"; }).join("") + "</div>";
        h += "<div class=\"prrow\"><span><b>The register of deeds is wired</b>, a one tap door to the county search</span><span><b>" + rodAll.length + " counties</b></span></div>";
        h += "<div class=\"prnote\">Where a county is not wired yet, the tool says so out loud instead of guessing, and hands you the county's own front door. That is the standard the whole room runs on: a number from the record or an honest silence, never a stage prop.</div>";
        body.innerHTML = h;
        if (opts.onResize) opts.onResize();
      });
    }

    var loaders = { deed: loadDeed, eq: loadEquity, cmp: loadComps, cov: loadCoverage };

    return {
      setAddress: function (a, c) { st.address = a; st.county = c || ""; st.rec = null; },
      record: function () { return st.rec; }
    };
  }

  window.PropertyRoom = { mount: mount };
})();
