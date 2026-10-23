import { BOTS, type BotId, botInfo, evaluate } from "./engine/bots";
import {
  BLACK,
  COLOR_NAME,
  type Color,
  type GameState,
  type Move,
  type Outcome,
  WHITE,
  applyMove,
  colorOf,
  legalMoves,
  moveLabel,
  newGame,
  setupName,
  outcome,
  typeOf,
  PROMOTIONS,
  inCheck
} from "./engine/rules";
import { randomSetup } from "./engine/setups";
import { BoardView } from "./ui/board-view";
import { BotClient } from "./ui/bot-client";
import "./ui/style.css";

// ---- settings (remembered per browser; URL params win, for links and the smoke test) ----

const SPEEDS = { slow: 3200, normal: 1600, fast: 800 } as const;
type Speed = keyof typeof SPEEDS;
/** the shortest a bot takes to answer you, so its move doesn't land on top of yours */
const REPLY_MS = 400;

type Mode = "watch" | "play";
type Player = BotId | "human";

interface Settings {
  white: BotId;
  black: BotId;
  speed: Speed;
  numbers: boolean;
  /** play mode: your colour and the bot you face */
  side: Color;
  opponent: BotId;
}

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc: fine, just not remembered */
    }
  }
};

const isBot = (id: string | null): id is BotId => BOTS.some((b) => b.id === id);
const params = new URLSearchParams(location.search);
const settings: Settings = store.get<Settings>("starchess.settings", {
  white: "tactician",
  black: "tactician",
  speed: "normal",
  numbers: false,
  side: WHITE,
  opponent: "tactician"
});
// the page always opens on the tuned engine against its slower self, the quick one moving first
settings.white = "tactician";
settings.black = "oracle";
if (isBot(params.get("white"))) settings.white = params.get("white") as BotId;
if (isBot(params.get("black"))) settings.black = params.get("black") as BotId;
if (params.get("speed") && params.get("speed")! in SPEEDS) settings.speed = params.get("speed") as Speed;
if (isBot(params.get("opponent"))) settings.opponent = params.get("opponent") as BotId;
if (params.get("side") === "black") settings.side = BLACK;
else if (params.get("side") === "white") settings.side = WHITE;
/** Not remembered: the page always opens on a bot game, unless a link asks for play. */
let mode: Mode = params.get("mode") === "play" ? "play" : "watch";

// ---- DOM ----

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const boardWrap = $("board-wrap");
const view = new BoardView(boardWrap);
const banner = $("banner");
const statusEl = $("status");
const movesEl = $("moves");
const playBtn = $<HTMLButtonElement>("play");
const stepBtn = $<HTMLButtonElement>("step");
const newBtn = $<HTMLButtonElement>("new");
const numbersBox = $<HTMLInputElement>("numbers");
const fortune = $("fortune") as unknown as SVGSVGElement;
const evalText = $("eval-text");
const evalDetail = $("eval-detail");
const selects = [$<HTMLSelectElement>("bot-white"), $<HTMLSelectElement>("bot-black")];
const playerRows = [$("p-white"), $("p-black")];
const capturedEls = [$("cap-white"), $("cap-black")];
const youEls = playerRows.map((r) => r.querySelector<HTMLElement>(".you")!);
const undoBtn = $<HTMLButtonElement>("undo");
const setupEl = $("setup");
const modeBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const sideBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-side]")];
const speedGroup = document.querySelector<HTMLElement>(".speed")!;
const sideGroup = document.querySelector<HTMLElement>(".side")!;

