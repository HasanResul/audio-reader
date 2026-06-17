## Audience

Docs outside `docs/scratchpad/` are LLM-authored, LLM-read, LLM-maintained. Format for LLM consumption: terse, content-first, no filler prose. `docs/scratchpad/` is human-written raw input for LLM processing.

## Naming

- `YYMMDD_descriptive-name.md` for all docs (today: `260427_*`)
- Exceptions (no prefix): `readme.md`, `index.yaml`, `glossary.md`, `CLAUDE.md`, and other living references

## Directory Layout

- `docs/scratchpad/` — human-only. Raw idea dumps written and maintained exclusively by the user. LLMs must not create, edit, or restructure files here. Read-only as input context.
- `docs/plans/` — implementation and research plans + impl logs
- `docs/notes/` — LLM-authored analysis, brainstorm, design notes. Distinguish via `kind:` frontmatter (`analyze | brainstorm | design`); single shared template in `docs/templates/note.md.template`. No per-kind subdirs.
- `docs/experiments/` — capability tests and benchmarks. **One self-contained subdir per experiment**: `docs/experiments/<slug>/` containing `plan.md`, `results/`, `analysis.md`, and optionally `harness/` for experiment-bound code (uv project, runners, prompts, judge harness). Code that's only useful for one experiment lives with that experiment, not in `scripts/`. Heavy artifacts (raw outputs, datasets) live in `local/experiments/<slug>/` (gitignored), referenced from the doc.
- `docs/research/` — web-researcher's external-source synthesis. Owned by the `web-researcher` subagent; do not write here from the main agent. Created on first use.
- `docs/explore/` — explore-with-memory subagent's codebase/local-file exploration reports. Reserved; created when the subagent ships (see `docs/plans/260427_explore-with-memory-subagent.md`).
- `docs/vision/` — vision, glossary, design principles (living). Created on first use.
- `docs/archive/` — superseded/historical. Created on first use.
- `scripts/` — repo tooling, one subdir + README per tool
- `local/` — gitignored machine-local workspace (incl. `local/experiments/<slug>/` for heavy experiment artifacts)

## Index Files

Every `docs/` subdirectory has an `index.yaml`. No files directly under `docs/` — always pick or create a subdirectory. Format and maintenance rules live in `docs/templates/index.yaml.template`.

**Experiment-canonical indexes are authoritative; standalone notes complement, don't replace.** When a run produces decision-shaping numbers, add them to the experiment's `analysis.md` summary table AND `runs.md` row table even if the work is also documented in a standalone note. Future sessions read `analysis.md` and `runs.md` as the canonical T1/T2/T3/T4 capability matrix; if a run's numbers live only in a standalone note, the canonical matrix is silently incomplete.

## Templates

Canonical templates live in `docs/templates/`. Each template contains its own usage rules at the top — read it before creating or editing a doc of that type.

- `index.yaml.template` — read before creating or editing any `index.yaml`
- `plan.md.template` — read before creating or editing any plan in `docs/plans/`
- `note.md.template` — read before creating or editing any note in `docs/notes/`
- `experiment.md.template` — read before creating or editing an experiment plan in `docs/experiments/<slug>/plan.md`
- `research.md.template` — used by `web-researcher` subagent for `docs/research/` reports

Vision and glossary docs have no fixed template — use content-first summary headings, not standard "Background/Approach" structure.

If you hit friction using a template (missing field, awkward shape, unclear rule), edit the template. Templates are ideation, not law.

## Status Flagging

Any non-final decision in a doc must be marked `status: draft` in frontmatter (or `(draft)` inline next to the claim). Unflagged content is read as decided in future sessions and compounds — a draft idea referenced as truth seeds further docs that assume it. Flag aggressively; demote `draft` → `active`/`completed` only when the decision is real.

**LLMs auto-maintain status across sessions.** Status is owned by the LLM working on the doc, not the user. First edit of a working session bumps to the in-progress state (plans: `draft` → `active`; experiments: `ready` → `running`). Final edit when work concludes bumps to the terminal state (`completed` / `complete` / `superseded` / `abandoned`). Always also bump `updated:` in frontmatter on any edit. State machine per template. Stale status is drift; auto-bump aggressively. Apply to plans, experiments, notes, research reports — every doc with a `status:` field.