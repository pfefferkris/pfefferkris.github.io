/* Ask Kristian, the shared widget.
 *
 * This lived inline in the wealth guide, which meant the estate guide had nothing and a
 * microphone fix would have had to be made twice. One file now, configured per page.
 *
 * A page opts in with, before this script:
 *   window.AK_CONFIG = { surface:'estate', placeholder:'...', seeds:[...], greeting:'...',
 *                        targets:[{sel:'#sheet', label:'...', name:el=>'...'}] }
 * and either an element with id akbtn, or nothing at all, in which case a floating
 * opener mounts itself.
 */
(function () {
  "use strict";
  var CFG = window.AK_CONFIG || {};
  var SURFACE = CFG.surface || "site";

  /* ---------------------------------------------------------------- panel */
  var opener = document.getElementById("akbtn");
  if (!opener) {
    opener = document.createElement("button");
    opener.type = "button";
    opener.className = "akfab";
    opener.id = "akbtn";
    opener.innerHTML = '<span class="akdot"></span>' + (CFG.fabLabel || "Ask Kristian");
    document.body.appendChild(opener);
  }

  var glow = document.createElement("div");
  glow.id = "akglow";
  document.body.appendChild(glow);

  var panel = document.createElement("div");
  panel.id = "akpanel";
  panel.innerHTML =
    '<div class="akhead"><b>Ask Kristian</b>' +
      '<button class="aktog" id="akspk" aria-pressed="true" title="Kristian speaks his answers">&#128266; Voice</button>' +
      '<button class="aktog akmic" id="akear" aria-pressed="false" title="Talk instead of typing">' +
        '<span class="akbars"><i></i><i></i><i></i><i></i><i></i></span><span id="akearlbl">Talk</span></button>' +
      '<button class="akx" id="akx" aria-label="Close">&#215;</button></div>' +
    '<div class="akdisc">I am not an attorney and not a registered investment adviser. This is education, not legal, tax, or investment advice, and I cannot answer questions about your own situation. Nothing you type is stored.</div>' +
    '<div id="akbody"></div>' +
    '<div id="akctx" class="akctx" style="display:none"><span><b>Looking at</b><span id="akctxt"></span></span><button id="akctxx" aria-label="Drop this context">&#215;</button></div>' +
    '<div class="akfoot"><textarea id="akin" rows="1" placeholder="' +
      (CFG.placeholder || "Ask me anything about wills, trusts, or probate") +
      '"></textarea><button id="aksend">Ask</button></div>';
  document.body.appendChild(panel);

  var body = panel.querySelector("#akbody"), input = panel.querySelector("#akin"),
      send = panel.querySelector("#aksend"), ctxBar = panel.querySelector("#akctx"),
      ctxLbl = panel.querySelector("#akctxt");
  var history = [], busy = false, opened = false, ctx = null;

  function setCtx(c) {
    ctx = c;
    if (c) { ctxLbl.textContent = c.title; ctxBar.style.display = "flex"; }
    else { ctxBar.style.display = "none"; }
  }
  panel.querySelector("#akctxx").onclick = function () { setCtx(null); };

  function say(who, text, sources) {
    var d = document.createElement("div");
    d.className = "akmsg " + who;
    d.textContent = text;
    if (sources && sources.length) {
      var s = document.createElement("div");
      s.className = "aksrc";
      s.textContent = "Grounded in: " + sources.map(function (x) { return x.title; }).join(" · ");
      d.appendChild(s);
    }
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  }

  var SEEDS = CFG.seeds || [
    "Can my power of attorney agent make gifts, or does that have to be spelled out?",
    "I refinanced my house. Is it still in my trust?",
    "My spouse left me out of the will. What is the elective share worth?",
    "If my son inherits, does he lose his SSI?"
  ];
  function greet() {
    var hello = CFG.greeting ||
      "Ask me anything about wills, trusts, probate, or how property passes. I will explain how it works and where it stops being something I can answer.";
    say("k", hello);
    setTimeout(function () { speak(hello); }, 120);
    var wrap = document.createElement("div");
    wrap.className = "akseed";
    SEEDS.forEach(function (s) {
      var b = document.createElement("span");
      b.textContent = s;
      b.onclick = function () { input.value = s; ask(); };
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
  }

  function chips() {
    return [].slice.call(document.querySelectorAll(".persona [data-p]"))
      .filter(function (c) { return c.classList.contains("on"); })
      .map(function (c) { return c.dataset.p; });
  }

  function ask() {
    var q = (input.value || "").trim();
    if (!q || busy) return;
    busy = true; send.disabled = true; input.value = "";
    input.style.height = "auto";
    say("me", q);
    var thinking = say("k", "Reading…");
    glow.classList.add("on");
    fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: q, chips: chips(), history: history, context: ctx, surface: SURFACE })
    }).then(function (x) { return x.json(); }).then(function (r) {
      thinking.remove();
      say("k", r.answer || "I could not answer that one.", r.sources);
      speak(r.answer);
      history.push({ role: "user", content: q });
      history.push({ role: "assistant", content: r.answer || "" });
      if (history.length > 8) history = history.slice(-8);

    }).catch(function () {
      thinking.remove();
      say("k", "Something on my end did not answer. Try again in a moment.");
    }).then(function () {
      glow.classList.remove("on");
      busy = false; send.disabled = false; input.focus();
    });
  }

  /* ---------------------------------------------------------------- voice out
     The page is silent on load. Nothing speaks and nothing listens until the visitor
     opens the panel: a stranger landing on a public page has not agreed to be talked to.
     A browser only allows audio that starts inside a user gesture, and fetching the
     speech takes a second or two, by which point the gesture is over. So one element is
     unlocked the instant the opener is pressed and every later answer swaps its source. */
  var spk = panel.querySelector("#akspk"), ear = panel.querySelector("#akear");
  var voiceOn = true, audioUrl = null, warned = false;
  var player = new Audio();
  player.preload = "auto";
  player.crossOrigin = "anonymous";
  var SILENCE = "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA" +
    "gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAA8LAVEQQAAgAAAAnGT" +
    "HGUAAAAAAAAAAAAAAAAAAAA//sQxAADwAABpAAAACAAADSAAAAETEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVV";
  var unlocked = false;

  /* One AudioContext for the whole widget: the bars while he speaks, and the capture
     while he listens. Created inside a gesture because iOS refuses otherwise. */
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = null, srcNode = null, spkAnalyser = null;
  function audioCtx() {
    if (!actx && AC) actx = new AC();
    if (actx && actx.state === "suspended") { try { actx.resume(); } catch (e) {} }
    return actx;
  }
  function unlockAudio() {
    audioCtx();
    if (unlocked) return;
    try {
      player.src = SILENCE;
      var p = player.play();
      if (p && p.then) p.then(function () { unlocked = true; }).catch(function () {});
    } catch (e) {}
  }

  function attachSpeakAnalyser() {
    // Route the element through the graph once, so the bars can ride his voice. Once an
    // element has a MediaElementSource it must reach the destination or it goes silent,
    // which is why the connect happens in the same breath as the create.
    var c = audioCtx();
    if (!c || srcNode || !c.createMediaElementSource) return;
    try {
      srcNode = c.createMediaElementSource(player);
      spkAnalyser = c.createAnalyser();
      spkAnalyser.fftSize = 64;
      srcNode.connect(spkAnalyser);
      spkAnalyser.connect(c.destination);
    } catch (e) { srcNode = null; spkAnalyser = null; }
  }

  function stopSpeak() {
    utterance++;                       // anything already on the wire is now stale
    try { player.pause(); } catch (e) {}
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    glow.classList.remove("speak");
    speaking = false;
  }
  var speaking = false, utterance = 0;
  function speak(text) {
    if (!voiceOn || !text) return Promise.resolve();
    stopSpeak();
    // Every utterance takes a ticket. Two answers close together means two fetches in
    // flight, and stopping playback does not cancel a request already on the wire: the
    // older, slower one comes back last, re paints the glow and plays over the newer
    // answer. That left the page breathing gold with nothing making a sound.
    var mine = ++utterance;
    return fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text })
    }).then(function (r) {
      if (mine !== utterance) return null;
      if (!r.ok) return null;
      if ((r.headers.get("content-type") || "").indexOf("audio") < 0) return null;
      return r.blob();
    }).then(function (b) {
      if (!b || mine !== utterance) return;
      audioUrl = URL.createObjectURL(b);
      player.src = audioUrl;
      attachSpeakAnalyser();
      glow.classList.add("speak");
      speaking = true;
      if (listening) pauseCapture();          // he must not hear himself
      var done = function () {
        if (mine !== utterance) return;
        glow.classList.remove("speak"); speaking = false; LEVEL = 0;
        if (listening) resumeCapture();
      };
      player.onended = player.onerror = done;
      // A belt for the case where playback is refused in a way that fires neither event.
      // A glow that never goes out is worse than one that goes out early.
      setTimeout(function () { if (mine === utterance && player.paused) done(); }, 4000);
      return player.play();
    }).catch(function () {
      if (mine !== utterance) return;
      glow.classList.remove("speak"); speaking = false;
      if (!warned) {
        warned = true;
        var d = say("k", "Your browser blocked the audio. Tap here once and I will speak from now on.");
        d.style.cursor = "pointer";
        d.onclick = function () {
          unlocked = true;
          if (audioUrl) { player.src = audioUrl; player.play().catch(function () {}); }
        };
      }
    });
  }
  spk.onclick = function () {
    voiceOn = !voiceOn;
    spk.setAttribute("aria-pressed", String(voiceOn));
    if (!voiceOn) stopSpeak();
  };

  /* ---------------------------------------------------------------- the lines
     Cortex draws thin bars that ride whatever is making sound: the microphone while it
     listens, his own voice while it speaks. Same idea here, same geometry. A widget that
     shows the level is a widget you can tell is working; a mute button is not. */
  var LEVEL = 0, bars = panel.querySelectorAll(".akbars i"), phase = 0, spkData = null;
  (function draw() {
    if (speaking && spkAnalyser) {
      if (!spkData) spkData = new Uint8Array(spkAnalyser.frequencyBinCount);
      spkAnalyser.getByteFrequencyData(spkData);
      var m = 0;
      for (var k = 0; k < spkData.length; k++) m += spkData[k];
      LEVEL = Math.min(1, (m / spkData.length) / 95);
    } else {
      LEVEL = LEVEL * 0.85;            // decay, so the bars settle instead of snapping flat
    }
    phase += 0.4;
    for (var i = 0; i < bars.length; i++) {
      var wave = 0.5 + 0.5 * Math.sin(phase + i * 0.9);
      bars[i].style.height = (3 + (2 + wave * 11) * Math.min(1, LEVEL * 1.5)).toFixed(1) + "px";
    }
    requestAnimationFrame(draw);
  })();

  /* ---------------------------------------------------------------- voice in
     Not MediaRecorder. That was the bug: it produces webm/opus on Chrome, ogg on Firefox,
     mp4/AAC on Safari, and on older iOS it does not exist at all, so the wake word worked
     on exactly one browser. This captures raw PCM through Web Audio, downsamples it, and
     writes the WAV header by hand. Every browser that can open a microphone can do this,
     which is the same reason the living room build does it this way.
     ScriptProcessor is deprecated and universally supported; AudioWorklet would need a
     second file and buys nothing here. */
  var micStream = null, proc = null, micSrc = null, listening = false, waiting = false;
  var capturing = false, frames = [], spoke = false, quiet = 0, elapsed = 0;
  var THRESH = 0.02, SIL_MS = 850, MAX_MS = 15000, MIN_MS = 400;

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && AC);
  }
  function downsample(buf, inRate, outRate) {
    if (outRate >= inRate) return buf;
    var ratio = inRate / outRate, n = Math.round(buf.length / ratio),
        out = new Float32Array(n), o = 0, i = 0;
    while (o < n) {
      var next = Math.round((o + 1) * ratio), s = 0, c = 0;
      for (; i < next && i < buf.length; i++) { s += buf[i]; c++; }
      out[o++] = c ? s / c : 0;
    }
    return out;
  }
  function encodeWav(samples, rate) {
    var b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
    ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, samples.length * 2, true);
    var o = 44;
    for (var i = 0; i < samples.length; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      o += 2;
    }
    return new Blob([b], { type: "audio/wav" });
  }

  function flush() {
    var f = frames; frames = [];
    var ms = elapsed; spoke = false; quiet = 0; elapsed = 0;
    if (!f.length || ms < MIN_MS || !listening) return;
    var rate = actx.sampleRate, total = 0, i;
    for (i = 0; i < f.length; i++) total += f[i].length;
    var flat = new Float32Array(total), off = 0;
    for (i = 0; i < f.length; i++) { flat.set(f[i], off); off += f[i].length; }
    var out = downsample(flat, rate, 16000);
    var blob = encodeWav(out, 16000);
    if (blob.size < 2000) return;
    fetch("/api/stt", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: blob })
      .then(function (r) { return r.json(); })
      .then(function (r) { heard(r && r.text ? r.text : ""); })
      .catch(function () {});
  }

  function startCapture() {
    var c = audioCtx();
    micSrc = c.createMediaStreamSource(micStream);
    proc = (c.createScriptProcessor || c.createJavaScriptNode).call(c, 4096, 1, 1);
    proc.onaudioprocess = function (e) {
      if (!capturing) return;
      var buf = e.inputBuffer.getChannelData(0), s = 0;
      for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      var rms = Math.sqrt(s / buf.length), fms = buf.length / c.sampleRate * 1000;
      if (!speaking) LEVEL = Math.max(LEVEL, Math.min(1, rms * 9));
      if (rms > THRESH) { spoke = true; quiet = 0; frames.push(new Float32Array(buf)); elapsed += fms; }
      else if (spoke) { frames.push(new Float32Array(buf)); quiet += fms; elapsed += fms;
                        if (quiet >= SIL_MS) flush(); }
      if (spoke && elapsed > MAX_MS) flush();
    };
    micSrc.connect(proc);
    // Chrome will not run a ScriptProcessor that reaches nothing. A zero gain node keeps
    // it alive without putting the room back through the speakers.
    var mute = c.createGain(); mute.gain.value = 0;
    proc.connect(mute); mute.connect(c.destination);
    capturing = true;
  }
  function pauseCapture() { capturing = false; frames = []; spoke = false; quiet = 0; elapsed = 0; }
  function resumeCapture() { if (listening) capturing = true; }

  var earLbl = panel.querySelector("#akearlbl");
  function setMicUI(state) {          // listening | opening | off
    ear.setAttribute("aria-pressed", String(state === "listening"));
    ear.classList.toggle("live", state === "listening");
    glow.classList.toggle("on", state === "listening");
    if (earLbl) earLbl.textContent = state === "listening" ? "Listening" : state === "opening" ? "Opening" : "Talk";
  }
  function setListening(on) {
    if (on === listening) return;
    if (on) {
      if (!micSupported()) {
        say("k", "This browser cannot open a microphone on a page like this. Typing works the same.");
        return;
      }
      setMicUI("opening");
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
        micStream = st; listening = true;
        setMicUI("listening");
        startCapture();
        say("k", "Listening. Say what you want to ask, then pause. You can also just say hey Kristian first.");
      }).catch(function (err) {
        // An honest message, naming the actual cause, beats a widget that just does nothing.
        var why = (err && err.name === "NotAllowedError")
          ? "The browser blocked the microphone for this site. Allow it in the address bar and tap again."
          : (err && err.name === "NotFoundError")
            ? "I could not find a microphone on this device."
            : (location.protocol !== "https:")
              ? "A microphone only works over a secure connection."
              : "I could not open the microphone.";
        say("k", why);
        setMicUI("off");
      });
    } else {
      listening = false; capturing = false; waiting = false; frames = [];
      setMicUI("off");
      try { proc && proc.disconnect(); micSrc && micSrc.disconnect(); } catch (e) {}
      proc = micSrc = null;
      try { micStream && micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      micStream = null;
    }
  }
  function heard(t) {
    t = (t || "").trim();
    if (!t) return;
    // The wake word is stripped when it is there, and not required when it is not. He
    // pressed the button; that IS the intent. Making him also say a name would be a hoop.
    var m = t.match(/\bhey,?\s+(kristian|christian|cristian|kristen|christy)\b[\s,.:!?-]*/i);
    if (m) t = t.slice(m.index + m[0].length).trim();
    if (t.length < 2) return;
    input.value = t;
    ask();
  }
  ear.onclick = function () { unlockAudio(); setListening(!listening); };

  /* ---------------------------------------------------------------- wiring */
  send.onclick = ask;
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 96) + "px";
  });
  if (!micSupported()) ear.style.display = "none";
  function shut() { panel.classList.remove("on"); stopSpeak(); setListening(false); }
  panel.querySelector("#akx").onclick = shut;
  opener.onclick = function () {
    if (panel.classList.contains("on")) { shut(); return; }
    unlockAudio();                 // inside the click, not after the fetch
    panel.classList.add("on");
    if (!opened) { opened = true; greet(); }
    input.focus();
  };
  send.addEventListener("pointerdown", unlockAudio);
  spk.addEventListener("pointerdown", unlockAudio);

  // The handoff. Any block on the page can send the visitor here already holding the
  // thing they were reading, so the first question does not have to describe it.
  window.askKristianAbout = function (title, text, seed) {
    setCtx({ title: title, text: String(text || "").replace(/\s+/g, " ").trim().slice(0, 1200) });
    if (!panel.classList.contains("on")) panel.classList.add("on");
    if (!opened) { opened = true; greet(); }
    if (seed) { input.value = seed; input.dispatchEvent(new Event("input")); }
    input.focus();
    body.scrollTop = body.scrollHeight;
  };

  /* ------------------------------------- "Ask Kristian about this" on the blocks
     The bridge from "I am reading this" to "explain this to me" without retyping it.
     These mount themselves as blocks appear, because most of these pages are written
     in at runtime. */
  var TARGETS = CFG.targets || [];
  function textOf(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll(".askmore,button,script,style").forEach(function (n) { n.remove(); });
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }
  function mount(el, t) {
    if (!el || el.dataset.askmounted) return;
    var txt = textOf(el);
    if (txt.length < 60) return;             // nothing worth asking about yet
    el.dataset.askmounted = "1";
    var b = document.createElement("button");
    b.type = "button"; b.className = "askmore"; b.textContent = t.label || "Ask Kristian about this";
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      window.askKristianAbout(t.name ? t.name(el) : "This block", textOf(el), "");
    });
    el.appendChild(b);
  }
  function sweep() {
    TARGETS.forEach(function (t) {
      document.querySelectorAll(t.sel).forEach(function (el) { mount(el, t); });
    });
  }
  if (TARGETS.length) {
    sweep();
    var pending = null;
    new MutationObserver(function () {
      clearTimeout(pending);
      pending = setTimeout(function () {
        TARGETS.forEach(function (t) {
          document.querySelectorAll(t.sel).forEach(function (el) {
            if (el.dataset.askmounted && !el.querySelector(".askmore")) delete el.dataset.askmounted;
          });
        });
        sweep();
      }, 180);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