for (const [i, sel] of selects.entries()) {
  for (const b of BOTS) sel.append(new Option(b.name, b.id));
  sel.addEventListener("change", () => {
    if (mode === "play") settings.opponent = sel.value as BotId;
    else settings[i === WHITE ? "white" : "black"] = sel.value as BotId;
    sel.title = botInfo(sel.value as BotId).blurb;
    store.set("starchess.settings", settings);
    renderPlayers();
    renderStatus();
  });
}
const speedBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];
for (const b of speedBtns) {
  b.addEventListener("click", () => {
    settings.speed = b.dataset.speed as Speed;
    store.set("starchess.settings", settings);
    renderSpeed();
  });
}
numbersBox.checked = settings.numbers;
const renderNumbers = () => view.svg.classList.toggle("show-numbers", settings.numbers);
numbersBox.addEventListener("change", () => {
  settings.numbers = numbersBox.checked;
  store.set("starchess.settings", settings);
  renderNumbers();
});
renderNumbers();

// ---- the match ----

interface Ply {
  move: Move;
  label: string;
  after: GameState;
  /** the searching bot's view after it chose this move, in centipawns for white */
  score?: number;
}

const client = new BotClient();
let setup = randomSetup();
let game = newGame(setup);
let plies: Ply[] = [];
let over: Outcome | null = null;
let running = params.get("paused") === null;
let stepOnce = false;
let thinking: Color | null = null;
let lastScore: { score: number; depth?: number; nodes?: number } | null = null;
/** bumped on every new game, so a stale bot answer or countdown knows to give up */
let generation = 0;
let gameSeed = 0;
let wake: (() => void) | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nudge = () => {
  wake?.();
  wake = null;
};
const playerFor = (c: Color): Player =>
  mode === "play" ? (c === settings.side ? "human" : settings.opponent) : c === WHITE ? settings.white : settings.black;
const playerName = (p: Player) => (p === "human" ? "you" : botInfo(p).name);

// ---- your moves ----

/** set while waiting for you to move: hands your move to the game loop */
let yourMove: ((m: Move) => void) | null = null;
let yourMoves: Move[] = [];
let picked = 0;
const promoEl = document.createElement("div");
promoEl.className = "promo";
promoEl.hidden = true;
boardWrap.append(promoEl);

function awaitYourMove(): Promise<Move> {
  yourMoves = legalMoves(game);
  view.setMovable([...new Set(yourMoves.map((m) => m.from))]);
  return new Promise((resolve) => (yourMove = resolve));
}

function pick(space: number) {
  picked = space;
  view.select(space, yourMoves.filter((m) => m.from === space).map((m) => m.to));
}

function stopListening() {
  yourMove = null;
  yourMoves = [];
  promoEl.hidden = true;
  view.setMovable([]);
  pick(0);
}

function submit(m: Move) {
  const resolve = yourMove;
  stopListening();
  resolve?.(m);
}

view.onSpace = (space) => {
  if (!yourMove) return;
  promoEl.hidden = true;
  const options = yourMoves.filter((m) => m.from === picked && m.to === space);
  if (options.length === 1) return submit(options[0]!);
  if (options.length > 1) return choosePromotion(options);
  // pick up one of yours, or put it back down
  pick(space !== picked && yourMoves.some((m) => m.from === space) ? space : 0);
};

function choosePromotion(options: Move[]) {
  promoEl.replaceChildren();
  promoEl.classList.toggle("black", game.turn === BLACK);
  for (const type of PROMOTIONS) {
    const m = options.find((o) => typeOf(o.promo) === type);
    if (!m) continue;
    const b = document.createElement("button");
    b.textContent = ["", "♟", "♞", "♝", "♜", "♛", "♚"][type] + "︎";
    b.title = ["", "pawn", "knight", "bishop", "rook", "queen", "king"][type]!;
    b.addEventListener("click", () => submit(m));
    promoEl.append(b);
  }
  promoEl.hidden = false;
}

function startGame() {
  generation++;
  stopListening();
  setup = randomSetup();
  game = newGame(setup);
  plies = [];
  over = null;
  lastScore = null;
  gameSeed = (Math.random() * 2 ** 31) | 0;
  view.clear();
  view.render(game);
  banner.hidden = true;
  renderAll();
  void runGame(generation);
}

