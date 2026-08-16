#!/usr/bin/env python3
"""
build_map.py — the heat map, built as one self-contained file.

The data is inlined rather than fetched, so the page is a single artifact that works with
no server, no key, and no network beyond the basemap tiles. If the tiles fail the shapes
still draw; the county is legible without a road under it.
"""

import json, os, sys, io, datetime

SRC = os.environ.get("HOODS_OUT", "data/nc-neighborhoods.json")
CTX = os.environ.get("CONTEXT_OUT", "data/nc-context.json")
OUT = os.environ.get("MAP_OUT", "market-map.html")

HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>__TITLE__</title>
<style>__LEAFLET_CSS__</style>
<style>
:root{
  --navy:#12293f; --navy-2:#1c3d5c; --gold:#a9884f; --gold-text:#8a6d3b;
  --ink:#1e2b36; --muted:#5a6a78; --line:#e4ddd0; --bg:#faf8f3; --card:#ffffff;
  --brick:#8a3d3a;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--ink);background:var(--bg);overflow:hidden}
#map{position:absolute;inset:0;background:#eef0ec}
.leaflet-container{background:#eef0ec;font:inherit}
.leaflet-top.leaflet-right{margin-top:58px}
.leaflet-bar a{color:var(--navy);border-bottom-color:var(--line)}
@media (max-width:820px){.leaflet-top.leaflet-right{margin-top:4px}}

/* ---------- the card over the map ---------- */
.hud{position:absolute;z-index:600;background:rgba(255,255,255,.93);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid var(--line);border-radius:14px;
  box-shadow:0 14px 40px rgba(18,41,63,.16)}
#head{top:16px;left:16px;max-width:400px;padding:18px 20px 16px}
#head .eyebrow{color:var(--gold-text);text-transform:uppercase;letter-spacing:.2em;
  font-size:.62rem;font-weight:700;margin-bottom:8px}
#head h1{font-family:Georgia,serif;font-size:1.32rem;line-height:1.2;color:var(--navy);
  font-weight:700;letter-spacing:-.01em}
#head p{margin-top:9px;font-size:.79rem;line-height:1.55;color:var(--muted)}
#head .stat{margin-top:12px;display:flex;gap:16px;flex-wrap:wrap}
#head .stat div{font-size:.7rem;color:var(--muted);line-height:1.35}
#head .stat b{display:block;font-size:1.06rem;color:var(--navy);font-weight:700;
  font-variant-numeric:tabular-nums}

/* ---------- the mode switch ---------- */
#modes{margin-top:14px;display:flex;gap:6px;flex-wrap:wrap}
.mode{font-size:.7rem;font-weight:650;padding:7px 12px;border-radius:16px;cursor:pointer;
  border:1px solid var(--line);background:rgba(255,255,255,.7);color:var(--muted);
  transition:all .18s;user-select:none;white-space:nowrap}
.mode:hover{color:var(--navy);border-color:var(--gold)}
.mode.on{background:var(--navy);color:#fff;border-color:var(--navy)}

/* ---------- the readout ---------- */
#info{bottom:44px;left:16px;width:330px;padding:16px 18px;display:none}
#info.show{display:block}
#info h2{font-family:Georgia,serif;font-size:1.05rem;color:var(--navy);line-height:1.25;
  padding-right:22px}
#info .where{font-size:.68rem;color:var(--muted);text-transform:uppercase;
  letter-spacing:.1em;margin-top:4px}
#info .big{margin-top:12px;display:flex;align-items:baseline;gap:8px}
#info .big b{font-size:1.85rem;font-weight:700;font-variant-numeric:tabular-nums;
  letter-spacing:-.02em}
#info .big span{font-size:.72rem;color:var(--muted);line-height:1.3}
#spark{margin-top:12px;width:100%;height:56px;display:block}
#info table{width:100%;margin-top:10px;border-collapse:collapse;font-size:.72rem}
#info td{padding:3px 0;color:var(--muted)}
#info td:last-child{text-align:right;color:var(--ink);font-weight:650;
  font-variant-numeric:tabular-nums}
