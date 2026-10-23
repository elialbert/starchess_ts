# starchess

In-browser starchess (chess on a hexagonal star) with a live bot-vs-bot watch
page and a tunable alpha-beta engine.

- `README.md`: the game, house rules, bots, commands, layout, deploy.
- `docs/AI.md`: engine and tuning handoff. Current strength, results log,
  harness internals, gotchas, and the next tasks (Texel round, engine speed,
  SPSA over eval weights). Read it before working on the AI.

Conventions:
- `npm test`, `npm run build` (typechecks `src`, `tests` and `tools`) and,
  for UI changes, `npm run smoke` before committing.
- Pull before pushing. Another session handles deploy (Cloudflare Workers
  Builds, on push to main) and sometimes commits in this working directory.
- Engine changes are judged by `npm run match` with SPRT, not by eye. Record
  results in `docs/AI.md`.
- Long harness jobs go in the background with logs in `data/` (gitignored).