async function runGame(gen: number) {
  while (gen === generation && !over) {
    while (!running && !stepOnce) {
      await new Promise<void>((r) => (wake = r));
      if (gen !== generation) return;
    }
    const stepping = stepOnce;
    stepOnce = false;
    const color = game.turn;
    const player = playerFor(color);
    if (player === "human") {
      const move = await awaitYourMove();
      if (gen !== generation) return;
      play(move);
      continue;
    }
    thinking = color;
    renderPlayers();
    renderStatus();
    const started = performance.now();
    const res = await client.request(game, player, gameSeed + game.ply * 7919, gameSeed + color);
    if (gen !== generation) return;
    // the opening move waits for the pieces to land
    const pace = Math.max(mode === "play" ? REPLY_MS : SPEEDS[settings.speed], game.ply ? 0 : 1200);
    if (!stepping) await sleep(pace - (performance.now() - started));
    if (gen !== generation) return;
    thinking = null;
    if (res.score !== undefined) lastScore = { score: res.score, depth: res.depth, nodes: res.nodes };
    play(res.move, res.score);
  }
}

function play(move: Move, score?: number) {
  const after = applyMove(game, move);
  plies.push({ move, label: moveLabel(move, after), after, score });
  game = after;
  over = outcome(game, legalMoves(game));
  view.render(game, move);
  renderAll();
  if (over) finish(over);
}

function finish(res: Outcome) {
  void countdown(generation, res);
}

async function countdown(gen: number, res: Outcome) {
  banner.hidden = false;
  const winner = res.winner === null ? null : playerFor(res.winner);
  const who = winner === null ? "Draw" : winner === "human" ? "You win" : `${botInfo(winner).name} wins`;
  const how = `${res.winner === null ? "" : `${COLOR_NAME[res.winner]}, `}by ${res.reason}`;
  if (mode === "play") {
    banner.innerHTML = `<strong>${who}</strong><span>${how}</span><small>New game for another, or undo to try again</small>`;
    return;
  }
  for (let left = 10; gen === generation; ) {
    banner.innerHTML = `<strong>${who}</strong><span>${how}</span><small>${
      running ? `next game in ${left}s` : "paused: press play for the next game"
    }</small>`;
    await sleep(1000);
    if (running) left--;
    if (left <= 0 && gen === generation) return startGame();
  }
}

// ---- rendering ----

function renderPlayers() {
  for (const c of [WHITE, BLACK] as Color[]) {
    const row = playerRows[c]!;
    row.classList.toggle("to-move", !over && game.turn === c);
    row.classList.toggle("thinking", thinking === c);
    const player = playerFor(c);
    youEls[c]!.hidden = player !== "human";
    selects[c]!.hidden = player === "human";
    if (player !== "human") {
      selects[c]!.value = player;
      selects[c]!.title = botInfo(player).blurb;
    }
    // what this side has taken
    const taken = plies
      .filter((p) => p.move.captured && colorOf(p.move.piece) === c)
      .map((p) => typeOf(p.move.captured))
      .sort((a, b) => b - a);
    capturedEls[c]!.textContent = taken.map((t) => ["", "♟", "♞", "♝", "♜", "♛", "♚"][t] + "︎").join("");
  }
}

function renderStatus() {
  const name = (c: Color) => `${COLOR_NAME[c]} (${playerName(playerFor(c))})`;
  const move = `Move ${Math.floor(game.ply / 2) + 1}: `;
  if (over) statusEl.textContent = over.winner === null ? `Draw by ${over.reason}.` : `Checkmate: ${name(over.winner)} wins.`;
  else if (mode === "watch") statusEl.textContent = `${move}${name(game.turn)} to play.`;
  else if (playerFor(game.turn) === "human")
    statusEl.textContent = `${move}your move${inCheck(game.cells, game.turn) ? ", and you're in check" : ""}. Click a piece, then where it goes.`;
  else statusEl.textContent = `${move}${botInfo(settings.opponent).name} is thinking.`;
}

const fmtScore = (score: number) =>
  Math.abs(score) > 99000 ? (score > 0 ? "White mates" : "Black mates") : `${score >= 0 ? "+" : "−"}${(Math.abs(score) / 100).toFixed(1)}`;

