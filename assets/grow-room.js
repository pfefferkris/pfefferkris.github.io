/* /assets/grow-room.js — the Grow season's live portfolio engine as one shared module.
   The same pipeline the Wealth Guide runs, mountable on any page: type any ticker or
   company name, search every U.S. listing, and the analysis workbook runs live in the
   browser: daily log returns, the covariance matrix, beta, CAPM required return,
   Jensen alpha, the pass test, Sharpe, the correlation table, and the two pane
   TradingView Lightweight Charts, lines indexed to 100 on top and one company's
   candles below. Consumers: wealth-guide.html and ricardo.html (the capstone portal).
   Nothing a visitor types is stored. Education, never investment advice. */
(function () {
  "use strict";
  if (window.GrowRoom) return;

  var SEQ = 0;
  var HIST = new Map();
  var RATES = null;
  var PAL = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#833250", "#486304", "#0132D9", "#7960FB", "#7900A7", "#BF269E"];
  var BENCH = "#5A6A78";
  var UP = "#2E6B4F", DOWN = "#8A3B2E";
  var GRID = "rgba(18,41,63,.07)", AXIS = "rgba(18,41,63,.16)";
  var LWCSRC = ["https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.8/dist/lightweight-charts.standalone.production.js",
    "https://unpkg.com/lightweight-charts@5.0.8/dist/lightweight-charts.standalone.production.js"];
  var LWCLIB = null;

  function getJson(u) { return fetch(u).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function mean(r) { var s = 0; for (var i = 0; i < r.length; i++) s += r[i]; return s / r.length; }
  function cov(a, b) { var n = a.length, ma = mean(a), mb = mean(b), s = 0; for (var i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb); return s / (n - 1); }
  function pct(x) { return (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%"; }
  function fetchHist(sym) {
    if (HIST.has(sym)) return HIST.get(sym);
    var pr = fetch("/api/history?symbol=" + encodeURIComponent(sym)).then(function (r) {
      if (!r.ok) throw new Error(sym);
      return r.json();
    });
    HIST.set(sym, pr);
    pr.catch(function () { HIST.delete(sym); });
    return pr;
  }
  function loadLWC() {
    if (LWCLIB) return LWCLIB;
    LWCLIB = new Promise(function (res, rej) {
      if (window.LightweightCharts) return res(window.LightweightCharts);
      var i = 0;
      var tryOne = function () {
        if (i >= LWCSRC.length) return rej(new Error("chart library unreachable"));
        var s = document.createElement("script");
        s.src = LWCSRC[i++]; s.async = true;
        s.onload = function () { window.LightweightCharts ? res(window.LightweightCharts) : tryOne(); };
        s.onerror = tryOne;
        document.head.appendChild(s);
      };
      tryOne();
    });
    return LWCLIB;
  }
  function day(t) { return new Date(t * 1000).toISOString().slice(0, 10); }
  function weekly(bars) {
    var out = [], by = new Map();
    bars.forEach(function (b) {
      var d = new Date(b.time + "T00:00:00Z");
      var dow = d.getUTCDay();
      var mon = new Date(d); mon.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
      var k = mon.toISOString().slice(0, 10);
      if (!by.has(k)) { by.set(k, { time: k, open: b.open, high: b.high, low: b.low, close: b.close }); out.push(by.get(k)); }
      else { var a = by.get(k); a.high = Math.max(a.high, b.high); a.low = Math.min(a.low, b.low); a.close = b.close; }
    });
    return out;
  }

  function injectCss() {
    if (document.getElementById("grcss")) return;
    var s = document.createElement("style");
    s.id = "grcss";
    s.textContent = "" +
      ".gr{margin-top:14px;font-size:14px;line-height:1.6;color:var(--ink,#1e2b36)}" +
      ".grrow{display:grid;grid-template-columns:1fr 130px 34px;gap:8px;margin-top:8px;align-items:end}" +
      ".grrow input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid rgba(169,136,79,.4);border-radius:10px;" +
      "background:rgba(255,255,255,.65);font:inherit;font-size:13px;color:var(--ink,#1e2b36)}" +
      ".grrow .grtk{text-transform:uppercase}" +
      ".grx{border:1px solid rgba(169,136,79,.35);border-radius:10px;background:rgba(255,255,255,.5);color:var(--muted,#5a6a78);" +
      "font:inherit;font-size:15px;cursor:pointer;height:38px}" +
      ".grx:hover{color:var(--brick,#8a3d3a);border-color:var(--brick,#8a3d3a)}" +
      ".grlab{display:block;font-size:12px;color:var(--muted,#5a6a78);margin-bottom:2px}" +
      ".grbtn{display:inline-block;border:1px solid rgba(169,136,79,.65);border-radius:12px;padding:9px 16px;margin-top:10px;margin-right:8px;" +
      "background:linear-gradient(135deg,rgba(255,255,255,.6),rgba(255,255,255,.3));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
      "color:var(--navy,#12293f);font:inherit;font-size:12.5px;font-weight:700;letter-spacing:.04em;cursor:pointer}" +
      ".grbtn:hover{background:var(--navy,#12293f);color:#fff;border-color:var(--navy,#12293f)}" +
      ".grbtn[disabled]{opacity:.55;cursor:wait}" +
      ".grstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px}" +
      ".grstat{border:1px solid rgba(169,136,79,.4);border-radius:12px;padding:10px 12px;" +
      "background:linear-gradient(135deg,rgba(255,255,255,.55),rgba(255,255,255,.28));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}" +
      ".grstat span{display:block;font-size:11px;color:var(--muted,#5a6a78);text-transform:uppercase;letter-spacing:.06em}" +
      ".grstat b{font-size:19px;color:var(--navy,#12293f);font-variant-numeric:tabular-nums}" +
      ".grstat i{display:block;font-size:11.5px;color:var(--muted,#5a6a78);font-style:normal}" +
      ".grtabwrap{overflow-x:auto;margin-top:10px}" +
      ".grtab{width:100%;border-collapse:collapse;font-size:12px}" +
      ".grtab th{color:var(--muted,#5a6a78);text-align:left;font-weight:600;padding:4px 6px;border-bottom:1px solid rgba(169,136,79,.4)}" +
      ".grtab td{padding:4px 6px;border-bottom:1px dashed rgba(169,136,79,.2);font-variant-numeric:tabular-nums}" +
      ".grtab td.pass{color:var(--good,#2e7d4f);font-weight:700}" +
      ".grtab td.fail{color:var(--brick,#8a3d3a);font-weight:700}" +
      ".grtab tr.port td{border-top:2px solid rgba(169,136,79,.5);font-weight:700}" +
      ".grnote{margin-top:9px;font-size:12.5px;color:var(--muted,#5a6a78)}" +
      ".grkey{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;align-items:center}" +
      ".grkey .kl{font-size:11px;color:var(--muted,#5a6a78);margin-right:4px}" +
      ".grchip{border:1px solid rgba(169,136,79,.4);border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.5)}" +
      ".grchip.on{background:var(--navy,#12293f);color:#fff;border-color:var(--navy,#12293f)}" +
      ".grpane{position:relative;height:300px;margin-top:8px;border:1px solid rgba(169,136,79,.3);border-radius:12px;" +
      "background:rgba(255,255,255,.45);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow:hidden}" +
      ".grpane .cv{position:absolute;inset:0}" +
      ".grptitle{margin-top:12px;font-size:13px;color:var(--navy,#12293f)}";
    document.head.appendChild(s);
  }

  function mount(host, opts) {
    injectCss();
    opts = opts || {};
    var id = "gr" + (++SEQ);
    var root = document.createElement("div");
    root.className = "gr";
    root.id = id;
    host.appendChild(root);

    root.innerHTML =
      "<div class=\"grnote\" style=\"margin-top:0\">" + (opts.intro || "Type any ticker or company name; the search covers every U.S. listing. The engine pulls a year of real daily closes the moment you run it, computes the whole workbook in your browser, and stores nothing.") + "</div>" +
      "<datalist id=\"" + id + "dl\"></datalist>" +
      "<div id=\"" + id + "rows\"></div>" +
      "<button class=\"grbtn\" id=\"" + id + "add\" type=\"button\">Another holding</button>" +
      "<button class=\"grbtn\" id=\"" + id + "run\" type=\"button\">Run the live analysis</button>" +
      "<div id=\"" + id + "out\"></div>";

    var rowsEl = document.getElementById(id + "rows");
    var dl = document.getElementById(id + "dl");
    var srchTimer = null;

    function wireSearch(inp) {
      inp.setAttribute("list", id + "dl");
      inp.addEventListener("input", function () {
        var q = inp.value.trim();
        if (q.length < 2) return;
        clearTimeout(srchTimer);
        srchTimer = setTimeout(function () {
          getJson("/api/search?q=" + encodeURIComponent(q)).then(function (j) {
            if (!j || !j.results || !j.results.length) return;
            dl.innerHTML = j.results.map(function (x) { return "<option value=\"" + esc(x.symbol) + "\">" + esc(x.name) + "</option>"; }).join("");
          });
        }, 250);
      });
    }
    function addRow(sym, val) {
      var r = document.createElement("div");
      r.className = "grrow";
      r.innerHTML = "<label><span class=\"grlab\">Ticker or company name, type to search</span><input type=\"text\" class=\"grtk\" placeholder=\"AAPL, or type Apple\" autocomplete=\"off\"></label>" +
        "<label><span class=\"grlab\">Value held</span><input type=\"number\" class=\"grval\" placeholder=\"15000\"></label>" +
        "<button class=\"grx\" type=\"button\" title=\"Take this row out\">&#215;</button>";
      if (sym) r.querySelector(".grtk").value = sym;
      if (val) r.querySelector(".grval").value = val;
      wireSearch(r.querySelector(".grtk"));
      r.querySelector(".grx").addEventListener("click", function () { r.remove(); });
      rowsEl.appendChild(r);
      return r;
    }
    (opts.positions && opts.positions.length ? opts.positions : [{}, {}]).forEach(function (p) { addRow(p.sym, p.val); });
    document.getElementById(id + "add").addEventListener("click", function () { addRow(); });

    var runBtn = document.getElementById(id + "run");
    runBtn.addEventListener("click", run);
    if (opts.autorun) run();

    async function run() {
      var held = [];
      rowsEl.querySelectorAll(".grrow").forEach(function (r) {
        var t = (r.querySelector(".grtk").value || "").trim().toUpperCase();
        var v = parseFloat(r.querySelector(".grval").value) || 0;
        if (t && v > 0) held.push({ tkr: t, val: v });
      });
      var out = document.getElementById(id + "out");
      if (!held.length) { out.innerHTML = "<div class=\"grnote\">A ticker and a dollar value first. The engine grades what you actually hold.</div>"; return; }
      runBtn.disabled = true; runBtn.textContent = "Reading a year of market data.";
      try {
        if (!RATES) RATES = await getJson("/data/rates.json");
        var rf = ((RATES && RATES.tenYear) || 4.3) / 100;
        var syms = held.map(function (p) { return p.tkr; });
        var data = await Promise.all(syms.concat(["^GSPC"]).map(fetchHist));
        var maps = data.map(function (d) { return new Map(d.points); });
        var common = Array.from(maps[maps.length - 1].keys()).filter(function (t) { return maps.every(function (m) { return m.has(t); }); }).sort(function (a, b) { return a - b; });
        if (common.length < 40) throw new Error("overlap");
        var series = maps.map(function (m) { return common.map(function (t) { return m.get(t); }); });
        var rets = series.map(function (s) { var r = []; for (var i = 1; i < s.length; i++) r.push(Math.log(s[i] / s[i - 1])); return r; });
        var mkt = rets[rets.length - 1];
        var mktVar = cov(mkt, mkt);
        var real = rets.map(function (r) { return Math.exp(r.reduce(function (s, x) { return s + x; }, 0)) - 1; });
        var mktReal = real[real.length - 1];
        var tot = held.reduce(function (s, p) { return s + p.val; }, 0);
        var rows = held.map(function (p, i) {
          var beta = cov(rets[i], mkt) / mktVar;
          var capm = rf + beta * (mktReal - rf);
          var alpha = real[i] - capm;
          return { s: p.tkr, w: p.val / tot, real: real[i], sd: Math.sqrt(cov(rets[i], rets[i]) * 252), beta: beta, capm: capm, alpha: alpha, pass: alpha >= 0 && beta <= 1.05 };
        });
        var pvar = 0;
        for (var i = 0; i < rows.length; i++) for (var j = 0; j < rows.length; j++) pvar += rows[i].w * rows[j].w * cov(rets[i], rets[j]);
        var pSd = Math.sqrt(pvar * 252);
        var pReal = rows.reduce(function (s, r) { return s + r.w * r.real; }, 0);
        var pBeta = rows.reduce(function (s, r) { return s + r.w * r.beta; }, 0);
        var pSharpe = pSd > 0 ? (pReal - rf) / pSd : 0;
        var mSd = Math.sqrt(mktVar * 252);
        var mSharpe = mSd > 0 ? (mktReal - rf) / mSd : 0;

        var h = "<div class=\"grstats\">" +
          "<div class=\"grstat\"><span>Your year</span><b>" + pct(pReal) + "</b><i>market " + pct(mktReal) + "</i></div>" +
          "<div class=\"grstat\"><span>Your ride</span><b>" + (pSd * 100).toFixed(0) + "% swings</b><i>market " + (mSd * 100).toFixed(0) + "%</i></div>" +
          "<div class=\"grstat\"><span>Paid per unit of risk</span><b>" + pSharpe.toFixed(2) + "</b><i>market " + mSharpe.toFixed(2) + ", higher is better</i></div></div>";
        h += "<div class=\"grtabwrap\"><table class=\"grtab\"><tr><th>Holding</th><th>Weight</th><th>Return, 1y</th><th>Risk</th><th>Beta</th><th>Alpha</th><th>The test</th></tr>";
        rows.forEach(function (r) {
          h += "<tr><td><b>" + esc(r.s) + "</b></td><td>" + Math.round(r.w * 100) + "%</td><td>" + pct(r.real) + "</td><td>" + (r.sd * 100).toFixed(0) + "%</td><td>" + r.beta.toFixed(2) + "</td><td class=\"" + (r.alpha >= 0 ? "pass" : "fail") + "\">" + pct(r.alpha) + "</td><td class=\"" + (r.pass ? "pass" : "fail") + "\">" + (r.pass ? "Pass" : "Fail") + "</td></tr>";
        });
        h += "<tr class=\"port\"><td>THE PORTFOLIO</td><td>100%</td><td>" + pct(pReal) + "</td><td>" + (pSd * 100).toFixed(0) + "%</td><td>" + pBeta.toFixed(2) + "</td><td></td><td>Sharpe " + pSharpe.toFixed(2) + "</td></tr>";
        h += "<tr><td>S&amp;P 500</td><td></td><td>" + pct(mktReal) + "</td><td>" + (mSd * 100).toFixed(0) + "%</td><td>1.00</td><td>0.0%</td><td>Sharpe " + mSharpe.toFixed(2) + "</td></tr></table></div>";
        if (rows.length > 1) {
          h += "<div class=\"grtabwrap\"><table class=\"grtab\"><tr><th>Correlation</th>" + rows.map(function (r) { return "<th>" + esc(r.s) + "</th>"; }).join("") + "</tr>";
          for (var ci = 0; ci < rows.length; ci++) {
            h += "<tr><td><b>" + esc(rows[ci].s) + "</b></td>";
            for (var cj = 0; cj < rows.length; cj++) {
              var c = cov(rets[ci], rets[cj]) / Math.sqrt(cov(rets[ci], rets[ci]) * cov(rets[cj], rets[cj]));
              h += "<td class=\"" + (ci === cj ? "" : c < 0 ? "pass" : c >= 0.7 ? "fail" : "") + "\">" + c.toFixed(2) + "</td>";
            }
            h += "</tr>";
          }
          h += "</table></div>";
        }
        var heavy = rows.filter(function (r) { return r.w > 0.10 && rows.length > 1; });
        h += "<div class=\"grnote\"><b>How to read it:</b> beta is a volume knob tied to the market, at 1.00 a holding plays exactly as loud as the market plays. Alpha is the return earned beyond what that risk level demanded under CAPM, with the live 10 year Treasury at " + ((RATES && RATES.tenYear) || 4.3) + " percent as the floor. The test passes a holding that beat its risk requirement without carrying meaningfully more swing than the market itself. In the correlation table, green negatives are the free lunch, pairs that take turns and smooth the ride; brick reds above 0.70 are pairs that pretend to be two investments while behaving as one." +
          (heavy.length ? " And the weight sits piled up: " + heavy.map(function (r) { return "<b style=\"color:var(--brick,#8a3d3a)\">" + esc(r.s) + " is " + Math.round(r.w * 100) + " percent</b>"; }).join(", ") + " of the list. Concentration is unpaid risk: the market pays nothing extra for one company's bad year, because spreading removes it for free." : " No single holding dominates the pile, which is the shape diversification is supposed to have.") +
          " Computed seconds ago from " + common.length + " aligned trading days, never stored, one year of history, illustrative only.</div>";
        h += "<div class=\"grptitle\"><b>How each holding actually travelled.</b> Every line starts at 100, so the picture is percent gained or lost, not dollars of share price.</div>" +
          "<div class=\"grkey\" id=\"" + id + "key\"><span class=\"kl\">Tap a company to follow it below</span></div>" +
          "<div class=\"grpane\"><div class=\"cv\" id=\"" + id + "c1\"></div></div>" +
          "<div class=\"grptitle\" id=\"" + id + "ct\"></div>" +
          "<div class=\"grpane\"><div class=\"cv\" id=\"" + id + "c2\"></div></div>" +
          "<div class=\"grnote\">Top pane: the shape of the ride, together. Bottom pane: one company at a time, as candlesticks, because candles cover each other up when stacked. Each candle is one trading day, or one week once the window gets long; the body runs open to close, green when the close finished above the open. Charts drawn with TradingView Lightweight Charts.</div>";
        out.innerHTML = h;
        drawCharts(rows, common, series, data);
      } catch (e) {
        out.innerHTML = "<div class=\"grnote\">One of those tickers did not answer with enough history. Check the symbol spelling against your brokerage app; foreign listings need their suffix. Fix it and run again; nothing else on the page is affected.</div>";
      }
      runBtn.disabled = false; runBtn.textContent = "Run the live analysis";
      if (opts.onResize) opts.onResize();
    }

    function drawCharts(rows, common, series, data) {
      loadLWC().then(function (LWC) {
        var createChart = LWC.createChart, LineSeries = LWC.LineSeries, CandlestickSeries = LWC.CandlestickSeries,
          ColorType = LWC.ColorType, LineStyle = LWC.LineStyle, CrosshairMode = LWC.CrosshairMode;
        var c1 = document.getElementById(id + "c1"), c2 = document.getElementById(id + "c2");
        if (!c1 || !c2) return;
        var baseOpts = function () {
          return {
            layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#4a5a68", fontSize: 11 },
            grid: { vertLines: { visible: false }, horzLines: { color: GRID } },
            rightPriceScale: { borderColor: AXIS, scaleMargins: { top: 0.12, bottom: 0.10 } },
            timeScale: { borderColor: AXIS, fixLeftEdge: true, fixRightEdge: true },
            crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: "rgba(18,41,63,.35)", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#12293f" }, horzLine: { color: "rgba(18,41,63,.28)", width: 1, style: LineStyle.Dotted, labelBackgroundColor: "#12293f" } },
            handleScroll: false, handleScale: false, autoSize: true
          };
        };
        var days = common.map(day);
        var rebase = function (arr) { return days.map(function (d, k) { return { time: d, value: 100 * arr[k] / arr[0] }; }); };
        var ch1 = createChart(c1, baseOpts());
        var holds = rows.map(function (r, i) {
          return {
            sym: r.s, color: PAL[i % PAL.length], close: series[i],
            ohlc: ((data[i] && data[i].ohlc) || []).map(function (o) { return { time: day(o[0]), open: o[1], high: o[2], low: o[3], close: o[4] }; })
          };
        });
        holds.forEach(function (hd) {
          var s = ch1.addSeries(LineSeries, { color: hd.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: hd.sym });
          s.setData(rebase(hd.close));
        });
        var bs = ch1.addSeries(LineSeries, { color: BENCH, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true, title: "S&P 500" });
        bs.setData(rebase(series[series.length - 1]));
        ch1.timeScale().fitContent();

        var ch2 = createChart(c2, baseOpts());
        var cs = ch2.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN });
        var key = document.getElementById(id + "key");
        var ct = document.getElementById(id + "ct");
        var follow = function (hd, chip) {
          key.querySelectorAll(".grchip").forEach(function (x) { x.classList.remove("on"); });
          if (chip) chip.classList.add("on");
          var bars = hd.ohlc;
          var wk = bars.length > 0 && (c2.clientWidth / bars.length) < 5;
          cs.setData(wk ? weekly(bars) : bars);
          ch2.timeScale().fitContent();
          var first = bars[0], last = bars[bars.length - 1];
          var chg = first && last ? (last.close / first.open - 1) : 0;
          ct.innerHTML = "<b style=\"color:" + hd.color + "\">" + esc(hd.sym) + "</b>, " + (wk ? "weekly" : "daily") + " candles, " + pct(chg) + " over the window.";
        };
        holds.forEach(function (hd, i) {
          var chip = document.createElement("span");
          chip.className = "grchip";
          chip.style.borderColor = hd.color;
          chip.style.color = hd.color;
          chip.textContent = hd.sym;
          chip.addEventListener("click", function () { follow(hd, chip); });
          key.appendChild(chip);
          if (i === 0) follow(hd, chip);
        });
        if (opts.onResize) opts.onResize();
      }).catch(function () {});
    }

    return { run: run, addRow: addRow };
  }

  window.GrowRoom = { mount: mount };
})();
