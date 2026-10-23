# The starchess AI: state, tools, and what's next

Handoff notes for whoever works on the engine next. The README covers the game
and the commands at a glance; this is the working detail.

## Where things stand (2026-10-23)

The bots that matter are **Tactician** (250 ms a move) and **Oracle** (1.5 s),
both running `src/engine/engine.ts` with the eval in `src/engine/eval.ts` and
the weights in `src/engine/weights.json`. **Classic** is the first version's
search (`search()` in `src/engine/bots.ts`), kept as a fixed reference.

Every change below was measured with `npm run match` at 20k nodes a move,
paired games from the 92 playable setups, and SPRT (5%/5%):

| Change | Elo | Notes |
| --- | --- | --- |
| New engine (`engine,nodes=5000`) vs Classic at 20 ms | +282 | first comparison |
| Texel round 1 (gen1, 1.9M positions) | +78 | hand-set weights -> fitted |
| Texel round 2 (gen1+gen2, tapered eval, pawn terms) | +107 | |
| SEE pruning in quiescence (`seePrune`) | +21 | |
| Texel round 3 (gen2+gen3) | +35 | current `weights.json` = `tuning/texel3.json` |
| SPSA search margins | +15 | futility 110, rfp 85, delta 193, lmrBase 0.6, lmrDiv 2.3 |
| Speed: eval cache, faster `evaluate`, integer evals | +99 at 50 ms | vs `impl=engine0`; +11 [-2, +23] at 20k nodes (rounding only) |
| Texel round 4 (gen3+gen4) | +17 | current `weights.json` = `tuning/texel4b.json` |