/** Each position's score for white, from the start of the game: bots that don't search carry the last one on. */
function scoreTrail(): number[] {
  const trail = [0];
  for (const p of plies) trail.push(p.score ?? trail.at(-1)!);
  if (over) trail[trail.length - 1] = over.winner === null ? 0 : over.winner === WHITE ? 1e5 : -1e5;
  return trail;
}

const FORTUNE_H = 64;
const fortuneTip = document.createElement("div");
fortuneTip.className = "tip";
fortuneTip.hidden = true;
fortune.parentElement!.append(fortuneTip);

/**
 * The fortune line sits between the two names and leans toward whoever is ahead:
 * up favours the side named above it.
 */
function renderFortune() {
  const trail = scoreTrail();
  const w = fortune.clientWidth || 300;
  const h = FORTUNE_H;
  const span = Math.max(40, trail.length - 1);
  const topIsWhite = mode === "play" && settings.side === BLACK;
  const x = (i: number) => (i / span) * w;
  const y = (score: number) => {
    const lean = Math.abs(score) > 99000 ? Math.sign(score) : Math.tanh(score / 700);
    return h / 2 - (topIsWhite ? lean : -lean) * (h / 2 - 3);
  };
  const pts = trail.map((sc, i) => `${x(i).toFixed(1)},${y(sc).toFixed(1)}`);
  const last = trail.length - 1;
  fortune.setAttribute("viewBox", `0 0 ${w} ${h}`);
  fortune.innerHTML = `
    <defs><pattern id="fortune-ht" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
      <circle class="area-dot" cx="2" cy="2" r=".9"/></pattern></defs>
    <path class="area" d="M0,${h / 2} L${pts.join(" L")} L${x(last)},${h / 2} Z"/>
    <line class="zero" x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/>
    <polyline class="line" points="${pts.join(" ")}"/>
    <circle class="now" r="4.5" cx="${x(last)}" cy="${y(trail[last]!)}"/>
    <line class="cross" y1="0" y2="${h}" visibility="hidden"/>
    <rect class="hit" x="0" y="0" width="${w}" height="${h}"/>`;

  const cross = fortune.querySelector<SVGLineElement>(".cross")!;
  const hit = fortune.querySelector<SVGRectElement>(".hit")!;
  hit.addEventListener("pointermove", (e) => {
    const box = fortune.getBoundingClientRect();
    const i = Math.max(0, Math.min(last, Math.round(((e.clientX - box.left) / box.width) * span)));
    cross.setAttribute("x1", String(x(i)));
    cross.setAttribute("x2", String(x(i)));
    cross.setAttribute("visibility", "visible");
    const p = plies[i - 1];
    const label = p ? `${Math.ceil(i / 2)}${i % 2 ? "." : "…"} ${p.label}` : "Start";
    fortuneTip.textContent = `${label}   ${fmtScore(trail[i]!)}`;
    fortuneTip.style.left = `${box.left - fortune.parentElement!.getBoundingClientRect().left + (x(i) / w) * box.width}px`;
    fortuneTip.hidden = false;
  });
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    fortuneTip.hidden = true;
  });

  let score: number;
  let detail = "";
  if (lastScore) {
    score = lastScore.score;
    if (lastScore.depth) detail = `depth ${lastScore.depth} · ${Intl.NumberFormat("en", { notation: "compact" }).format(lastScore.nodes ?? 0)} positions`;
  } else {
    score = evaluate(game.cells, WHITE);
    detail = "material & position";
  }
  if (over) score = trail[last]!;
  evalText.textContent = fmtScore(score);
  evalDetail.textContent = detail;
}
new ResizeObserver(() => renderFortune()).observe(fortune);

