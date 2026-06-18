const logEl = document.getElementById("log");
const verdictEl = document.getElementById("verdict");
const playerEl = document.getElementById("player");

function append(line) {
  if (logEl.textContent === "idle.") logEl.textContent = "";
  logEl.textContent += line + "\n";
}

function start(device, dtype) {
  logEl.textContent = "";
  verdictEl.className = "";
  verdictEl.textContent = "";
  playerEl.innerHTML = "";
  append(`▶ requesting ${device} (${dtype}) run…`);
  chrome.runtime.sendMessage({ type: "SPIKE_RUN", device, dtype }).catch((e) => append("send error: " + e));
}

document.getElementById("webgpu").addEventListener("click", () => start("webgpu", "fp32"));
document.getElementById("wasm").addEventListener("click", () => start("wasm", "q8"));

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "SPIKE_LOG") {
    append(msg.msg);
  } else if (msg.type === "SPIKE_RESULT") {
    if (!msg.ok) {
      verdictEl.className = "verdict fail";
      verdictEl.textContent =
        msg.reason === "no-webgpu-in-offscreen"
          ? "GATE FAILED — navigator.gpu is undefined in the offscreen document."
          : "Run failed: " + msg.reason;
      return;
    }
    const long = msg.results.find((r) => r.label === "long");
    const dockerRtf = 4.6; // midpoint of measured 4.3–4.9×
    const ratio = long ? (long.rtf / dockerRtf) : 0;
    verdictEl.className = "verdict pass";
    verdictEl.textContent =
      `PASS — ${msg.device} ran in the offscreen document. ` +
      `Long paragraph: ${long.rtf.toFixed(2)}× real-time ` +
      `(${ratio >= 1 ? ratio.toFixed(2) + "× faster than" : (1 / ratio).toFixed(2) + "× slower than"} Docker's ~4.6×). ` +
      `Model load: ${(msg.loadMs / 1000).toFixed(1)}s.`;
    const short = msg.results.find((r) => r.label === "short" && r.dataUrl);
    if (short) {
      const a = document.createElement("audio");
      a.controls = true;
      a.src = short.dataUrl;
      playerEl.appendChild(document.createTextNode("Listen to the short clip: "));
      playerEl.appendChild(a);
    }
  }
});

append("Click a button to run. Open DevTools → Console for the offscreen document if anything stalls.");
