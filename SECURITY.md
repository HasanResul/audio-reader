# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via [GitHub Security Advisories](https://github.com/HasanResul/audio-reader/security/advisories/new)
(Security → Report a vulnerability). Include:

- affected version / commit,
- a description and impact,
- steps to reproduce or a proof of concept.

You'll get an acknowledgement, and a fix or mitigation plan once the report is
triaged. Please allow reasonable time to address the issue before public disclosure.

## Scope & threat model

Audio Reader is a local-first browser extension. Things especially in scope:

- **Data exfiltration** — the extension must not send page content, selections, or any
  user data anywhere except the user's own local TTS server (`localhost`) and the
  Hugging Face Hub model download. Any path that leaks data off the machine is a
  vulnerability.
- **Content-script / page-context boundary** — the in-page control bar runs in a closed
  Shadow DOM and is a remote control only; it must not become an injection or
  data-echo vector.
- **Permissions** — the extension requests the minimum host permissions needed
  (`localhost`, `huggingface.co`, `activeTab`). Reports of over-broad permission use are
  welcome.
- **Supply chain** — the browser engine bundles `kokoro-js`, `onnxruntime-web`, and an
  MP3 encoder, and vendors the ORT wasm. Concerns about bundled/vendored artifacts are
  in scope.

Out of scope: vulnerabilities in the upstream Kokoro model, the third-party
`kokoro-fastapi` Docker image, or the browser itself — report those to their
respective projects.
