/**
 * The old hand-coded UI (`?ai=nope`): the original Rails + Angular app's home
 * page, rebuilt by hand. Its header, and two bots playing on its board, driven
 * by the new engine. Nothing else, as it was.
 */
import { type BotId } from "../engine/bots";
import { type Color, type GameState, type Outcome, WHITE, applyMove, colorOf, legalMoves, newGame, outcome, typeOf } from "../engine/rules";
import { randomSetup } from "../engine/setups";
import { BotClient } from "../ui/bot-client";
import { uiSwitch } from "../ui/ui-switch";
import "./old.css";

// ---- the old board layout (boardService.js.coffee) ----

const ROWS = 7;
const COLS = 9;
/** row → col → space id; every other square in the 7×9 grid is hidden */
const SPACE_ID_LOOKUP: Record<number, Record<number, number>> = {
  0: { 2: 10, 3: 16, 5: 27, 6: 34 },
  1: { 2: 9, 3: 15, 4: 21, 5: 26, 6: 33 },
  2: { 1: 3, 2: 8, 3: 14, 4: 20, 5: 25, 6: 32, 7: 36 },
  3: { 0: 1, 1: 2, 2: 7, 3: 13, 4: 19, 5: 24, 6: 31, 7: 35, 8: 37 },
  4: { 2: 6, 3: 12, 4: 18, 5: 23, 6: 30 },
  5: { 2: 5, 3: 11, 4: 17, 5: 22, 6: 29 },
  6: { 2: 4, 6: 28 }
};
const LETTER = ["", "p", "n", "b", "r", "q", "k"];
const pieceImage = (p: number) => (p ? `old/Chess_${LETTER[typeOf(p)]}${colorOf(p) === WHITE ? "l" : "d"}t60.png` : "old/empty.png");

/** white's bot, then black's */
const BOTS: BotId[] = ["tactician", "oracle"];
/** the old home page moved its bots every 2.5 seconds */
const PACE = new URLSearchParams(location.search).get("speed") === "fast" ? 300 : 2500;

// ---- the page (layouts/application.html.erb and starchess_games.html) ----

document.title = "StarChess Online";
document.body.innerHTML = `
  <nav class="navbar navbar-inverse">
    <div class="container">
      <div class="navbar-header">
        <a class="navbar-brand" href="?ai=nope">StarChess Online!</a>
        <span class="navbar-text" id="byline">a <a href="http://elialbert.com">crumble</a> production</span>
        <span class="navbar-text">Note: Sign-in disabled. This project is now unsupported...</span>
      </div>
    </div>
  </nav>
  <div class="container">
    <div class="board-scroll">
      <div class="container" id="gamewrapper"></div>
    </div>
  </div>`;
document.querySelector(".navbar .container")!.append(uiSwitch());

// starchessBoard.html: seven rows of nine clipped squares
const wrapper = document.getElementById("gamewrapper")!;
const innerclips = new Map<number, HTMLElement>();
const images = new Map<number, HTMLImageElement>();
for (let row = 0; row < ROWS; row++) {
  const gamerow = document.createElement("div");
  gamerow.className = "gamerow";
  for (let col = 0; col < COLS; col++) {
    const space = SPACE_ID_LOOKUP[row]![col];
    const outer = document.createElement("div");
    outer.className = "outerclip" + (space ? "" : " removeSpace");
    const inner = document.createElement("div");
    inner.className = "innerclip";
    const label = document.createElement("span");
    label.className = "space_id";
    const img = document.createElement("img");
    img.className = "piece_image";
    img.src = pieceImage(0);
    inner.append(label, img);
    outer.append(inner);
    gamerow.append(outer);
    if (space) {
      inner.dataset.space = String(space);
      innerclips.set(space, inner);
      images.set(space, img);
    }
  }
  wrapper.append(gamerow);
}

// Bootstrap after the old stylesheet, as the old layout linked it; show the page once it's in
const bootstrap = document.createElement("link");
bootstrap.rel = "stylesheet";
bootstrap.href = "https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.3.6/css/bootstrap.min.css";
const reveal = () => (document.body.style.visibility = "visible");
bootstrap.onload = bootstrap.onerror = reveal;
setTimeout(reveal, 3000);
document.head.append(bootstrap);

// ---- the bots play, one game after another ----

const client = new BotClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let game: GameState = newGame(randomSetup());
let plies = 0;
let over: Outcome | null = null;

function render(lastTo = 0) {
  for (const [space, inner] of innerclips) {
    inner.classList.toggle("last_selected", space === lastTo);
    images.get(space)!.src = pieceImage(game.cells[space]!);
  }
}

async function run() {
  for (;;) {
    game = newGame(randomSetup());
    plies = 0;
    over = null;
    render();
    const seed = (Math.random() * 2 ** 31) | 0;
    while (!over) {
      const color: Color = game.turn;
      const started = performance.now();
      const res = await client.request(game, BOTS[color]!, seed + game.ply * 7919, seed + color);
      await sleep(PACE - (performance.now() - started));
      game = applyMove(game, res.move);
      plies++;
      over = outcome(game, legalMoves(game));
      render(res.move.to);
    }
    await sleep(5000);
  }
}
void run();

// for the smoke test
window.__sc = {
  get game() {
    return game;
  },
  get plies() {
    return plies;
  },
  get over() {
    return over;
  },
  yourMoves: []
};
