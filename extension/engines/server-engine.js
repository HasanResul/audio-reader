// Audio Reader — Docker server engine.
//
// Produces audio by POSTing to a local OpenAI-compatible TTS server
// (/v1/audio/speech) and streaming the MP3 response. This is the original
// engine, now sitting behind the shared engine boundary: its only job is to
// turn {text, voice} into a streaming audio body and hand it to the player.

let abortController = null; // abort the previous fetch if a new read starts

export const serverEngine = {
  id: "server",

  async synthesize({ text, serverUrl, voice, speed }, player) {
    // Abort any previous fetch that might still be in progress.
    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    const base = (serverUrl || "").replace(/\/+$/, "");
    const speechUrl = base + "/v1/audio/speech";

    abortController = new AbortController();
    let resp;
    try {
      resp = await fetch(speechUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kokoro",
          input: text,
          voice,
          response_format: "mp3",
          stream: true,
          speed: 1.0  // server renders at 1.0; the player applies playbackRate
        }),
        signal: abortController.signal
      });
    } catch (e) {
      if (e.name === "AbortError") return;  // cancelled by a newer read; not an error
      player.report({ error: "Can't reach the TTS server at " + base + ". Is it running?" });
      return;
    }

    if (!resp.ok || !resp.body) {
      player.report({ error: "TTS server returned an error (HTTP " + resp.status + ")." });
      return;
    }

    await player.playMpegStream(resp.body, { speed });
  }
};
