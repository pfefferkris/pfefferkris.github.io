// /api/whereami — the visitor's approximate city, from the connection itself.
//
// Deliberately uses ONLY the geolocation the host already attaches to the
// request at the edge. No third party ever sees the visitor's address or IP
// because of this feature, nothing is logged, and nothing is stored. An IP
// can place a connection in a city; it cannot know a street address, and the
// guide says so rather than pretending otherwise.

// The metros whose deeds this guide can actually pull, so the record lookup
// can be told which county to read before the visitor types anything.
const CITY_COUNTY = {
  "CHARLOTTE": "Mecklenburg", "CORNELIUS": "Mecklenburg", "HUNTERSVILLE": "Mecklenburg",
  "MATTHEWS": "Mecklenburg", "MINT HILL": "Mecklenburg", "PINEVILLE": "Mecklenburg",
  "DAVIDSON": "Mecklenburg",
  "GREENSBORO": "Guilford", "HIGH POINT": "Guilford", "JAMESTOWN": "Guilford",
  "OAK RIDGE": "Guilford", "SUMMERFIELD": "Guilford", "GIBSONVILLE": "Guilford",
  "WINSTON-SALEM": "Forsyth", "WINSTON SALEM": "Forsyth", "KERNERSVILLE": "Forsyth",
  "CLEMMONS": "Forsyth", "LEWISVILLE": "Forsyth", "WALKERTOWN": "Forsyth",
  "FAYETTEVILLE": "Cumberland", "HOPE MILLS": "Cumberland", "SPRING LAKE": "Cumberland",
  "FORT BRAGG": "Cumberland", "FORT LIBERTY": "Cumberland", "STEDMAN": "Cumberland",
  "WILMINGTON": "New Hanover", "CAROLINA BEACH": "New Hanover", "WRIGHTSVILLE BEACH": "New Hanover",
  "KURE BEACH": "New Hanover",
  "RALEIGH": "Wake", "CARY": "Wake", "APEX": "Wake", "GARNER": "Wake", "WAKE FOREST": "Wake",
  "HOLLY SPRINGS": "Wake", "FUQUAY-VARINA": "Wake", "MORRISVILLE": "Wake", "KNIGHTDALE": "Wake",
  "WENDELL": "Wake", "ZEBULON": "Wake", "ROLESVILLE": "Wake"
};

export default async function handler(req, res) {
  // per visitor, never cached or stored
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");

  const h = req.headers || {};
  const dec = v => {
    if (!v) return null;
    try { return decodeURIComponent(String(v)).trim() || null; } catch (e) { return String(v).trim() || null; }
  };

  const city = dec(h["x-vercel-ip-city"]);
  const region = dec(h["x-vercel-ip-country-region"]);
  const country = dec(h["x-vercel-ip-country"]);
  const postal = dec(h["x-vercel-ip-postal-code"]);

  if (!city || country !== "US") {
    return res.status(200).json({ known: false });
  }

  const county = CITY_COUNTY[city.toUpperCase()] || null;
  return res.status(200).json({
    known: true,
    city: city,
    state: region || null,
    postal: postal || null,
    county: county,
    note: "approximate, from the network connection; never a street address"
  });
}
