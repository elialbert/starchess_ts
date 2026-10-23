# starchess

Chess on a six-pointed star, fully in the browser. The home page is a live
bot-vs-bot game: pick the bots, set the speed, pause and step through it.

A TypeScript rewrite of [elialbert/starchess](https://github.com/elialbert/starchess)
(Rails + Angular). The rules and board come from the original engine; the
bots are new.

## The game

37 hexagonal spaces in a star. Each side has five pawns and a king, queen,
rook, bishop and knight on its five back spaces. Each game draws a random
arrangement for white and black gets its mirror image. Of the 120
arrangements, 28 are forced wins for white (mostly with the king in the
middle), so games only use the 92 that a deep search calls roughly level
(`src/engine/setups.json`, made by `npm run setups`). Then:

- **Pawns** step forward, may step twice from their start, take one space
  diagonally forward, and promote on the enemy's back spaces. A pawn that
  captures onto one of its own starting spaces can't step twice from there.
- **Bishops** slide along the four diagonals, **queens** along all six lines.
- **Rooks** slide north/south and may take one quiet (non-capturing) diagonal step.
- **Knights** jump two-and-one (or one-and-two) along neighbouring lines.
- **Kings** step one space. Checkmate wins; stalemate, threefold repetition,
  50 quiet moves, bare kings or 400 plies are draws.

### House rules

The game follows [Polgar's Starchess](http://www.polgarstarchess.com/Rules/ENRules.html)
(board, numbering, starting spaces, king/queen/bishop/knight and pawn moves,
promotion to queen/rook/bishop/knight on the enemy back spaces, no en passant,
no castling, stalemate is a draw) except:

- **Rook.** Polgar's rook moves only vertically. Here it can also take one
  non-capturing diagonal step, so it can change columns (added in the original
  Rails app in 2015).
- **Setup.** Polgar has the players take turns placing their pieces, each side
  choosing its own arrangement (14,400 possible setups). Here each game draws
  one arrangement for white and black gets the mirror image, as in Chess960
  (120 possible setups, 92 of them used).
- **Draws.** Threefold repetition, 50 moves without a capture or pawn move,
  kings alone on the board, and a 400-ply cap. Polgar's rules don't cover
  these; the cap keeps bot games short.

## The bots

| Bot | How it plays |
| --- | --- |
| Dice | Random legal moves. |
| Magpie | One move deep: grabs material, avoids hanging the piece it moves. |
| Classic | The first version's plain alpha-beta, ~300 ms a move. |
| Tactician | The engine, ~250 ms a move. |
| Oracle | The engine, ~1.5 s a move. |

The engine (`src/engine/engine.ts`) is a conventional alpha-beta searcher:
iterative deepening with aspiration windows, PVS, a transposition table,
null-move pruning, late-move reductions, (reverse) futility pruning, check
extensions, killer and history move ordering, and a quiescence search. Its
evaluation (`src/engine/eval.ts`) is linear in ~200 named weights: material,
piece-square tables, mobility, king zone attacks and shelter, hanging and
threatened pieces, pawn chains, tempo. The weights in
`src/engine/weights.json` are tuned from self-play. Bots run in a Web Worker.

## Making the AI stronger

`docs/AI.md` has the details: current strength, results so far, how the
harness works, and what to try next.

All the tools run games in parallel on worker threads, so a 600-game match
at 20k nodes a move takes about a minute on 24 cores.

```sh
# A vs B from the playable setups, each played with both colours. Elo for A
# with a 95% interval; --sprt stops as soon as the answer is clear.
npm run match -- --a engine,nodes=20000,weights=tuning/new.json --b engine,nodes=20000 --pairs 600 --sprt 0,10

# Texel tuning: self-play games -> positions labelled with the result ->
# fit the eval weights by gradient descent -> check with a match -> copy the
# winner to src/engine/weights.json, then repeat with the new engine.
npm run selfplay -- --games 30000 --out data/gen.txt
npm run texel -- --data data/gen.txt --out tuning/new.json

# SPSA hill-climbing of search options or single eval weights by self-play
npm run spsa -- --params futilityMargin:120:20,lmrDiv:2.5:0.3,w.val[2]:450:25 --iters 200

npm run bench      # fixed-depth node count (a pure speed-up mustn't change it) and nodes/s
npm run profile    # CPU profile of the bench: where the time goes
npm run gauntlet   # the engine against fixed references
npm run setups     # re-score the 120 setups after the engine changes
```

Player specs are `kind,key=value,...`, where kind is `engine`, `classic`,
`magpie` or `random`. Keys are `nodes`, `timeMs`, `depth`, `weights` (a JSON
file), `w.<weight>` (override one eval weight), `jitter` (node budget
variation, default 0.1) and any `SearchOptions` field (`lmr=false`,
`futilityMargin=150`, ...). Use node limits rather than time for
reproducible, machine-independent results.

## Layout

```
src/engine/board.ts       board graph (space neighbours), hex coordinates, mirrors
src/engine/rules.ts       move generation, check, game state, outcomes, setups
src/engine/engine.ts      the searching engine
src/engine/eval.ts        the tunable evaluation
src/engine/bots.ts        the bot roster (and the Classic search)
src/engine/bot.worker.ts  runs a bot off the main thread
src/ui/board-view.ts      SVG board with sliding pieces
src/main.ts               the watch page: match loop, panel, controls
tests/                    vitest: geometry, rules, engine (perft), bots
tools/                    match, selfplay, texel, spsa, bench, setups, smoke
```

## Commands

```sh
npm install
npm run dev        # dev server
npm test           # unit tests
npm run build      # typecheck + build to dist/
npm run smoke      # after build: watch a game in headless Chrome (set CHROME=... if needed)
```

URL parameters: `?white=magpie&black=oracle&speed=fast&paused`.

Pushes to `main` deploy to [starchess.elialbert.com](https://starchess.elialbert.com)
through Cloudflare Workers Builds (`npm run build`, then `npx wrangler deploy`).
`wrangler.jsonc` serves `dist/` as static assets; only `/api/*` runs
`worker/index.ts`, the place for a backend.
