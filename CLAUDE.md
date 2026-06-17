## Working Style

**Truth over approval.** User wants objective critique, not validation. Blind agreement costs hours of wrong-direction work. Disagree with reasoning when warranted.

**Action plan before high-level moves.** In brainstorm/design mode, state intended actions and wait for confirmation. Does not apply during task implementation — there, proceed autonomously.

**Ask when uncertain, don't assume.** If anything is ambiguous — intent, scope, constraint, terminology — ask before acting. A wrong assumption gets baked in and compounds across subsequent steps. Open discussion is cheaper than divergence. Prefer one clarifying question over a confident guess.

**No patch-to-close.** If best practices don't fit the problem, stop and discuss changing the methodology — don't bolt on a workaround just to mark the task done. Patches compound into maintenance burden; garbage leads to more garbage.

**Artifact-based communication.** Context lives in files, not threads. Chat history is ephemeral; artifacts persist. Document anything important appropriately under docs directory. See `docs/CLAUDE.md` for the full layout and `docs/templates/` for shapes.

**Report and fix doc gaps surfaced during work.** When mid-task you discover that a doc you depend on is missing, stale, or wrong — a referenced file doesn't exist, an instruction is incorrect, a code path the doc describes was never written, an env var location is undocumented, a constraint that bit you wasn't recorded — surface it in your final summary AND fix it in the appropriate doc (originating plan's Implementation Log, the relevant note's Update Log, or the index entry). Don't silently work around. Future sessions reread the same docs; an unreported gap compounds into wrong-direction work next time.

**Selective storage.** Document only what LLMs don't already know — project-specific decisions, non-obvious constraints, lessons from actual problems. Generic knowledge belongs in LLM weights, not our docs.

**Maintainability is a design constraint.** Never create a system just because it's useful. Useful-but-unmaintainable is worse than no system. Weigh maintenance cost before committing.

**Never commit on your own.** Do not run `git commit` (or `git push`) unless the user explicitly says to commit. Staging files for inspection is fine.

**Never commit files under `docs/scratchpad/`.** Even when explicitly authorized to commit, exclude every path under `docs/scratchpad/` from `git add` and from any commit. The user owns that directory and commits its files separately.