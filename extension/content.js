// Audio Reader — in-page control bar.
// A small fixed bar pinned to the bottom-center of the viewport, rendered in a
// closed Shadow DOM so the host page's styles can't touch it. Pure remote
// control: it sends commands to the service worker and renders the state it
// gets back. It does not fetch audio or echo the selected text.

(() => {
  if (window.__audioReaderInjected) return;
  window.__audioReaderInjected = true;

  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

  let host = null;
  let root = null;
  let els = null;
  let scrubbing = false;

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function send(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = "audio-reader-host";
    host.style.cssText = "all: initial; position: fixed; left: 0; right: 0; bottom: 20px; z-index: 2147483647; pointer-events: none;";
    root = host.attachShadow({ mode: "closed" });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar {
          pointer-events: auto;
          margin: 0 auto;
          width: max-content;
          max-width: 92vw;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(28, 28, 30, 0.96);
          color: #f5f5f7;
          border-radius: 9999px;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
          font: 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          user-select: none;
        }
        button {
          all: unset; cursor: pointer; display: inline-flex; align-items: center;
          justify-content: center; color: #f5f5f7; border-radius: 8px;
        }
        button:focus-visible { outline: 2px solid #0a84ff; }
        .icon { width: 30px; height: 30px; font-size: 15px; }
        .icon:hover { background: rgba(255,255,255,0.12); }
        .play { width: 34px; height: 34px; font-size: 17px; background: rgba(255,255,255,0.12); }
        .play:hover { background: rgba(255,255,255,0.22); }
        .time { font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0.85; min-width: 84px; text-align: center; }
        input[type=range] {
          -webkit-appearance: none; appearance: none;
          width: 200px; max-width: 36vw; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.25); cursor: pointer; outline: none;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 13px; height: 13px; border-radius: 50%; background: #f5f5f7;
        }
        select {
          all: unset; cursor: pointer; box-sizing: border-box;
          color: #f5f5f7; background: rgba(255,255,255,0.10);
          border-radius: 8px; padding: 5px 8px; font: inherit; font-weight: 600;
          text-align: center;
        }
        select:hover { background: rgba(255,255,255,0.20); }
        select:focus-visible { outline: 2px solid #0a84ff; }
        select option { color: #1c1c1e; background: #fff; font-weight: 400; }
        .speed { font-variant-numeric: tabular-nums; }
        .voice { max-width: 130px; font-weight: 400; }
        .status { opacity: 0.7; white-space: nowrap; max-width: 26vw; overflow: hidden; text-overflow: ellipsis; }
        .status.error { color: #ff6b6b; opacity: 1; }
        .status:empty { display: none; }
        .close { font-size: 16px; opacity: 0.7; }
        .close:hover { opacity: 1; }
      </style>
      <div class="bar">
        <button class="icon play" data-act="toggle" title="Play / Pause" aria-label="Play or pause">▶</button>
        <span class="time"><span class="cur">0:00</span> / <span class="dur">0:00</span></span>
        <input class="seek" type="range" min="0" max="0" value="0" step="0.1" aria-label="Seek" />
        <select class="speed" title="Playback speed" aria-label="Playback speed"></select>
        <select class="voice" title="Voice (applies to the next reading)" aria-label="Voice"></select>
        <span class="status"></span>
        <button class="icon close" data-act="stop" title="Stop &amp; close" aria-label="Close">✕</button>
      </div>
    `;

    els = {
      play: root.querySelector(".play"),
      cur: root.querySelector(".cur"),
      dur: root.querySelector(".dur"),
      seek: root.querySelector(".seek"),
      speed: root.querySelector(".speed"),
      voice: root.querySelector(".voice"),
      status: root.querySelector(".status")
    };

    for (const v of SPEEDS) {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = v + "×";
      els.speed.appendChild(opt);
    }

    root.querySelector(".play").addEventListener("click", () => send({ type: "CONTROL", action: "toggle" }));
    root.querySelector(".close").addEventListener("click", () => send({ type: "CONTROL", action: "stop" }));

    els.speed.addEventListener("change", () => {
      send({ type: "CONTROL", action: "speed", value: Number(els.speed.value) });
    });

    els.voice.addEventListener("change", () => {
      send({ type: "SET_VOICE", voice: els.voice.value });
      setStatus("Voice set — applies to the next reading.");
      setTimeout(() => { if (els && els.status.textContent.startsWith("Voice set")) setStatus(""); }, 2500);
    });

    els.seek.addEventListener("input", () => {
      scrubbing = true;
      els.cur.textContent = fmt(Number(els.seek.value));
    });
    els.seek.addEventListener("change", () => {
      send({ type: "CONTROL", action: "seek", value: Number(els.seek.value) });
      scrubbing = false;
    });

    document.documentElement.appendChild(host);
  }

  function populateVoices(voices, selected) {
    if (!els) return;
    const list = (voices && voices.length) ? voices : (selected ? [selected] : []);
    els.voice.innerHTML = "";
    for (const v of list) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      els.voice.appendChild(opt);
    }
    if (selected && list.includes(selected)) els.voice.value = selected;
  }

  function setSpeed(rate) {
    if (!els || rate == null) return;
    // Snap to the nearest offered option so the control always shows a value.
    const match = SPEEDS.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a), SPEEDS[1]);
    els.speed.value = String(match);
  }

  function show(data) {
    build();
    host.style.display = "block";
    if (data) {
      populateVoices(data.voices, data.voice);
      setSpeed(data.speed);
      setStatus("Connecting…");
    }
  }

  function hide() {
    if (host) host.style.display = "none";
  }

  function setStatus(text, isError = false) {
    if (!els) return;
    els.status.textContent = text || "";
    els.status.classList.toggle("error", !!isError);
  }

  function render(state) {
    if (!els) return;

    if (state.error) setStatus(state.error, true);
    else if (state.buffering && !state.playing) setStatus("Buffering…");
    else setStatus("");

    els.play.textContent = state.playing ? "⏸" : "▶";

    if (isFinite(state.duration) && state.duration > 0) {
      els.seek.max = String(state.duration);
      els.dur.textContent = fmt(state.duration);
    }
    if (!scrubbing) {
      els.seek.value = String(state.currentTime || 0);
      els.cur.textContent = fmt(state.currentTime || 0);
    }
    // Keep the speed control in sync with what's actually playing.
    if (state.rate != null && document.activeElement !== host) setSpeed(state.rate);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case "SHOW_PLAYER": show(msg); break;
      case "HIDE_PLAYER": hide(); break;
      case "STATE": render(msg.state); break;
      case "TOAST": show(); setStatus(msg.message, true); break;
    }
  });
})();