Measured and **not adopted**: four new eval terms (rook/queen on a semi-open
or open column, piece defended by a pawn, piece within 2 of the enemy king),
fitted in the same Texel round 4: held-out loss 0.062199 vs 0.062295 without
them, but only +10 [-0, +20] in 1000 pairs (no SPRT verdict), and they cost
eval time. Search SPSA round 2 (`lmp=true,lmpBase=14,aspiration=36`; null-move
and LMR parameters didn't move): +1 [-8, +11] in 1000 pairs.

Measured and left **off** (the options still exist): `seeOrder` (neutral),
`improving` (-23), `lmp` (-61 with lmpBase 3: far too tight for this board;
worth retrying with a much larger base via SPSA), `iir` (neutral).
`nullMove` was neutral at fixed nodes but is on. `lmr` +29, `futility` +33,
`checkExt` +24 were confirmed early on.

Gauntlet (`npm run gauntlet -- --pairs 150`) with the current engine at 20k
nodes: Magpie 300-0, Classic (50 ms) +545, the round-1 engine
(`tools/refs/weights-r1.json`, `seePrune=false`) +113, itself at 5k nodes +234.

Bench signature (`npm run bench -- 9`): **592,704 nodes**, about 347k
nodes/s on the idle dev box (276k before the speed work). Profile (`npm run profile`):
`evaluate` + `add` are still ~54%, move generation ~10%, `attacked` ~7%.

## How the pieces fit

- `src/engine/rules.ts` is the reference rules (plain arrays, `Move`
  objects, `GameState`). The UI, the harness's game loop and the tests use it.
  Includes Polgar's "limping pawn" rule (`GameState.limping`).
- `src/engine/engine.ts` is the fast engine: `Position` (Int8Array board,
  zobrist hash `lo`/`hi`, limping bits, make/unmake, attack test, SEE,
  pseudo-legal movegen) and `Engine` (iterative deepening, aspiration, PVS, TT,
  null move, LMR, RFP, futility, check extension, killers, history,
  quiescence with delta and SEE pruning). Moves are ints:
  `from | to << 6 | promoType << 12`. `toRulesMove` converts back.
  `tests/engine.test.ts` cross-checks movegen and hashing against rules.ts
  (perft, random positions); run it after touching either.
- `src/engine/eval.ts` is linear in named weights. Each feature has a
  middlegame weight and an `eg.` endgame weight, blended by phase (N/B/R 1,
  Q 2, max 10). `evaluate(cells, side, W, trace?)`: with `trace`, it adds the
  feature counts into it, and the white-view score is exactly `dot(W, trace)`
  (tested). That's what Texel tuning relies on. Adding a feature: add a
  `block(...)`, compute it in `evaluate` via `add(index, ±count)`, give it a
  starting weight in `baseWeights()` (0 is fine), then re-tune.
  `weightsFromJSON` fills missing names from the base weights, and missing
  `eg.` weights from their middlegame value, so old weight files keep loading.
  `evaluate` caches material + PST tables per weights object (by identity), so
  never change a weights array in place; copy it (`players.ts` does).
- `Engine.eval()` rounds the eval to an integer (via the 0.01 grid, so float
  summation order can't flip a rounding) and caches it in a 2^18-entry table
  keyed by the position hash. Eval only depends on cells and side to move.
- `tools/refs/engine0/` is a frozen copy of the engine and eval as of 2c4e11e
  (with its own weights). Play it with the player option `impl=engine0`: that's
  how to run a time-limited match of new code against old. Freeze a new ref
  (`engine1`, ...) the same way when the current one gets too weak to be useful.
- `src/engine/setups.json` holds the engine's score for each of the 120
  mirrored setups (`npm run setups`). `src/engine/setups.ts` keeps the ones
  with |score| <= 300 as `PLAYABLE_SETUPS` (92 of them; the other 28 are
  forced mates for white). The UI and `match` use only the playable ones;
  `selfplay` uses all 120 for variety.

### The harness (`tools/`)

- `tools/lib/pool.ts` bundles `tools/lib/worker.ts` with esbuild into
  `.cache/harness-worker.mjs` and runs it on N-2 worker threads. Worker tasks
  are `pair` (two games, colours swapped), `selfplay` and `analyze`. A new
  task means a handler in `worker.ts`.
- `tools/lib/players.ts` parses player specs:
  `engine,nodes=20000,weights=x.json,w.val[2]=480,lmr=false`. Engine players
  vary their node budget per move by ±10% (`jitter`) so repeated pairings
  differ.
- `tools/lib/game.ts` plays one game with rules.ts. It adjudicates a win when
  the searching side reports |score| >= 1500 for 4 plies running (2500 in
  selfplay), and can play random opening plies.
- `tools/lib/match.ts` (`runMatch`) is used by `match`, `gauntlet` and `spsa`.
- `tools/texel.ts` reads selfplay lines, keeps quiet positions (not in check,
  |qsearch - static| <= 30), turns each into a sparse trace once, fits the
  sigmoid scale K, then runs full-batch Adam. It holds out 5% and writes the
  best held-out epoch. It converges within ~50-150 epochs at lr 1.5, so
  `--epochs 600` is plenty. Featurizing ~4M positions takes ~11 min on one
  core.
- Selfplay line format: 37 hex digits (piece codes on spaces 1..37), side to
  move, result for white (`1`, `0.5`, `0`).

### Local files (gitignored)

- `data/`: `gen1.txt` (30k games with round-0 weights, before the limping
  rule), `gen2.txt` (texel1 weights), `gen3.txt` (texel2 weights, with SEE),
`gen4.txt` (texel3 weights).
  About 2M positions each, 256 MB in all. Plus the `.log` files of every run.
- `tuning/`: `texel1..4b.json` and the SPSA logs. `tools/refs/weights-r1.json`
  is committed as a fixed gauntlet reference.

## Working conventions and gotchas

- **Pull before you push.** Another session works on deploy (Cloudflare
  Workers Builds deploys on push to main) and has committed in this same
  working directory. Its commit once swept up a staged `git rm` of ours.
  Check `git status` before committing.
- **Long jobs:** run them in the background with output to `data/<name>.log`
  and wait on the log (`until grep -q "^done" data/x.log; ...`). A 600 s tool
  timeout moves a foreground command to the background. A session restart
  kills running jobs, so log progress (SPSA does, one line per iteration, and
  its final θ can be read off the last line).
- **Memory:** the box has 30 GB. Texel on ~4.3M positions peaks around
  15 GB. A global OOM kill takes the whole tmux scope (and the Claude session
  in it) down with the job, so start long jobs in their own capped scope:
  `systemd-run --user --scope -q -p MemoryMax=14G -p MemorySwapMax=0 npm run ...`.
  Then only the job dies. (A worker-side player cache that never evicted once
  grew SPSA to 27 GB; it's bounded now.)
- **Don't run two pool jobs at once** unless you cap threads
  (`--threads 21`): the box has 24 cores and each pool takes N-2. Texel
  is single-threaded and can run alongside a match.
- **Node limits vs time limits:** node-limited matches are reproducible and
  machine-independent, but they don't reward speed. For a pure speed-up, the
  bench node count must not change; then the gain is the nodes/s change.
  For anything that trades speed for nodes (SEE, extra eval terms), confirm
  with a time-limited match too (`engine,timeMs=50`), on an idle machine.
- SPRT bounds used so far: `--sprt 0,10` for things expected to gain a lot
  (new weights), `--sprt -3,7` for small search tweaks.
- After an engine change that moves its opinions, consider `npm run setups`.
  The playable set could shift slightly; it was last scored with round-0
  weights at 3M nodes.
- `npm test`, `npm run build` (tsc includes `tools/`), then
  `npm run smoke` (headless Chrome via `/usr/bin/google-chrome`) before
  committing UI-visible changes. CI runs all three.

## Next: the three agreed tasks

Status (2026-10-23): round 4 is done (gen4 = 2.14M positions with texel3
weights; texel4b adopted). The speed items "eval cache" and "cut overhead in
`evaluate`" are done. Search SPSA round 2 was neutral. Plain rounds are
flattening (+107, +35, +17): for round 5, try selfplay at 20k nodes for better
labels rather than more 5k-node games.

### 1. Another self-play -> Texel round

```sh
npm run selfplay -- --games 30000 --out data/gen4.txt --seed 44 > data/gen4.log 2>&1   # ~25 min
npm run texel -- --data data/gen3.txt,data/gen4.txt --out tuning/texel4.json --epochs 600 --max 4400000 > data/texel4.log 2>&1
npm run match -- --a engine,nodes=20000,weights=tuning/texel4.json --b engine,nodes=20000 --pairs 1000 --sprt 0,10
cp tuning/texel4.json src/engine/weights.json   # if it passes
```

Returns are shrinking (+107, then +35). Things that may help more than another
plain round:
- More nodes in selfplay (`--spec engine,nodes=20000,noise=20`) for better
  labels, at the cost of time.
- New features before re-tuning. Ideas: king tropism (distance of enemy
  pieces to the king), rook/queen on a column free of own pawns, knight
  outposts (defended by a pawn, not attackable by enemy pawns), mobility
  counted only to spaces not attacked by enemy pawns, a "safe checks" term
  for king safety.
- Watch for over-fitted weights. Round 2 made some endgame mobility weights
  strongly negative (`eg.mob[2]` around -31). They passed the match, but a
  little L2 (`--l2`) or more endgame data may make them saner.

### 2. Engine speed

The eval is ~2/3 of the time. Pure speed-ups must keep the bench node count
(592,704 at depth 9; it changes whenever the weights or search change, so
re-record the baseline first). Ideas, roughly in order of payoff:
- An eval cache: a small hash table keyed by `pos.lo`/`pos.hi` storing the
  static eval. Quiescence revisits a lot of positions.
- Cut overhead in `evaluate`: the `add()` call per feature (21% self time)
  could accumulate counts into a local typed array and do one dot product
  per phase at the end. Replace `for...of` over small arrays with index
  loops, and the per-call `.fill` of six arrays with a generation counter.
- Incremental material + piece-square terms in `Position.make/unmake`; only
  mobility, attacks and pawn terms need the full pass.
- Lazy eval: if material + PST is far outside (alpha, beta), skip the
  mobility/attack pass. That changes node counts, so measure it as a search
  change.
- Movegen and `attacked`: precomputed ray tables (`RAYS[s][d]` as flat
  Int8Arrays) instead of walking `NB` each step.
- Check the gain with `npm run bench`, then a time-limited match against the
  previous commit's engine. Easiest way: build the old engine into a ref, or
  compare `timeMs=50` vs `timeMs=50` across a `git stash`.

### 3. SPSA over eval weights (and search again)

`npm run spsa -- --params name:start:step,... --iters 300 --pairs 22`, with
names like `w.val[2]` or `w.eg.mob[3]`. Use the current weights.json value as
the start (look it up there) and a step of about 5-10% of its size. Good
targets: piece values (`val`, `eg.val`), `kzone[*]`, `hang[*]`, `tempo`, and
any weights Texel left looking odd. Texel fits the eval to game results; SPSA
fits it to winning games with this search, so they complement each other.
Also worth a second search pass: `nullBase`, `nullDiv`, `lmrMinMoves`,
`aspiration`, `contempt`, and `lmp` with `lmpBase` around 8-15. Always
confirm the final θ with an SPRT match at 20k nodes before adopting it.
SPSA's gains are small and noisy: 300 iterations of 22 pairs at 5k nodes
take ~30 min.
