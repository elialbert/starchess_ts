# starchess

Chess on a six-pointed star, fully in the browser. The home page is a live
bot-vs-bot game: pick the bots, set the speed, pause and step through it.

A TypeScript rewrite of [elialbert/starchess](https://github.com/elialbert/starchess)
(Rails + Angular). The rules and board come from the original engine; the
bots are new.

## The game

37 hexagonal spaces in a star. Each side has five pawns; in the setup phase the
players take turns placing a king, queen, rook, bishop and knight on their five
back spaces. Then:

- **Pawns** step forward, may step twice from their start, take one space
  diagonally forward, and promote on the enemy's back spaces.
- **Bishops** slide along the four diagonals, **queens** along all six lines.
- **Rooks** slide north/south and may take one quiet (non-capturing) diagonal step.
- **Knights** jump two-and-one (or one-and-two) along neighbouring lines.
- **Kings** step one space. Checkmate wins; stalemate, threefold repetition,
  50 quiet moves, bare kings or 400 plies are draws.

## The bots

| Bot | How it plays |
| --- | --- |
| Dice | Random legal moves, random setup. |
| Magpie | One move deep: grabs material, avoids hanging the piece it moves. |
| Tactician | Iterative-deepening alpha-beta + quiescence, ~300 ms a move. |
| Oracle | The same search with ~1.5 s a move. |

All but Dice set up their pieces by trying each placement against a few random
completions of the setup and keeping the one that leaves their king safest
(random setups otherwise allow knight mates on move one). Searching bots get a
small random per-game "style" so games don't repeat. Bots run in a Web Worker.

## Layout

```
src/engine/board.ts       board graph (space neighbours), hex coordinates
src/engine/rules.ts       move generation, check, game state, outcomes
src/engine/bots.ts        evaluation, search, the bot roster
src/engine/bot.worker.ts  runs a bot off the main thread
src/ui/board-view.ts      SVG board with sliding pieces
src/main.ts               the watch page: match loop, panel, controls
tests/                    vitest: geometry, rules, bots
tools/arena.ts            headless bot tournament
tools/smoke.mjs           headless-Chrome smoke test of the built site
```

## Commands

```sh
npm install
npm run dev        # dev server
npm test           # unit tests
npm run build      # typecheck + build to dist/
npm run smoke      # after build: watch a game in headless Chrome (set CHROME=... if needed)
npm run arena -- 4 random,magpie,tactician   # bot tournament, 4 games per side per pairing
```

URL parameters: `?white=magpie&black=oracle&speed=fast&paused`.

Pushes to `main` deploy to GitHub Pages (`.github/workflows/pages.yml`).
