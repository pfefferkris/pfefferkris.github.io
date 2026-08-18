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
      /* the charts sit ON the tile, not in a box of their own: transparent canvas, no border,
         no second pane of glass, exactly the way the Grow season draws them */
      ".grpane{position:relative;width:100%;background:transparent;border:none;box-shadow:none}" +
      ".grpane .cv{width:100%;height:100%}" +
      ".grp1{height:300px}.grp2{height:250px}" +
      "@media(max-width:640px){.grp1{height:230px}.grp2{height:200px}}" +
      ".grlabels{position:absolute;inset:0;pointer-events:none;overflow:hidden}" +
      ".grlab{position:absolute;font-size:11px;font-weight:750;line-height:1.15;white-space:nowrap;padding:3px 6px;border-radius:5px;" +
      "background:rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(18,41,63,.1)}" +
      ".grlab i{font-style:normal;font-variant-numeric:tabular-nums;opacity:.85;margin-left:4px}" +
      ".grchip .grsw{width:12px;height:12px;border-radius:3px;flex:none;display:inline-block;box-shadow:inset 0 0 0 1px rgba(255,255,255,.6)}" +
      ".grchip .grsw.dash{border-radius:2px;height:4px;width:16px}" +
      ".grchip{display:inline-flex;align-items:center;gap:7px}" +
      ".grchip .pc{font-variant-numeric:tabular-nums;font-weight:700;font-size:11.5px}" +
      ".grhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin:18px 0 2px}" +
      ".grhead .ttl{font-family:Georgia,serif;font-size:16px;color:var(--navy,#12293f);font-weight:700}" +
      ".grhead .sub{font-size:12.5px;color:var(--muted,#5a6a78)}" +
      /* the workbook tables live behind a door: nobody should meet a covariance matrix
         before they have seen the shape of the ride */
      ".gradv{border:1px solid rgba(169,136,79,.4);border-radius:14px;margin-top:16px;overflow:hidden;" +
      "background:linear-gradient(135deg,rgba(255,255,255,.5),rgba(255,255,255,.24));" +
      "backdrop-filter:blur(16px) saturate(1.35);-webkit-backdrop-filter:blur(16px) saturate(1.35)}" +
      ".gradvh{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 18px;cursor:pointer;user-select:none}" +
      ".gradvh b{color:var(--navy,#12293f);font-size:14px}" +
      ".gradvh span.s{display:block;font-weight:400;font-size:12.5px;color:var(--muted,#5a6a78);margin-top:3px}" +
      ".gradvh .ar{color:var(--goldtext,#8a6d3b);font-size:15px;transition:transform .25s;flex:none}" +
      ".gradv.on .gradvh .ar{transform:rotate(90deg)}" +
      ".gradvb{display:none;padding:0 18px 16px}" +
      ".gradv.on .gradvb{display:block;animation:grfade .35s ease}" +
      "@keyframes grfade{from{opacity:0}to{opacity:1}}" +
      ".grptitle{margin-top:12px;font-size:13.5px;line-height:1.65;color:var(--navy,#12293f)}";
    document.head.appendChild(s);
  }

  function mount(host, opts) {
    injectCss();
    opts = opts || {};
    /* Wherever this page asks anyone about a company or a holding, it asks the same way:
       tap a sample and watch it work, or type your own tickers, and the charts come first
       either way with the workbook behind a door. A mount that quietly dropped the samples
       would be a different, poorer tool wearing the same name. */
    if (opts.presets === undefined) opts.presets = true;
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
      (opts.presets ? "<div id=\"" + id + "pre\" class=\"grkey\" style=\"margin-top:10px\"><span class=\"kl\">Or start from a sample</span></div><div class=\"grnote\" id=\"" + id + "prenote\"></div>" : "") +
      "<div id=\"" + id + "out\" class=\"grout\"></div>" +
      (opts.retire ? "<div id=\"" + id + "ret\"></div>" : "") +
      (opts.lessons ? "<div id=\"" + id + "les\"></div>" : "");

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

    function rowFor(sym) {
      var rows = rowsEl.querySelectorAll(".grrow"), hit = null;
      rows.forEach(function (r) { if ((r.querySelector(".grtk").value || "").trim().toUpperCase() === sym) hit = r; });
      return hit;
    }
    function seed(positions) {
      (positions || []).forEach(function (p) {
        var sym = String(p.sym || "").toUpperCase();
        if (!sym) return;
        var hit = rowFor(sym);
        if (hit) { if (!(parseFloat(hit.querySelector(".grval").value) > 0) && p.val) hit.querySelector(".grval").value = p.val; }
        else addRow(sym, p.val);
      });
      /* empty untouched starter rows fall away once real positions arrive */
      rowsEl.querySelectorAll(".grrow").forEach(function (r) {
        if (!(r.querySelector(".grtk").value || "").trim() && rowsEl.querySelectorAll(".grrow").length > 1) r.remove();
      });
    }

    /* ---- the copy trade sample mixes, from public STOCK Act disclosure reporting ---- */
    if (opts.presets) {
      getJson("/data/copytrade.json").then(function (ct) {
        var holder = document.getElementById(id + "pre");
        if (!holder || !ct || !ct.presets) return;
        var note = document.getElementById(id + "prenote");
        if (note) note.textContent = "Not sure yet? Tap a sample and watch it work first. " + (ct.note || "") + " " + (ct.stat || "") + " Tap one to bring it in, tap it again to pull it back out; two at a time combine into one graded portfolio, your own tickers ride alongside, and any row you type over becomes yours and stays put when the mix leaves.";
        ct.presets.forEach(function (ps) {
          var b = document.createElement("span");
          b.className = "grchip";
          b.textContent = ps.label;
          b.title = ps.desc || "";
          b.addEventListener("click", function () {
            var on = b.classList.toggle("on");
            if (on) {
              ps.positions.forEach(function (pp) {
                var sym = String(pp[0]).toUpperCase();
                var hit = rowFor(sym);
                if (hit) {
                  var k = (hit.dataset.pk || "").split(" ").filter(Boolean);
                  if (k.indexOf(ps.key) < 0) k.push(ps.key);
                  hit.dataset.pk = k.join(" ");
                  if (!(parseFloat(hit.querySelector(".grval").value) > 0)) hit.querySelector(".grval").value = pp[1];
                } else {
                  var r = addRow(sym, pp[1]);
                  r.dataset.pk = ps.key;
                  r.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", function () { r.dataset.mine = "1"; }); });
                }
              });
              rowsEl.querySelectorAll(".grrow").forEach(function (r) {
                if (!(r.querySelector(".grtk").value || "").trim() && !r.dataset.pk) r.remove();
              });
            } else {
              rowsEl.querySelectorAll(".grrow").forEach(function (r) {
                var k = (r.dataset.pk || "").split(" ").filter(Boolean);
                if (k.indexOf(ps.key) < 0) return;
                var left = k.filter(function (x) { return x !== ps.key; });
                r.dataset.pk = left.join(" ");
                if (!left.length && r.dataset.mine !== "1") r.remove();
              });
              if (!rowsEl.querySelector(".grrow")) addRow();
            }
            if (document.getElementById(id + "out").innerHTML) run();
          });
          holder.appendChild(b);
        });
      });
    }

    /* ---- Step 3: will it be enough to retire on ---- */
    if (opts.retire) {
      var LONGRUN = 10; /* long run U.S. large cap average, a teaching constant, an average and never a promise */
      var fvv = function (p, y, r) { return p * Math.pow(1 + r, y); };
      var fvStream = function (a, y, r) { return r > 0 ? a * ((Math.pow(1 + r, y) - 1) / r) : a * y; };
      var ret = document.getElementById(id + "ret");
      ret.innerHTML =
        "<div class=\"grptitle\" style=\"margin-top:18px\"><b>Will it be enough to retire on?</b> The method: project the nest egg, turn it into income by the four percent rule, and compare it to your final working year of pay. That percentage is your replacement rate, and it is the number retirement planning actually optimizes.</div>" +
        "<div class=\"grrow\" style=\"grid-template-columns:repeat(auto-fit,minmax(120px,1fr))\">" +
        "<label><span class=\"grlab\">Your age today</span><input type=\"number\" class=\"r_age\" placeholder=\"40\"></label>" +
        "<label><span class=\"grlab\">Retire at age</span><input type=\"number\" class=\"r_rage\" placeholder=\"65\"></label>" +
        "<label><span class=\"grlab\">Salary today</span><input type=\"number\" class=\"r_sal\" placeholder=\"120000\"></label>" +
        "<label><span class=\"grlab\">Raises per year, percent</span><input type=\"number\" class=\"r_raise\" value=\"3\"></label>" +
        "<label><span class=\"grlab\">Retirement balance today</span><input type=\"number\" class=\"r_bal\" placeholder=\"150000\"></label>" +
        "<label><span class=\"grlab\">What you save monthly</span><input type=\"number\" class=\"r_mon\" placeholder=\"1000\"></label>" +
        "</div><div class=\"grnote\" id=\"" + id + "rout\">Fill the boxes and the whole chain computes as you type: nothing is stored, and the number is never a grade on the past, always just the road from here.</div>";
      var rcalc = function () {
        var g = function (c) { return parseFloat(ret.querySelector(c).value) || 0; };
        var age = g(".r_age"), rage = g(".r_rage"), sal = g(".r_sal"), raise = g(".r_raise") / 100, bal = g(".r_bal"), mon = g(".r_mon");
        var out = document.getElementById(id + "rout");
        if (!(age > 0 && rage > age && sal > 0)) return;
        var y2 = rage - age;
        var finalSal = sal * Math.pow(1 + raise, y2);
        var nest = fvv(bal, y2, LONGRUN / 100) + fvStream(mon * 12, y2, LONGRUN / 100);
        var income = nest * 0.04;
        var ssRep = 0.40, targetRep = 0.75;
        var rep = finalSal > 0 ? income / finalSal : 0;
        var eff = rep + ssRep;
        var needRep = Math.max(0, targetRep - ssRep);
        var nestNeed = needRep * finalSal / 0.04;
        var haveFV = fvv(bal, y2, LONGRUN / 100);
        var annuityF = fvStream(1, y2, LONGRUN / 100);
        var needMonthly = annuityF > 0 ? Math.max(0, nestNeed - haveFV) / annuityF / 12 : 0;
        var m = function (n) { return "$" + Math.round(n).toLocaleString("en-US"); };
        var ok = eff >= targetRep;
        out.innerHTML = "Retiring at " + rage + ", your final working year of pay projects to about <b>" + m(finalSal) + "</b>. The nest egg projects to <b>" + m(nest) + "</b> at the long run average of about " + LONGRUN + " percent, an average and not a promise. By the four percent rule that is " + m(income) + " a year, a replacement rate of <b style=\"color:" + (ok ? "var(--good,#2e7d4f)" : "var(--brick,#8a3d3a)") + "\">" + Math.round(eff * 100) + " percent</b> with Social Security credited at roughly 40 points for a medium earner, against the 75 percent planners target. " +
          (ok ? "<b>The road you are on arrives.</b> The plan now is protecting it: fees, concentration, and the documents." :
          "<b>Your number: " + (needMonthly < 1 ? "covered" : m(needMonthly) + " a month") + ".</b> Savings need to carry about " + Math.round(needRep * 100) + " points; that takes a nest egg of about " + m(nestNeed) + ", what you already hold grows to " + m(haveFV) + " on its own, and closing the rest from today takes about " + m(needMonthly) + " a month. Only two levers exist: a more aggressive savings strategy, or a later retirement age.") +
          " And keep the two buckets separate, always: the graded portfolio above is the playground; the retirement bucket rides the whole market in an index or target date fund on purpose, because this money is not for playing.";
        if (opts.onResize) opts.onResize();
      };
      ret.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", rcalc); });
    }

    /* ---- the two lessons everyone gets ---- */
    if (opts.lessons) {
      var les = document.getElementById(id + "les");
      les.innerHTML =
        "<div class=\"grptitle\" style=\"margin-top:18px\"><b>Two lessons I give everyone.</b></div>" +
        "<div class=\"grrow\" style=\"grid-template-columns:minmax(140px,220px) 1fr; align-items:end\">" +
        "<label><span class=\"grlab\">1. The fee lesson: fund expense ratio, percent</span><input type=\"number\" class=\"l_fee\" step=\"0.05\" min=\"0\" max=\"3\" placeholder=\"0.75\"></label>" +
        "<div class=\"grnote\" id=\"" + id + "feeout\" style=\"margin-top:0\">What does the expense ratio quietly cost over a working lifetime? Type one and see.</div></div>" +
        "<div class=\"grnote\"><b>2. The allocation lesson.</b> Pop quiz: what explains over 90 percent of the difference in returns between portfolios?</div>" +
        "<div class=\"grkey\" id=\"" + id + "quiz\"></div><div class=\"grnote\" id=\"" + id + "quizout\"></div>";
      var feeIn = les.querySelector(".l_fee");
      feeIn.addEventListener("input", function () {
        var fee = parseFloat(feeIn.value) || 0;
        var out = document.getElementById(id + "feeout");
        if (!fee) { out.textContent = "What does the expense ratio quietly cost over a working lifetime? Type one and see."; return; }
        var yrs = 40, annual = 12000;
        var fvS = function (a, y, r) { return r > 0 ? a * ((Math.pow(1 + r, y) - 1) / r) : a * y; };
        var gross = fvS(annual, yrs, 0.10), net = fvS(annual, yrs, 0.10 - fee / 100);
        var m = function (n) { return "$" + Math.round(n).toLocaleString("en-US"); };
        out.innerHTML = "On $1,000 a month for 40 years at the long run average, a " + fee + " percent ratio quietly takes <b style=\"color:var(--brick,#8a3d3a)\">" + m(gross - net) + "</b> of the " + m(gross) + " you would have had, because fee drag compounds at the same exponent returns do. An index fund at 0.03 costs almost nothing for the same market.";
        if (opts.onResize) opts.onResize();
      });
      var QA = [["Stock picking", false], ["Market timing", false], ["Asset allocation", true], ["Fees", false]];
      var quiz = document.getElementById(id + "quiz");
      QA.forEach(function (q) {
        var c = document.createElement("span");
        c.className = "grchip";
        c.textContent = q[0];
        c.addEventListener("click", function () {
          quiz.querySelectorAll(".grchip").forEach(function (x) { x.classList.remove("on"); });
          c.classList.add("on");
          document.getElementById(id + "quizout").innerHTML = (q[1] ? "<b>Correct.</b> " : "The popular answer, but no. ") +
            "Landmark research found that <b>asset allocation</b>, the mix between stocks, bonds, and cash, explains over 90 percent of the variation in portfolio returns. Stock picking and market timing, the two things the industry sells hardest, explain almost none of it. Get the mix right for your horizon and the hard part is done.";
          if (opts.onResize) opts.onResize();
        });
        quiz.appendChild(c);
      });
    }

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

        var heavy = rows.filter(function (r) { return r.w > 0.10 && rows.length > 1; });
        var dfmt = function (t) { return new Date(t * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };

        /* 1. the three numbers, quick */
        var h = "<div class=\"grstats\">" +
          "<div class=\"grstat\"><span>Your year</span><b>" + pct(pReal) + "</b><i>market " + pct(mktReal) + "</i></div>" +
          "<div class=\"grstat\"><span>Your ride</span><b>" + (pSd * 100).toFixed(0) + "% swings</b><i>market " + (mSd * 100).toFixed(0) + "%</i></div>" +
          "<div class=\"grstat\"><span>Paid per unit of risk</span><b>" + pSharpe.toFixed(2) + "</b><i>market " + mSharpe.toFixed(2) + ", higher is better</i></div></div>";

        /* 2. THE CHARTS, before any table. Nobody should meet a covariance matrix before
              they have seen the shape of the ride. */
        h += "<div class=\"grhead\"><span class=\"ttl\">How each holding actually travelled</span>" +
          "<span class=\"sub\">every line starts at 100 on " + dfmt(common[0]) + ", so the picture is percent gained or lost, not dollars of share price</span></div>" +
          "<div class=\"grkey\" id=\"" + id + "key\"><span class=\"kl\">Tap a company to follow it below</span></div>" +
          "<div class=\"grpane grp1\"><div class=\"cv\" id=\"" + id + "c1\"></div><div class=\"grlabels\" id=\"" + id + "l1\"></div></div>" +
          "<div class=\"grhead\"><span class=\"ttl\" id=\"" + id + "ct\">&#8212;</span></div>" +
          "<div class=\"grpane grp2\"><div class=\"cv\" id=\"" + id + "c2\"></div></div>" +
          "<div class=\"grnote\">Top pane: the shape of the ride, all of them together. Bottom pane: one company at a time, as candlesticks, because candles cover each other up when you stack companies on one pane and you end up reading nothing. Each candle is one trading day, or one week once the window gets long enough that daily candles would be thinner than a hair: the body runs from the open to the close, green when the close finished above the open, and the thin wick marks the highest and lowest the price traded that session. Charts drawn with TradingView Lightweight Charts.</div>";

        /* 3. how to read it, in plain words */
        var best = rows.slice().sort(function (a, b) { return b.alpha - a.alpha; })[0];
        var worst = rows.slice().sort(function (a, b) { return a.alpha - b.alpha; })[0];
        var avgCorr = null;
        if (rows.length > 1) {
          var cs = 0, cn = 0;
          for (var q1 = 0; q1 < rows.length; q1++) for (var q2 = q1 + 1; q2 < rows.length; q2++) {
            cs += cov(rets[q1], rets[q2]) / Math.sqrt(cov(rets[q1], rets[q1]) * cov(rets[q2], rets[q2])); cn++;
          }
          avgCorr = cs / cn;
        }
        h += "<div class=\"grhead\"><span class=\"ttl\">How to read it</span></div>";
        h += "<div class=\"grptitle\"><b>This is live.</b> Every number here was computed seconds ago from " + common.length + " trading days of real closing prices, " + dfmt(common[0]) + " to " + dfmt(common[common.length - 1]) + ", pulled the moment you tapped the button and never stored anywhere.</div>";
        h += "<div class=\"grptitle\"><b>Performance, in plain words.</b> The portfolio earned " + pct(pReal) + " over the last year, against " + pct(mktReal) + " for the market as a whole. Most people stop at that raw number, and it is the wrong place to stop, because it says nothing about how rough the ride was. Two roads reach the same town: one is smooth highway, the other is a cliff edge in the rain. The grade is the Sharpe ratio, how much return you were paid for each unit of worry. Yours came out to <b>" + pSharpe.toFixed(2) + "</b>; owning the whole market pays " + mSharpe.toFixed(2) + ". " +
          (pSharpe >= mSharpe ? "<b style=\"color:var(--good,#2e7d4f)\">You were paid better per unit of risk than the market pays</b>, which is what skill, or honest diversification, actually looks like." : "<b style=\"color:var(--brick,#8a3d3a)\">You carried more worry per dollar of reward than the market required</b>: the same or better result was available with a calmer ride, just by owning everything.") + "</div>";
        if (rows.length > 1) {
          h += "<div class=\"grptitle\"><b>Each holding, graded fairly.</b> First ask how wild a stock behaves compared to the market; a wild one has to earn more just to break even on the deal, the way a risky loan charges higher interest. That required amount is the hurdle, called CAPM. The difference between what it actually returned and that hurdle is alpha. <b>" + esc(best.s) + "</b> cleared its hurdle by " + pct(best.alpha) +
            (worst.alpha < 0 ? ", while <b>" + esc(worst.s) + "</b> came in " + pct(worst.alpha) + " below what its risk level owed you: big swings, no pay." : ", the strongest earner for its risk.") + "</div>";
        }
        h += "<div class=\"grptitle\"><b>The shape of the risk.</b> Beta is a volume knob tied to the market: at 1.00 your portfolio plays exactly as loud as the market plays. Yours sits at <b>" + pBeta.toFixed(2) + "</b>, so when the market moves a dollar this mix tends to move about $" + pBeta.toFixed(2) + ". " +
          (avgCorr !== null ? "Your holdings pulled together with an average correlation of <b>" + avgCorr.toFixed(2) + "</b>, where 1.00 means perfectly in step and near zero means they take turns. " +
            (avgCorr >= 0.6 ? "<b style=\"color:var(--brick,#8a3d3a)\">That is high</b>: when one of yours has a bad day the others usually have it too, so the eggs ride in one basket even though the names look different." :
             avgCorr >= 0.3 ? "That is moderate: some real spreading is happening, though they still lean the same way in a storm." :
             "<b style=\"color:var(--good,#2e7d4f)\">That is genuinely diversified</b>: your holdings zig at different times, which quietly smooths the whole ride.") + " " : "") +
          (heavy.length ? "And the weight sits piled up: " + heavy.map(function (r) { return "<b style=\"color:var(--brick,#8a3d3a)\">" + esc(r.s) + " is " + Math.round(r.w * 100) + " percent</b>"; }).join(", ") + " of the list. Risk from one company having a bad year is unsystematic risk, and the market pays nothing extra for carrying it, because spreading removes it for free. Concentration is unpaid risk." : "No single holding dominates the pile, which is the shape diversification is supposed to have: whatever risk remains is market risk, the kind you actually get paid for.") + "</div>";
        h += "<div class=\"grnote\">One year of history, illustrative only. Past performance never guarantees future results.</div>";

        /* 4. the workbook itself, behind a door */
        var tbl = "<div class=\"grtabwrap\"><table class=\"grtab\"><tr><th>Holding</th><th>Weight</th><th>Return, 1y</th><th>Risk</th><th>Beta</th><th>Alpha</th><th>The test</th></tr>";
        rows.forEach(function (r) {
          tbl += "<tr><td><b>" + esc(r.s) + "</b></td><td>" + Math.round(r.w * 100) + "%</td><td>" + pct(r.real) + "</td><td>" + (r.sd * 100).toFixed(0) + "%</td><td>" + r.beta.toFixed(2) + "</td><td class=\"" + (r.alpha >= 0 ? "pass" : "fail") + "\">" + pct(r.alpha) + "</td><td class=\"" + (r.pass ? "pass" : "fail") + "\">" + (r.pass ? "Pass" : "Fail") + "</td></tr>";
        });
        tbl += "<tr class=\"port\"><td>THE PORTFOLIO</td><td>100%</td><td>" + pct(pReal) + "</td><td>" + (pSd * 100).toFixed(0) + "%</td><td>" + pBeta.toFixed(2) + "</td><td></td><td>Sharpe " + pSharpe.toFixed(2) + "</td></tr>";
        tbl += "<tr><td>S&amp;P 500</td><td></td><td>" + pct(mktReal) + "</td><td>" + (mSd * 100).toFixed(0) + "%</td><td>1.00</td><td>0.0%</td><td>Sharpe " + mSharpe.toFixed(2) + "</td></tr></table></div>";
        tbl += "<div class=\"grnote\"><b>Reading the holdings table:</b> risk is how bumpy the ride was, beta is how hard a holding swings when the market swings, and alpha is the return earned beyond what that risk level demanded under CAPM, with the live 10 year Treasury at " + ((RATES && RATES.tenYear) || 4.3) + " percent as the floor. The test passes a holding that beat its risk requirement without carrying meaningfully more swing than the market itself.</div>";
        if (rows.length > 1) {
          tbl += "<div class=\"grtabwrap\"><table class=\"grtab\"><tr><th>Correlation</th>" + rows.map(function (r) { return "<th>" + esc(r.s) + "</th>"; }).join("") + "</tr>";
          for (var ci = 0; ci < rows.length; ci++) {
            tbl += "<tr><td><b>" + esc(rows[ci].s) + "</b></td>";
            for (var cj = 0; cj < rows.length; cj++) {
              var c = cov(rets[ci], rets[cj]) / Math.sqrt(cov(rets[ci], rets[ci]) * cov(rets[cj], rets[cj]));
              tbl += "<td class=\"" + (ci === cj ? "" : c < 0 ? "pass" : c >= 0.7 ? "fail" : "") + "\">" + c.toFixed(2) + "</td>";
            }
            tbl += "</tr>";
          }
          tbl += "</table></div><div class=\"grnote\"><b>Reading the correlation table:</b> this is the covariance matrix made human. Each cell asks, when this holding moves, does that one move with it? 1.00 on the diagonal is each holding agreeing with itself. Green negatives are the free lunch, pairs that take turns and smooth the ride. Brick reds above 0.70 are pairs that pretend to be two investments while behaving as one.</div>";
        }
        tbl += "<div class=\"grnote\"><b>The machinery, straight from the analysis workbook:</b> daily log returns LN(P<sub>t</sub> / P<sub>t-1</sub>) over " + common.length + " aligned trading days; a sample covariance matrix across every pair; beta = COV(stock, market) / VAR(market); realized return = e<sup>sum of log returns</sup> minus 1; CAPM required return = r<sub>f</sub> + beta (r<sub>market</sub> minus r<sub>f</sub>); Jensen alpha = realized minus required; portfolio variance is the double sum w<sub>i</sub>w<sub>j</sub>COV<sub>ij</sub>, annualized by 252 trading days.</div>";
        h += "<div class=\"gradv\" id=\"" + id + "adv\"><div class=\"gradvh\"><b>The workbook behind the charts" +
          "<span class=\"s\">the holdings table, the correlation matrix, and the arithmetic that produced both</span></b><span class=\"ar\">&#10148;</span></div>" +
          "<div class=\"gradvb\">" + tbl + "</div></div>";

        out.innerHTML = h;
        var adv = document.getElementById(id + "adv");
        if (adv) adv.querySelector(".gradvh").addEventListener("click", function () {
          adv.classList.toggle("on");
          if (opts.onResize) opts.onResize();
        });
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
          var ser = ch1.addSeries(LineSeries, { color: hd.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
          ser.setData(rebase(hd.close));
          hd.series = ser;
        });
        var benchArr = series[series.length - 1];
        var bs = ch1.addSeries(LineSeries, { color: BENCH, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
        bs.setData(rebase(benchArr));
        ch1.timeScale().fitContent();

        /* the name rides at the end of its own line, the way a newspaper labels a line chart,
           instead of being printed twice in a legend and again down the axis */
        var labHost = document.getElementById(id + "l1");
        var lastVal = function (arr) { return 100 * arr[arr.length - 1] / arr[0]; };
        function drawLabels() {
          if (!labHost) return;
          var items = holds.map(function (hd) { return { sym: hd.sym, color: hd.color, v: lastVal(hd.close), ser: hd.series }; });
          items.push({ sym: "S&P 500", color: BENCH, v: lastVal(benchArr), ser: bs });
          var placed = [];
          labHost.innerHTML = "";
          items.sort(function (a, b) { return b.v - a.v; }).forEach(function (it) {
            var y = it.ser.priceToCoordinate(it.v);
            if (y == null) return;
            /* never stack two labels on the same pixel row */
            while (placed.some(function (p) { return Math.abs(p - y) < 17; })) y += 17;
            placed.push(y);
            var d = document.createElement("div");
            d.className = "grlab";
            d.style.color = it.color;
            d.style.top = Math.max(0, Math.min(c1.clientHeight - 18, y - 9)) + "px";
            d.style.right = "58px";
            d.innerHTML = esc(it.sym) + "<i>" + (it.v >= 100 ? "+" : "") + (it.v - 100).toFixed(0) + "%</i>";
            labHost.appendChild(d);
          });
        }
        setTimeout(drawLabels, 60);
        if (window.ResizeObserver) { try { new ResizeObserver(function () { setTimeout(drawLabels, 30); }).observe(c1); } catch (e) {} }

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
          ct.innerHTML = "<b style=\"color:" + hd.color + "\">" + esc(hd.sym) + "</b> up close, " + (wk ? "weekly" : "daily") + " candles, " + pct(chg) + " over the window";
        };
        holds.forEach(function (hd, i) {
          var chip = document.createElement("span");
          chip.className = "grchip";
          var v = lastVal(hd.close) - 100;
          chip.innerHTML = "<span class=\"grsw\" style=\"background:" + hd.color + "\"></span>" + esc(hd.sym) +
            "<span class=\"pc\" style=\"color:" + (v >= 0 ? "#2E6B4F" : "#8A3B2E") + "\">" + (v >= 0 ? "+" : "") + v.toFixed(0) + "%</span>";
          chip.addEventListener("click", function () { follow(hd, chip); });
          key.appendChild(chip);
          if (i === 0) follow(hd, chip);
        });
        var bchip = document.createElement("span");
        bchip.className = "grchip";
        bchip.style.cursor = "default";
        bchip.innerHTML = "<span class=\"grsw dash\" style=\"background:" + BENCH + "\"></span>S&amp;P 500" +
          "<span class=\"pc\">" + ((lastVal(benchArr) - 100) >= 0 ? "+" : "") + (lastVal(benchArr) - 100).toFixed(0) + "%</span>";
        key.appendChild(bchip);
        if (opts.onResize) opts.onResize();
      }).catch(function () {});
    }

    return { run: run, addRow: addRow, seed: seed };
  }

  window.GrowRoom = { mount: mount };
})();
