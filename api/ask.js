// /api/ask — Ask Kristian.
//
// Retrieval-grounded education. The corpus is Kristian's own explainers, written
// from primary law. Every explainer carries a `where_this_stops` field naming the
// exact question at which education becomes legal advice. Those boundaries are
// passed to the model for the retrieved topics, so the limit is a property of the
// data rather than a line in a disclaimer.
//
// Nothing a visitor types is stored.

import fs from "fs";
import path from "path";

let CORPUS = null;
let CORE = null;
function corpus() {
  if (CORPUS) return CORPUS;
  const p = path.join(process.cwd(), "data", "corpus.json");
  CORPUS = JSON.parse(fs.readFileSync(p, "utf8"));
  return CORPUS;
}

const STOP = new Set(("a an and are as at be but by for from how i if in into is it its of on or that the their then there these they this to was what when where which who will with you your my me do does can could should would about" ).split(" "));

function terms(s) {
  return (s || "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    // split letter/digit boundaries so "401k" and "401(k)" both yield 401
    .replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

// Small corpus, so plain term scoring beats the complexity of a vector store.
function retrieve(q, chips, k) {
  const docs = corpus().docs;
  const qt = terms(q);
  if (!qt.length) return [];
  const df = {};
  docs.forEach(d => {
    const seen = new Set(terms(d.title + " " + d.headings.join(" ") + " " + d.body));
    seen.forEach(t => { df[t] = (df[t] || 0) + 1; });
  });
  const N = docs.length;
  // Core vocabulary: terms this library actually talks about. In a single subject
  // corpus the most topical words appear in MOST documents, which is the opposite
  // of what inverse document frequency rewards, so topicality is gated separately.
  if (!CORE) {
    CORE = new Set();
    Object.keys(df).forEach(t => { if (df[t] >= 3) CORE.add(t); });
  }
  if (!qt.some(t => CORE.has(t))) return [];
  const scored = docs.map(d => {
    const hay = {
      title: terms(d.title).join(" "),
      heads: terms(d.headings.join(" ")).join(" "),
      body: terms(d.body).join(" ")
    };
    let score = 0;
    qt.forEach(t => {
      const idf = Math.log(1 + N / (1 + (df[t] || 0)));
      if (hay.title.indexOf(t) >= 0) score += 6 * idf;
      if (hay.heads.indexOf(t) >= 0) score += 3 * idf;
      const c = (hay.body.match(new RegExp("\\b" + t, "g")) || []).length;
      score += Math.min(c, 6) * idf;
    });
    // the persona chips the visitor already set are a real relevance signal
    if (chips && chips.length && d.chips) {
      const hits = d.chips.filter(c => chips.indexOf(c) >= 0).length;
      score *= (1 + 0.12 * hits);
    }
    return { d, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  // An off topic question should return nothing rather than the least bad guess,
  // so the model can say honestly that the library does not reach it.
  const top = scored[0].score;
  return scored.filter(x => x.score >= top * 0.30).slice(0, k || 3).map(x => x.d);
}

const VOICE = `You are Kristian Pfeffer answering a question on his own website, in his voice.

WHO YOU ARE. Kristian finishes a Master of Trust and Wealth Management at Campbell University this month. He is a licensed North Carolina real estate broker and an Army veteran. He is NOT an attorney and NOT a registered investment adviser, and he says so plainly whenever it matters.

HOW HE WRITES.
- Direct. Never announce that you are about to say something. Do not write "let me be clear" or "I will say this plainly." Just say it.
- Simple but empathetic. Plain words, short declarative sentences, warmth without flourish.
- Explain like the person is smart but has never seen this before. No jargon without translating it in the same breath.
- No hyphens or em dashes anywhere. Rephrase instead. Write "means tested" not "means-tested".
- No emojis. No bullet-point walls. Write in prose with the occasional short list.
- First person. "I" and "you". He is a person talking to a person.
- Warm, never salesy, never grandiose.

THE HARD RULE, AND IT IS THE WHOLE JOB.
You give EDUCATION, never ADVICE. The difference is whether the answer depends on this particular person's facts.

You MAY: explain what a concept means, what a document does, what a form asks for, what a statute says, what the process looks like, what things generally cost, what commonly goes wrong, and what questions to bring to a lawyer.

You MAY NOT, under any circumstances:
- Apply the law to the visitor's specific situation
- Tell them what they should do, choose, sign, file, or title
- Recommend which form or which trust fits them
- Fill in, draft, or review a document
- Evaluate whether something already done was correct
- Predict an outcome for their matter

When a question crosses that line, do not refuse coldly. Answer the general half genuinely and fully, then name the specific half as the part that needs a lawyer, and say why. Give them the questions to take in. Being useful right up to the line is the point.

Each source below carries a WHERE THIS STOPS field. That field is the boundary for that topic. Honor it exactly.

CITE. When you rely on a statute or form, name it the way the sources do (for example NCGS 29-14, or form AOC-E-505). Never invent a citation. If you are not certain of a number, describe the rule without the number.

IF THE SOURCES DO NOT COVER IT. Say so honestly. Offer what general grounding you can, and say the material behind this site does not reach it yet. Never fabricate North Carolina specifics.

LENGTH. Two to five short paragraphs unless they ask for more. Answer the question first, then the nuance.

CLOSE. Do not append a disclaimer to every message; the page carries one. Only raise the not-an-attorney point when the question actually reaches for advice.`;

const rate = new Map();
function limited(ip) {
  const now = Date.now(), win = 60 * 60 * 1000, max = 30;
  const rec = rate.get(ip) || { n: 0, t: now };
  if (now - rec.t > win) { rec.n = 0; rec.t = now; }
  rec.n += 1; rate.set(ip, rec);
  if (rate.size > 5000) rate.clear();
  return rec.n > max;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Access-Control-Allow-Origin", "https://kpfeffer.com");
  if (req.method !== "POST") return res.status(405).json({ error: "post only" });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return res.status(200).json({
      answer: "I am not switched on yet. The reading is all here, the conversation part just needs its key set. In the meantime the guide below covers most of what I would say.",
      sources: [], configured: false
    });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  if (limited(ip)) {
    return res.status(200).json({
      answer: "That is a lot of questions in an hour, and I want to keep this free for everyone. Give it a little while and come back.",
      sources: [], limited: true
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const q = (body.q || "").toString().slice(0, 1200).trim();
    const chips = Array.isArray(body.chips) ? body.chips.slice(0, 12) : [];
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    if (q.length < 2) return res.status(400).json({ error: "ask something" });

    const hits = retrieve(q, chips, 3);
    const sourceBlock = hits.length
      ? hits.map((d, i) =>
          `=== SOURCE ${i + 1}: ${d.title}\n` +
          (d.authority && d.authority.length ? `AUTHORITY: ${d.authority.join("; ")}\n` : "") +
          `WHERE THIS STOPS: ${d.where_this_stops}\n\n${d.body}`
        ).join("\n\n")
      : "(No source in the library covers this question. Say so honestly.)";

    const messages = [
      { role: "system", content: VOICE + "\n\n--- SOURCES ---\n\n" + sourceBlock },
      ...history.filter(m => m && m.role && m.content).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content).slice(0, 2000)
      })),
      { role: "user", content: q + (chips.length ? `\n\n(For relevance only, this visitor marked: ${chips.join(", ")}. Do not tailor legal conclusions to it.)` : "") }
    ];

    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://kpfeffer.com",
        "X-Title": "Ask Kristian"
      },
      body: JSON.stringify({
        model: process.env.ASK_MODEL || "anthropic/claude-sonnet-4",
        messages,
        max_tokens: 900,
        temperature: 0.4
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(200).json({
        answer: "Something on my end did not answer just now. Try again in a moment.",
        sources: [], upstream: r.status, detail: t.slice(0, 200)
      });
    }
    const j = await r.json();
    const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";

    return res.status(200).json({
      answer: answer.trim(),
      sources: hits.map(d => ({ title: d.title, authority: d.authority || [] })),
      configured: true
    });
  } catch (e) {
    return res.status(200).json({
      answer: "Something on my end did not answer just now. Try again in a moment.",
      sources: [], error: String(e && e.message || e).slice(0, 150)
    });
  }
}
