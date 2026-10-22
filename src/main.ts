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
  typeOf
} from "./engine/rules";
import { randomSetup } from "./engine/setups";
import { BoardView } from "./ui/board-view";
import { BotClient } from "./ui/bot-client";
import "./ui/style.css";

// ---- settings (remembered per browser; URL params win, for links and the smoke test) ----

const SPEEDS = { slow: 1600, normal: 800, fast: 200 } as const;
type Speed = keyof typeof SPEEDS;

interface Settings {
  white: BotId;
  black: BotId;
  speed: Speed;
  numbers: boolean;
}
interface Result {
  white: BotId;
  black: BotId;
  winner: Color | null;
  reason: Outcome["reason"];
  plies: number;
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
  numbers: false
});
if (isBot(params.get("white"))) settings.white = params.get("white") as BotId;
if (isBot(params.get("black"))) settings.black = params.get("black") as BotId;
if (params.get("speed") && params.get("speed")! in SPEEDS) settings.speed = params.get("speed") as Speed;
let results: Result[] = store.get<{ list: Result[] }>("starchess.results", { list: [] }).list;

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
const evalFill = $("eval-fill");
const evalText = $("eval-text");
const evalDetail = $("eval-detail");
const selects = [$<HTMLSelectElement>("bot-white"), $<HTMLSelectElement>("bot-black")];
const playerRows = [$("p-white"), $("p-black")];
const capturedEls = [$("cap-white"), $("cap-black")];

for (const [i, sel] of selects.entries()) {
  for (const b of BOTS) sel.append(new Option(b.name, b.id));
  sel.value = i === WHITE ? settings.white : settings.black;
  sel.title = botInfo(sel.value as BotId).blurb;
  sel.addEventListener("change", () => {
    settings[i === WHITE ? "white" : "black"] = sel.value as BotId;
    sel.title = botInfo(sel.value as BotId).blurb;
    store.set("starchess.settings", settings);
    renderPlayers();
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
const botFor = (c: Color) => (c === WHITE ? settings.white : settings.black);

function startGame() {
  generation++;
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
    thinking = color;
    renderPlayers();
    const started = performance.now();
    const res = await client.request(game, botFor(color), gameSeed + game.ply * 7919, gameSeed + color);
    if (gen !== generation) return;
    // the opening move waits for the pieces to land
    const pace = Math.max(SPEEDS[settings.speed], game.ply ? 0 : 1200);
    if (!stepping) await sleep(pace - (performance.now() - started));
    if (gen !== generation) return;
    thinking = null;
    if (res.score !== undefined) lastScore = { score: res.score, depth: res.depth, nodes: res.nodes };
    play(res.move);
  }
}

function play(move: Move) {
  const after = applyMove(game, move);
  plies.push({ move, label: moveLabel(move, after), after });
  game = after;
  over = outcome(game, legalMoves(game));
  view.render(game, move);
  renderAll();
  if (over) finish(over);
}

function finish(res: Outcome) {
  results = [{ white: settings.white, black: settings.black, winner: res.winner, reason: res.reason, plies: game.ply }, ...results].slice(0, 50);
  store.set("starchess.results", { list: results });
  renderResults();
  void countdown(generation, res);
}

async function countdown(gen: number, res: Outcome) {
  const who =
    res.winner === null ? "Draw" : `${COLOR_NAME[res.winner][0]!.toUpperCase() + COLOR_NAME[res.winner].slice(1)} (${botInfo(botFor(res.winner)).name}) wins`;
  banner.hidden = false;
  for (let left = 10; gen === generation; ) {
    banner.innerHTML = `<strong>${who}</strong><span>by ${res.reason}</span><small>${
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
    // what this side has taken
    const taken = plies
      .filter((p) => p.move.captured && colorOf(p.move.piece) === c)
      .map((p) => typeOf(p.move.captured))
      .sort((a, b) => b - a);
    capturedEls[c]!.textContent = taken.map((t) => ["", "♟", "♞", "♝", "♜", "♛", "♚"][t] + "︎").join("");
  }
}

function renderStatus() {
  const name = (c: Color) => `${COLOR_NAME[c]} (${botInfo(botFor(c)).name})`;
  if (over) statusEl.textContent = over.winner === null ? `Draw by ${over.reason}.` : `Checkmate: ${name(over.winner)} wins.`;
  else statusEl.textContent = `Move ${Math.floor(game.ply / 2) + 1}: ${name(game.turn)} to play.`;
}

function renderEval() {
  let score: number;
  let detail = "";
  if (lastScore) {
    score = lastScore.score;
    if (lastScore.depth) detail = `depth ${lastScore.depth} · ${Intl.NumberFormat("en", { notation: "compact" }).format(lastScore.nodes ?? 0)} positions`;
  } else {
    score = evaluate(game.cells, WHITE);
    detail = "material & position";
  }
  if (over) score = over.winner === null ? 0 : over.winner === WHITE ? 1e5 : -1e5;
  const mate = Math.abs(score) > 99000;
  const pct = mate ? (score > 0 ? 100 : 0) : 50 + 50 * Math.tanh(score / 700);
  evalFill.style.width = `${pct}%`;
  evalText.textContent = mate ? (score > 0 ? "White mates" : "Black mates") : `${score >= 0 ? "+" : "−"}${(Math.abs(score) / 100).toFixed(1)}`;
  evalDetail.textContent = detail;
}

function renderMoves() {
  movesEl.replaceChildren();
  const head = document.createElement("li");
  head.className = "setup";
  head.textContent = `Setup ${setupName(setup)}, mirrored`;
  head.title = "White's back row from left to right; black's is the mirror image";
  movesEl.append(head);
  for (let i = 0; i < plies.length; i += 2) {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i / 2 + 1);
    li.append(num);
    for (const p of plies.slice(i, i + 2)) {
      const s = document.createElement("span");
      s.textContent = p.label;
      s.className = "ply " + COLOR_NAME[colorOf(p.move.piece)];
      li.append(s);
    }
    movesEl.append(li);
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

function renderResults() {
  const tally = new Map<BotId, { w: number; d: number; l: number }>();
  for (const r of results) {
    for (const c of [WHITE, BLACK] as Color[]) {
      const id = c === WHITE ? r.white : r.black;
      const t = tally.get(id) ?? { w: 0, d: 0, l: 0 };
      if (r.winner === null) t.d++;
      else if (r.winner === c) t.w++;
      else t.l++;
      tally.set(id, t);
    }
  }
  const body = $("tally");
  body.replaceChildren();
  for (const b of BOTS) {
    const t = tally.get(b.id);
    if (!t) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${b.name}</th><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>`;
    body.append(tr);
  }
  $("results").hidden = !results.length;
}

function renderSpeed() {
  for (const b of speedBtns) b.setAttribute("aria-pressed", String(b.dataset.speed === settings.speed));
}

function renderControls() {
  playBtn.textContent = running ? "Pause" : "Play";
  playBtn.setAttribute("aria-pressed", String(!running));
  stepBtn.disabled = running || !!over;
}

function renderAll() {
  renderPlayers();
  renderStatus();
  renderEval();
  renderMoves();
  renderControls();
}

// ---- controls ----

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
  if (e.key === " ") {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === "ArrowRight" && !running) stepBtn.click();
  else if (e.key === "n") newBtn.click();
});

renderSpeed();
renderResults();
startGame();

// for the smoke test and poking around in the console
declare global {
  interface Window {
    __sc: { readonly game: GameState; readonly plies: number; readonly over: Outcome | null };
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
  }
};
