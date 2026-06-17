// Audio Reader — toolbar popup. Shows server health + a link to settings.

const DEFAULTS = { serverUrl: "http://localhost:8880" };

document.getElementById("open").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

(async () => {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const base = cfg.serverUrl.replace(/\/+$/, "");
  const dot = document.getElementById("dot");
  const text = document.getElementById("statusText");
  try {
    const resp = await fetch(base + "/health");
    if (resp.ok) {
      dot.classList.add("up");
      text.textContent = "Server is running";
    } else {
      dot.classList.add("down");
      text.textContent = "Server error (HTTP " + resp.status + ")";
    }
  } catch (e) {
    dot.classList.add("down");
    text.textContent = "Server not reachable";
  }
})();