#info .thin{margin-top:9px;font-size:.66rem;color:var(--brick);line-height:1.45}
#close{position:absolute;top:12px;right:13px;cursor:pointer;color:var(--muted);
  font-size:1.05rem;line-height:1;padding:3px 5px;border-radius:4px}
#close:hover{background:var(--bg);color:var(--navy)}

/* ---------- the legend ---------- */
#legend{bottom:44px;right:16px;padding:13px 15px;width:210px}
#legend .t{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;
  color:var(--muted);margin-bottom:9px}
#ramp{height:11px;border-radius:6px;margin-bottom:5px}
#ticks{display:flex;justify-content:space-between;font-size:.63rem;color:var(--muted);
  font-variant-numeric:tabular-nums}
#legend .note{margin-top:10px;font-size:.62rem;color:var(--muted);line-height:1.45;
  border-top:1px solid var(--line);padding-top:8px}

/* ---------- search ---------- */
#find{top:16px;right:16px;width:250px;padding:0}
#find input{width:100%;border:none;background:transparent;outline:none;font:inherit;
  font-size:.8rem;padding:12px 15px;color:var(--ink);border-radius:14px}
#find input::placeholder{color:var(--muted)}
#hits{max-height:270px;overflow:auto;border-top:1px solid var(--line);display:none}
#hits.show{display:block}
#hits div{padding:8px 15px;font-size:.75rem;cursor:pointer;color:var(--ink);
  border-bottom:1px solid #f2eee6}
#hits div:hover{background:var(--bg)}
#hits div span{float:right;color:var(--muted);font-variant-numeric:tabular-nums}

/* ---------- the honesty, which does not get to be small ---------- */
#foot{position:absolute;bottom:0;left:0;right:0;z-index:700;padding:6px 84px 6px 16px;
  background:rgba(250,248,243,.94);border-top:1px solid var(--line);
  font-size:.63rem;color:var(--muted);line-height:1.5;text-align:center;
  backdrop-filter:blur(8px);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#foot.open{white-space:normal;text-align:left;max-height:42vh;overflow:auto;
  padding:12px 84px 12px 18px}
#footx{position:absolute;right:14px;bottom:5px;z-index:701;font-size:.6rem;
  color:var(--navy-2);cursor:pointer;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;padding:3px 5px}
#foot b{color:var(--navy);font-weight:650}
#foot a{color:var(--navy-2)}

@media (max-width:820px){
  #head{max-width:calc(100% - 32px)}
  #find{top:auto;bottom:44px;right:16px;left:16px;width:auto}
  #info{width:auto;right:16px;bottom:106px}
  #legend{display:none}
}
</style>
</head>
<body>
<div id="map"></div>

<div class="hud" id="head">
  <div class="eyebrow">__EYEBROW__</div>
  <h1>__H1__</h1>
  <p>__LEAD__</p>
  <div class="stat">
    <div><b id="s_med">—</b>county median</div>
    <div><b id="s_spread">—</b>10th to 90th</div>
    <div><b id="s_n">—</b>neighbourhoods</div>
  </div>
  <div id="modes">
    <div class="mode on" data-mode="cagr">Appreciation per year</div>
    <div class="mode" data-mode="recent">Last year alone</div>
    <div class="mode" data-mode="level">Price per foot</div>
  </div>
</div>

<div class="hud" id="find">
  <input id="q" placeholder="Find a neighbourhood" autocomplete="off" spellcheck="false">
  <div id="hits"></div>
</div>

<div class="hud" id="info">
  <div id="close">&times;</div>
  <h2 id="i_name"></h2>
  <div class="where" id="i_where"></div>
  <div class="big"><b id="i_big"></b><span id="i_biglab"></span></div>
  <svg id="spark" viewBox="0 0 300 56" preserveAspectRatio="none"></svg>
  <table id="i_tab"></table>
  <div class="thin" id="i_thin"></div>