function renderMoves() {
  movesEl.replaceChildren();
  setupEl.textContent = `Setup ${setupName(setup)}, mirrored`;
  setupEl.title = "White's back row from left to right; black's is the mirror image";
  if (!plies.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No moves yet.";
    movesEl.append(li);
  }
  for (let i = 0; i < plies.length; i += 2) {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i / 2 + 1);
    li.append(num);
    for (const p of plies.slice(i, i + 2)) {
      const s = document.createElement("span");
      s.textContent = p.label;
      s.className = "ply " + COLOR_NAME[colorOf(p.move.piece)] + (p === plies.at(-1) ? " last" : "");
      li.append(s);
    }
    movesEl.append(li);
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

function renderSpeed() {
  for (const b of speedBtns) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));
}

function renderControls() {
  const watching = mode === "watch";
  playBtn.hidden = stepBtn.hidden = speedGroup.hidden = !watching;
  undoBtn.hidden = sideGroup.hidden = watching;
  playBtn.querySelector("span")!.textContent = running ? "Pause" : "Play";
  playBtn.setAttribute("aria-pressed", String(!running));
  stepBtn.disabled = running || !!over;
  undoBtn.disabled = undoTo() < 0;
  for (const b of modeBtns) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  for (const b of sideBtns) b.setAttribute("aria-pressed", String((b.dataset.side === "black" ? BLACK : WHITE) === settings.side));
}

function renderAll() {
  renderPlayers();
  renderStatus();
  renderFortune();
  renderMoves();
  renderControls();
}

// ---- controls ----

/** How many plies to keep to take back your last move: before it, it's your turn again. -1 if there's none. */
function undoTo(): number {
  if (mode !== "play") return -1;
  for (let n = plies.length - 1; n >= 0; n--) if (colorOf(plies[n]!.move.piece) === settings.side) return n;
  return -1;
}

function undo() {
  const n = undoTo();
  if (n < 0) return;
  generation++;
  stopListening();
  thinking = null;
  plies = plies.slice(0, n);
  game = n ? plies[n - 1]!.after : newGame(setup);
  over = null;
  lastScore = null;
  view.render(game, plies.at(-1)?.move, false);
  banner.hidden = true;
  renderAll();
  void runGame(generation);
}

/** Turn the board round when you play black, with your row of the panel at the bottom too. */
function flip(flipped: boolean) {
  view.setFlipped(flipped);
  document.querySelector(".bout")!.classList.toggle("flipped", flipped);
}

function setMode(next: Mode) {
  if (next === mode) return;
  mode = next;
  running = true;
  flip(mode === "play" && settings.side === BLACK);
  startGame();
}

for (const b of modeBtns) b.addEventListener("click", () => setMode(b.dataset.mode as Mode));
for (const b of sideBtns) {
  b.addEventListener("click", () => {
    const side = b.dataset.side === "black" ? BLACK : WHITE;
    if (side === settings.side) return;
    settings.side = side;
    store.set("starchess.settings", settings);
    flip(side === BLACK);
    startGame();
  });
}
undoBtn.addEventListener("click", undo);

playBtn.addEventListener("click", () => {
  running = !running;
  renderControls();
  nudge();
});
stepBtn.addEventListener("click", () => {
  stepOnce = true;
  nudge();
});
newBtn.addEventListener("click", () => {
  nudge();
  startGame();
});
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
  if (e.key === "n") newBtn.click();
  else if (mode === "play") {
    if (e.key === "u") undo();
    else if (e.key === "Escape") {
      promoEl.hidden = true;
      if (yourMove) pick(0);
    }
  } else if (e.key === " ") {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === "ArrowRight" && !running) stepBtn.click();
});

flip(mode === "play" && settings.side === BLACK);
renderSpeed();
startGame();

// for the smoke test and poking around in the console
declare global {
  interface Window {
    __sc: { readonly game: GameState; readonly plies: number; readonly over: Outcome | null; readonly yourMoves: Move[] };
  }
}
window.__sc = {
  get game() {
    return game;
  },
  get plies() {
    return plies.length;
  },
  get over() {
    return over;
  },
  get yourMoves() {
    return yourMoves;
  }
};
