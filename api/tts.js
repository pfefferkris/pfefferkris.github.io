// /api/tts — Kristian's voice for the Wealth Guide.
//
// The page is silent until a visitor opens Ask Kristian. Nothing speaks on load,
// nothing listens on load. This endpoint only ever runs because someone asked it to.
//
// Text in, mp3 out. Nothing is stored, and the text is never logged.

// Brian. Deep American narration that stays conversational instead of announcing.
// The deeper options in the audition list read as a documentary about estate tax
// rather than a person answering a question, and on a personal site that gap
// between the voice and the man costs more than the gravitas buys.
const VOICE_ID = process.env.ASK_VOICE_ID || "nPczCjzI2devNBz1zQrb";
const MODEL = process.env.ASK_TTS_MODEL || "eleven_flash_v2_5";

// The default read is too slow for someone explaining material they know well. 1.2
// is the ceiling this model allows and it turned out to be slightly hot, so this sits
// 10 percent back from it: unhurried, but not reciting.
const SPEED = Math.min(1.2, Math.max(0.7, parseFloat(process.env.ASK_TTS_SPEED || "1.08")));

// An allowlist, not a passthrough. Without it this endpoint is a free ElevenLabs
// proxy for anyone who finds it. These are the male voices worth auditioning for a
// man in his thirties explaining trust law on his own website.
const VOICES = {
  josh:   "TxGEqnHWrfWFTfGW9XjX", // current, young American, light
  brian:  "nPczCjzI2devNBz1zQrb", // deep American narration
  adam:   "pNInz6obpgDQGcFmaJgB", // deep American, authoritative
  bill:   "pqHfZKP75CvOlQylNhV4", // older American, documentary gravitas
  eric:   "cjVigY5qzO86Huf0OWal", // middle aged American, smooth
  chris:  "iP95p4xoKVk53GoZ742B", // casual American, conversational
  will:   "bIHbv24MWmeRgasZH58o", // friendly American, warm
  liam:   "TX3LPaxmHKxFdv7VOQHJ", // younger American, articulate
  daniel: "onwK4e9ZLuTAKqWW03F9", // British news presenter
  george: "JBFqnCBsd6RMkjVDRZzb"  // British, warm and raspy
};

// A public page can be refreshed all day, and every synthesis costs characters.
// 60 requests an hour per address, and a hard ceiling on how much text one request
// can turn into speech, keeps a bad afternoon from emptying the account.
const rate = new Map();
function limited(ip, chars) {
  const now = Date.now(), win = 60 * 60 * 1000;
  const rec = rate.get(ip) || { n: 0, c: 0, t: now };
  if (now - rec.t > win) { rec.n = 0; rec.c = 0; rec.t = now; }
  rec.n += 1; rec.c += chars; rate.set(ip, rec);
  if (rate.size > 5000) rate.clear();
  return rec.n > 60 || rec.c > 60000;
}

// The model reads punctuation, not markup. Strip anything that would be pronounced
// as itself, and turn citations into how a person would actually say them out loud.
function speakable(s) {
  return String(s || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\bNCGS\s+/g, "North Carolina General Statute ")
    .replace(/\bAOC-E-(\d{3})\b/g, "form A O C E $1")
    .replace(/\bIRC\s+/g, "Internal Revenue Code section ")
    .replace(/\b(\d{3})\((k|b)\)/gi, "$1 $2")
    .replace(/\bIRA\b/g, "I R A")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  if (req.method !== "POST") return res.status(405).json({ error: "post only" });

  const key = process.env.ELEVENLABS_KEY;
  if (!key) return res.status(200).json({ error: "voice not configured", configured: false });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const text = speakable(body.text).slice(0, 2500);
    if (text.length < 2) return res.status(400).json({ error: "nothing to say" });

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
    if (limited(ip, text.length)) return res.status(200).json({ error: "rate limited", limited: true });

    // Auditioning a voice is allowed; pointing this at an arbitrary voice id is not.
    const pick = String(body.voice || "").toLowerCase().replace(/[^a-z]/g, "");
    const voiceId = (pick && VOICES[pick]) || VOICE_ID;
    const speed = body.speed ? Math.min(1.2, Math.max(0.7, parseFloat(body.speed) || SPEED)) : SPEED;

    const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        // Steady rather than theatrical. He is explaining something, not performing it.
        // Higher stability keeps the delivery level, which is what reads as expertise:
        // the calm downward inflection, not volume and not drama.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true, speed: speed }
      })
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return res.status(200).json({ error: "upstream " + r.status, detail });
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(buf.length));
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(200).json({ error: String((e && e.message) || e).slice(0, 150) });
  }
}