</div>

<div class="hud" id="legend">
  <div class="t" id="l_title">Appreciation per year</div>
  <div id="ramp"></div>
  <div id="ticks"></div>
  <div class="note" id="l_note"></div>
</div>

<div id="foot"></div><div id="footx">method</div>

<script>__LEAFLET_JS__</script>
<script>
var DATA = __DATA_INLINE__;
var CTX  = __CTX__;
var COUNTY, FC;

/* Either the data is in this file or it is beside it. Nothing downstream knows which,
   which is the only reason one builder can produce both the standalone artifact and
   the page on the site. */
function boot(){
  COUNTY = Object.keys(DATA.counties)[0];
  FC = DATA.counties[COUNTY];
  start();
}
if (DATA) { boot(); }
else {
  Promise.all([
    fetch('data/nc-neighborhoods.json').then(function(r){ return r.json(); }),
    fetch('data/nc-context.json').then(function(r){ return r.json(); }).catch(function(){ return {}; })
  ]).then(function(a){ DATA = a[0]; CTX = a[1]; boot(); })
   .catch(function(e){
     document.getElementById('foot').textContent =
       'The neighbourhood data did not load, so there is nothing honest to draw. ' + e;
   });
}
function start(){

/* ---------------------------------------------------------------------------
   THE COLOUR.
   Appreciation is green and it deepens; that is the whole instruction. The ramp
   is anchored on the county's own distribution rather than on round numbers,
   because a fixed scale would render a slow county uniformly pale and a fast one
   uniformly dark, and in both cases hide the thing worth seeing, which is the
   spread WITHIN the county. Falling is brick, the same brick the rest of the site
   uses for a number going the wrong way, because green shading toward white reads
   as "a little growth" and a decline is not a little growth.
--------------------------------------------------------------------------- */
var GREENS = ['#eaf2e8','#cfe4c8','#aed7a3','#87c684','#5eb268','#399a57','#1c8047','#0b6338','#064a29'];
var BRICK  = ['#c98d86','#b0645d','#8a3d3a'];

/* Ranked, not scaled. Appreciation across a county is a skewed distribution: a
   handful of neighbourhoods run away and the rest bunch, so a linear ramp paints
   nearly everything pale and throws away the contrast that is the entire reason
   to draw a map. Colouring by where a neighbourhood RANKS among its neighbours
   uses the whole ramp every time, in every county, whatever the spread happens to
   be. The legend then reports the real value at each break, so the eye reads rank
   and the text reads dollars, and neither has to lie for the other. */
var RANK = {}, BREAKS = {};
function val(f, mode){
  var p = f.properties;
  if (mode === 'cagr')   return p.cagr;
  if (mode === 'recent') return p.recent;
  if (mode === 'level'){
    var y = FC.indexYears ? String(FC.indexYears[1]) : null;
    var s = p.series || {};
    if (y && s[y]) return s[y].psf;
    var ks = Object.keys(s).sort();
    return ks.length ? s[ks[ks.length-1]].psf : null;
  }
  return null;
}
function prepare(mode){
  if (RANK[mode]) return;
  var rows = FC.features.map(function(f, i){ return {i:i, v: val(f, mode)}; })
              .filter(function(r){ return r.v !== null && r.v !== undefined; });
  rows.sort(function(a,b){ return a.v - b.v; });
  var r = {}, n = rows.length, br = [];
  rows.forEach(function(x, k){ r[x.i] = n > 1 ? k/(n-1) : 1; });
  for (var b = 0; b <= GREENS.length; b++){
    br.push(rows[Math.min(n-1, Math.round(b/GREENS.length*(n-1)))].v);
  }
  RANK[mode] = r; BREAKS[mode] = br;
}
function colorFor(f, mode){
  prepare(mode);
  var v = val(f, mode);
  if (v === null || v === undefined) return '#dcdcd6';
  if (mode !== 'level' && v < 0){
    var d = Math.min(1, Math.abs(v)/6);
    return BRICK[Math.min(2, Math.floor(d*3))];
  }
  var t = RANK[mode][FC.features.indexOf(f)];
  if (t === undefined) return '#dcdcd6';
  return GREENS[Math.min(GREENS.length-1, Math.floor(t*GREENS.length))];
}

/* ------------------------------- the map ------------------------------- */
var map = L.map('map', { zoomControl:false, attributionControl:false });
L.control.zoom({position:'topright'}).addTo(map);
/* A grey basemap on purpose. The roads are there so you know where you are; the
   colour on the page belongs to the data, not to the cartography. */
/* The geography is in this file, not on someone else's CDN. Water first, then the
   municipal outlines, then the roads a person gives directions by. If the tile
   layer below never arrives the county is still perfectly readable, which is the
   point: a map that needs the network to be a map is not reliable enough to put a
   decision on. */
var G = CTX[COUNTY] || {};
map.createPane('ctxLow');  map.getPane('ctxLow').style.zIndex = 350;
map.createPane('ctxHigh'); map.getPane('ctxHigh').style.zIndex = 450;
map.getPane('ctxHigh').style.pointerEvents = 'none';
map.getPane('ctxLow').style.pointerEvents = 'none';
if (G.water) L.geoJSON(G.water, {pane:'ctxLow',
  style:{color:'#b9cfd8', weight:.4, fillColor:'#cfe0e7', fillOpacity:.85}}).addTo(map);
if (G.cities) L.geoJSON(G.cities, {pane:'ctxLow',
  style:{color:'#d8cfbc', weight:1, fill:false, dashArray:'3 4', opacity:.9}}).addTo(map);
var ROADW = {INTERSTATE:2.6, FREEWAY:2.6, EXPRESSWAY:2.0, SECONDARY:1.1, MAJOR:.75};
if (G.roads) L.geoJSON(G.roads, {pane:'ctxHigh', style:function(f){
  var t = (f.properties||{}).TYPE;
  return {color: (t==='INTERSTATE'||t==='FREEWAY'||t==='EXPRESSWAY') ? '#a08a66' : '#9aa4ad',
          weight: ROADW[t] || .6,
          opacity: (t==='MAJOR') ? .34 : .55};
}}).addTo(map);

/* And a street tile layer under all of it, for the people who want the labels.
   Optional by construction — it fails silently and nothing else changes. */
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
  {maxZoom:19, subdomains:'abcd', opacity:.55, errorTileUrl:
   'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}).addTo(map);

var MODE = 'cagr', HOVER = null, PICKED = null;
map.createPane('hoods'); map.getPane('hoods').style.zIndex = 400;
FC.features.sort(function(a,b){ return (b.properties.sqmi||0) - (a.properties.sqmi||0); });
var layer = L.geoJSON(FC, {
  pane: 'hoods',
  style: function(f){ return baseStyle(f); },
  onEachFeature: function(f, l){
    l.on('mouseover', function(){ hover(f, l); });
    l.on('mouseout',  function(){ hover(null, null); });
    l.on('click',     function(){ pick(f, l); });
  }
}).addTo(map);
map.fitBounds(layer.getBounds(), {padding:[26,26]});
window.__reset = function(){ map.fitBounds(layer.getBounds(), {padding:[26,26]}); };

function baseStyle(f){
  /* A rural district covering thirty square miles and a subdivision covering thirty
     acres carry the same field in the assessor's table. Drawn identically the district
     wins the map by sheer area and says something it does not know about any one street
     inside it. So it is drawn back: lighter, behind, and labelled as a district when you
     land on it. */
  var d = f.properties.district;
  return { fillColor: colorFor(f, MODE), fillOpacity: d ? .38 : .86,
           color: d ? '#f4f1ea' : '#ffffff', weight: d ? .5 : .7, opacity: d ? .6 : .85 };
}
/* Hovering is the whole interaction he asked for: the one under the cursor comes
   forward and everything else steps back. Not a highlight — a change of depth. */
function hover(f, l){
  HOVER = f;
  layer.eachLayer(function(x){
    var isIt = (x === l) || (PICKED && x.feature === PICKED);
    if (!f && !PICKED){ x.setStyle(baseStyle(x.feature)); return; }
    if (isIt){
      x.setStyle({ fillColor: colorFor(x.feature, MODE), fillOpacity:.97,
                   color:'#12293f', weight:2.2, opacity:1 });
      x.bringToFront();
    } else {
      x.setStyle({ fillColor: colorFor(x.feature, MODE), fillOpacity:.16,
                   color:'#ffffff', weight:.4, opacity:.5 });
    }
  });
  if (f) show(f);
  else if (PICKED) show(PICKED);
}
function pick(f, l){ PICKED = f; hover(f, l); }
document.getElementById('close').onclick = function(){
  PICKED = null; HOVER = null;
  layer.eachLayer(function(x){ x.setStyle(baseStyle(x.feature)); });
  document.getElementById('info').classList.remove('show');
};

/* ------------------------------ the readout ------------------------------ */
function pct(x){ return (x === null || x === undefined) ? '—' :
  (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
function show(f){
  var p = f.properties, box = document.getElementById('info');
  box.classList.add('show');
  document.getElementById('i_name').textContent = p.name;
  document.getElementById('i_where').textContent =
    (p.city ? p.city + ' · ' : '') + p.parcels.toLocaleString() + ' parcels' +
    (p.sqmi ? ' · ' + (p.sqmi < 1 ? p.sqmi.toFixed(2) : p.sqmi.toFixed(1)) + ' sq mi' : '');
  var big, lab;
  if (MODE === 'level'){
    big = '$' + Math.round(val(f,'level')); lab = 'per heated square foot,<br>' +
      (FC.indexYears ? FC.indexYears[1] : 'latest') + ' median';
    document.getElementById('i_big').style.color = '#12293f';
  } else {
    var v = val(f, MODE);
    big = pct(v);
    lab = MODE === 'cagr'
      ? 'a year, ' + FC.indexYears[0] + ' to ' + FC.indexYears[1] + '<br>in price per square foot'
      : 'in ' + FC.indexYears[1] + ' against ' + (FC.indexYears[1]-1);
    document.getElementById('i_big').style.color =
      (v === null) ? '#5a6a78' : (v < 0 ? '#8a3d3a' : '#237c48');
  }
  document.getElementById('i_big').innerHTML = big;
  document.getElementById('i_biglab').innerHTML = lab;

  var s = p.series || {}, ks = Object.keys(s).sort();
  var rows = ks.map(function(y){
    return '<tr><td>' + y + (String(FC.partialYear) === y ? ' <i>(partial)</i>' : '') +
      '</td><td>$' + s[y].psf.toFixed(0) + '/sf &nbsp;<span style="color:#5a6a78;' +
      'font-weight:400">' + s[y].n + ' sold</span></td></tr>';
  }).join('');
  document.getElementById('i_tab').innerHTML = rows;
  var caveat = [];
  if (p.district) caveat.push('This is a district, not a neighbourhood — ' +
    p.sqmi.toFixed(0) + ' square miles of it. The assessor uses one code for rural ground ' +
    'this size, so the figure is an average over a lot of very different land.');
  if (p.thin) caveat.push('Thin: fewer than eight sales in one of the two end years, so it ' +
    'is left out of the county figures above. Read the trend, not the decimal.');
  document.getElementById('i_thin').textContent = caveat.join(' ');
  spark(ks.map(function(y){ return s[y].psf; }), ks);
}
function spark(v, ks){
  var el = document.getElementById('spark');
  if (v.length < 2){ el.innerHTML = ''; return; }
  var lo = Math.min.apply(null,v), hi = Math.max.apply(null,v);
  if (hi === lo) hi = lo + 1;
  var W = 300, H = 56, pad = 7;
  var xs = v.map(function(_,i){ return pad + i*(W-2*pad)/(v.length-1); });
  var ys = v.map(function(y){ return H-pad - (y-lo)/(hi-lo)*(H-2*pad); });
  var d = xs.map(function(x,i){ return (i?'L':'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1); }).join(' ');
  var area = d + ' L' + xs[xs.length-1].toFixed(1) + ' ' + H + ' L' + xs[0].toFixed(1) + ' ' + H + ' Z';
  var up = v[v.length-1] >= v[0];
  var col = up ? '#237c48' : '#8a3d3a';
  el.innerHTML =
    '<path d="' + area + '" fill="' + col + '" opacity=".10"></path>' +
    '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.9" ' +
    'stroke-linejoin="round" stroke-linecap="round"></path>' +
    xs.map(function(x,i){ return '<circle cx="'+x.toFixed(1)+'" cy="'+ys[i].toFixed(1)+
      '" r="2.1" fill="'+col+'"></circle>'; }).join('');
}

/* -------------------------------- modes -------------------------------- */
[].forEach.call(document.querySelectorAll('.mode'), function(b){
  b.onclick = function(){
    [].forEach.call(document.querySelectorAll('.mode'), function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    MODE = b.getAttribute('data-mode');
    layer.eachLayer(function(x){ x.setStyle(baseStyle(x.feature)); });
    if (PICKED) show(PICKED);
    legend();
  };
});

/* -------------------------------- legend -------------------------------- */
function legend(){
  prepare(MODE);
  var br = BREAKS[MODE];
  var stops = GREENS.map(function(c,i){
    return c + ' ' + Math.round(i/(GREENS.length-1)*100) + '%'; }).join(',');
  document.getElementById('ramp').style.background = 'linear-gradient(90deg,' + stops + ')';
  var f = MODE === 'level'
    ? function(x){ return '$' + Math.round(x); }
    : function(x){ return (x>0?'+':'') + x.toFixed(1) + '%'; };
  /* The ramp is green and green is growth, so the ramp's low end is where growth
     starts, not where the worst decline is. Declines are brick and get their own
     line, because putting them under a green ramp would say they were a small
     amount of growth. */
  var lo = MODE === 'level' ? br[0] : Math.max(0, br[0]);
  document.getElementById('ticks').innerHTML =
    '<span>' + f(lo) + '</span><span>' + f(br[Math.floor(GREENS.length/2)]) +
    '</span><span>' + f(br[GREENS.length]) + '</span>';
  document.getElementById('l_title').textContent =
    MODE === 'cagr' ? 'Appreciation per year'
      : MODE === 'recent' ? 'Change in the last year' : 'Median price per square foot';
  document.getElementById('l_note').innerHTML = MODE === 'level'
    ? 'Shaded by rank within the county — darkest is the dearest ninth, not a national ' +
      'scale. Read this against the first map: cheap and rising is not dear and rising.'
    : 'Shaded by rank within the county, so the whole ramp is used and neighbours are ' +
      'compared to neighbours. Brick means the median fell. Grey means too few sales to ' +
      'say. The faint, very large shapes are rural districts, not neighbourhoods.';
}

/* -------------------------------- search -------------------------------- */
var Q = document.getElementById('q'), HITS = document.getElementById('hits');
Q.oninput = function(){
  var t = Q.value.trim().toUpperCase();
  if (t.length < 2){ HITS.classList.remove('show'); return; }
  var m = FC.features.filter(function(f){ return f.properties.name.indexOf(t) > -1; })
           .slice(0, 12);
  HITS.innerHTML = m.map(function(f, i){
    return '<div data-i="' + FC.features.indexOf(f) + '">' + f.properties.name +
      '<span>' + pct(f.properties.cagr) + '</span></div>'; }).join('')
    || '<div style="color:#5a6a78">nothing by that name</div>';
  HITS.classList.add('show');
};
HITS.onclick = function(e){
  var d = e.target.closest('div[data-i]'); if (!d) return;
  var f = FC.features[+d.getAttribute('data-i')];
  layer.eachLayer(function(x){
    if (x.feature === f){ map.fitBounds(x.getBounds(), {padding:[70,70], maxZoom:15}); pick(f, x); }
  });
  HITS.classList.remove('show'); Q.blur();
};

/* ------------------------------- the header ------------------------------- */
document.getElementById('s_med').textContent = pct(FC.countyMedianCagr);
document.getElementById('s_spread').textContent =
  pct(FC.spread.p10).replace('+','') + ' – ' + pct(FC.spread.p90).replace('+','');
document.getElementById('s_n').textContent = FC.features.length;
document.getElementById('foot').innerHTML =
  '<b>' + FC.method + '</b> ' + FC.notWhat + ' ' + FC.boundaries +
  ' The excise stamp and the recorded price agreed on <b>' + FC.stampCheck.rate + '%</b> of ' +
  FC.stampCheck.checked.toLocaleString() + ' checkable sales. Built ' +
  DATA.generated.slice(0,10) + ' from ' + COUNTY + ' County’s own tax parcel service.';
legend();
}

/* The method note is not a disclaimer to be buried; it is the reason to trust the
   colours. It sits on one line until you want it, and then it is all there. */
(function(){
  var f = document.getElementById('foot'), x = document.getElementById('footx');
  function t(){ f.classList.toggle('open'); x.textContent = f.classList.contains('open') ? 'close' : 'method'; }
  f.onclick = t; x.onclick = function(e){ e.stopPropagation(); t(); };
})();
</script>
</body>
</html>
"""


def main():
    if not os.path.exists(SRC):
        print("missing %s — run nc_hoods.py first" % SRC, file=sys.stderr)
        return 1
    data = json.load(open(SRC, encoding="utf-8"))
    ctx = json.load(open(CTX, encoding="utf-8")) if os.path.exists(CTX) else {}
    county = list(data["counties"])[0]
    fc = data["counties"][county]
    yrs = fc.get("indexYears") or []
    lead = ("Every shape is a neighbourhood the county assessor drew, and the shade is what "
            "houses inside it actually sold for per square foot, then and now. Hover to bring "
            "one forward. The county's own number is the median of all of them, and almost "
            "nobody lives at the median.")
    inline = os.environ.get("MAP_INLINE", "1") != "0"
    front = ""
    if not inline:
        # On the site the data is fetched, because eight megabytes of GeoJSON inlined into
        # a page is eight megabytes before the first pixel. As a standalone file it is
        # inlined, because there is nowhere to fetch from. Same builder, one switch.
        front = ("---\nsitemap: false\nlayout: null\npermalink: /market-map.html\n---\n")
    html = (HTML
            .replace("__TITLE__", "%s County — appreciation by neighbourhood" % county)
            .replace("__EYEBROW__", "%s County, North Carolina · %s to %s" %
                     (county, yrs[0] if yrs else "", yrs[1] if len(yrs) > 1 else ""))
            .replace("__H1__", "Where the money actually moved")
            .replace("__LEAD__", lead)
            .replace("__CTX__", json.dumps(ctx, separators=(",", ":")) if inline
                     else "null")
            .replace("__DATA_INLINE__", json.dumps(data, separators=(",", ":")) if inline
                     else "null")
            .replace("__LEAFLET_CSS__", io.open("leaflet.css", encoding="utf-8").read())
            .replace("__LEAFLET_JS__", io.open("leaflet.js", encoding="utf-8").read())
            )
    html = front + html
    io.open(OUT, "w", encoding="utf-8").write(html)
    print("wrote %s (%.1f MB), %d neighbourhoods"
          % (OUT, os.path.getsize(OUT) / 1e6, len(fc["features"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
