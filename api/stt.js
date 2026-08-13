// /api/stt — hearing, for the "hey Kristian" wake word.
//
// The browser's own SpeechRecognition is not an option here. It exists in Brave and
// then fails, because Brave removes the Google speech endpoint it quietly depends on,
// and that is the browser Kristian actually uses. So this does what Cortex learned to
// do in the living room: record locally, transcribe on the server, one code path that
// behaves the same in every browser.
//
// Audio is transcribed and dropped. Nothing is written to disk and nothing is logged.

export const config = { api: { bodyParser: false } };

const rate = new Map();
function limited(ip) {
  const now = Date.now(), win = 60 * 60 * 1000;
  const rec = rate.get(ip) || { n: 0, t: now };
  if (now - rec.t > win) { rec.n = 0; rec.t = now; }
  rec.n += 1; rate.set(ip, rec);
  if (rate.size > 5000) rate.clear();
  return rec.n > 240;   // a wake word listener sends short clips, so this is generous
}

async function readBody(req, cap) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > cap) throw new Error("too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  if (req.method !== "POST") return res.status(405).json({ error: "post only" });

  const key = process.env.ELEVENLABS_KEY;
  if (!key) return res.status(200).json({ text: "", configured: false });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (limited(ip)) return res.status(200).json({ text: "", limited: true });

  try {
    // A wake word clip is a couple of seconds. Anything larger is not what this is for.
    const buf = await readBody(req, 4 * 1024 * 1024);
    if (buf.length < 1200) return res.status(200).json({ text: "" });

    const type = req.headers["content-type"] || "audio/webm";
    const form = new FormData();
    form.append("file", new Blob([buf], { type }), "clip.webm");
    form.append("model_id", process.env.ASK_STT_MODEL || "scribe_v1");
    form.append("language_code", "eng");

    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form
    });
    if (!r.ok) {
      return res.status(200).json({ text: "", error: "upstream " + r.status, detail: (await r.text()).slice(0, 160) });
    }
    const j = await r.json();
    return res.status(200).json({ text: String(j.text || "").trim() });
  } catch (e) {
    return res.status(200).json({ text: "", error: String((e && e.message) || e).slice(0, 140) });
  }
}
