import { AXIAL, NEIGHBORS, SPACE_COUNT } from "./board";
import { Engine, Position, toRulesMove } from "./engine";
import {
  type Color,
  type GameState,
  KING,
  type Move,
  PAWN,
  WHITE,
  colorOf,
  inCheck,
  isAttacked,
  legalMoves,
  legalPlayMoves,
  makeMove,
  other,
  positionKey,
  pseudoMoves,
  typeOf,
  unmakeMove
} from "./rules";

export type BotId = "random" | "magpie" | "classic" | "tactician" | "oracle";

export interface BotInfo {
  id: BotId;
  name: string;
  blurb: string;
  /** thinking time per move, for the searching bots */
  timeMs?: number;
}

export const BOTS: readonly BotInfo[] = [
  { id: "random", name: "Dice", blurb: "Picks any legal move at random." },
  { id: "magpie", name: "Magpie", blurb: "Grabs whatever it can, tries not to hang pieces. One move deep." },
  { id: "classic", name: "Classic", blurb: "The first version's plain alpha-beta search, about a third of a second a move.", timeMs: 300 },
  { id: "tactician", name: "Tactician", blurb: "The tuned engine, about a quarter of a second a move.", timeMs: 250 },
  { id: "oracle", name: "Oracle", blurb: "The tuned engine, about 1.5 seconds a move.", timeMs: 1500 }
];
export const botInfo = (id: BotId) => BOTS.find((b) => b.id === id) ?? BOTS[0]!;

export type Rng = () => number;

/** A small seedable PRNG (mulberry32). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)]!;

export interface BotResult {
  move: Move;
  /** the bot's view of the position, in centipawns for white (searching bots only) */
  score?: number;
  depth?: number;
  nodes?: number;
}

// ---- evaluation ----

/** Piece values in centipawns. Knights are strong on this board, rooks rather weak. */
export const VALUE = [0, 100, 450, 350, 400, 900, 0];
const MATE = 100000;

/** Steps a pawn of each colour still has to walk to reach the far edge. */
const STEPS_TO_EDGE = [0, 3].map((dir) =>
  Array.from({ length: SPACE_COUNT + 1 }, (_, s) => {
    let n = 0;
    for (let t = s ? NEIGHBORS[s]![dir]! : 0; t; t = NEIGHBORS[t]![dir]!) n++;
    return n;
  })
);

/** Distance from the centre space (19). */
const CENTRALITY = Array.from({ length: SPACE_COUNT + 1 }, (_, s) => {
  if (!s) return 0;
  const [q, r] = AXIAL[s]!;
  const [cq, cr] = AXIAL[19]!;
  const dq = q - cq, dr = r - cr;
  const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  return Math.max(0, 3 - dist);
});

/** Per-game quirks: a few points of preference per piece and space, so no two games repeat. */
export function makeStyle(rng: Rng): Int16Array {
  const style = new Int16Array(16 * (SPACE_COUNT + 1));
  for (let i = 0; i < style.length; i++) style[i] = Math.round((rng() - 0.5) * 12);
  return style;
}

/** Static evaluation from `color`'s point of view. */
export function evaluate(cells: number[], color: Color, style?: Int16Array): number {
  let score = 0;
  for (let s = 1; s <= SPACE_COUNT; s++) {
    const p = cells[s]!;
    if (!p) continue;
    const t = typeOf(p);
    const c = colorOf(p);
    let v = VALUE[t]!;
    if (t === PAWN) v += 14 * (4 - STEPS_TO_EDGE[c]![s]!);
    else if (t !== KING) v += 8 * CENTRALITY[s]!;
    else v -= 10 * CENTRALITY[s]!;
    if (style) v += style[p * (SPACE_COUNT + 1) + s]!;
    score += c === color ? v : -v;
  }
  // mobility, roughly
  score += 3 * (pseudoMoves(cells, color).length - pseudoMoves(cells, other(color)).length);
  return score;
}

// ---- searching ----

class Timeout extends Error {}

interface SearchCtx {
  cells: number[];
  deadline: number;
  nodes: number;
  style?: Int16Array;
}

const orderKey = (m: Move) => (m.captured ? 10 * VALUE[typeOf(m.captured)]! - VALUE[typeOf(m.piece)]! / 10 : 0) + (m.promo ? 800 : 0);

function sortMoves(moves: Move[]) {
  return moves.sort((a, b) => orderKey(b) - orderKey(a));
}

function quiesce(ctx: SearchCtx, color: Color, alpha: number, beta: number, qdepth: number): number {
  ctx.nodes++;
  const stand = evaluate(ctx.cells, color, ctx.style);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qdepth <= 0) return stand;
  const captures = sortMoves(pseudoMoves(ctx.cells, color).filter((m) => m.captured || m.promo));
  for (const m of captures) {
    if (typeOf(m.captured) === KING) return MATE;
    makeMove(ctx.cells, m);
    if (inCheck(ctx.cells, color)) {
      unmakeMove(ctx.cells, m);
      continue;
    }
    const score = -quiesce(ctx, other(color), -beta, -alpha, qdepth - 1);
    unmakeMove(ctx.cells, m);
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(ctx: SearchCtx, color: Color, depth: number, ply: number, alpha: number, beta: number): number {
  if ((++ctx.nodes & 1023) === 0 && performance.now() > ctx.deadline) throw new Timeout();
  if (depth <= 0) return quiesce(ctx, color, alpha, beta, 4);
  const moves = sortMoves(legalPlayMoves(ctx.cells, color));
  if (!moves.length) return inCheck(ctx.cells, color) ? -MATE + ply : 0;
  let best = -Infinity;
  for (const m of moves) {
    makeMove(ctx.cells, m);
    const score = -negamax(ctx, other(color), depth - 1, ply + 1, -beta, -alpha);
    unmakeMove(ctx.cells, m);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/** Iterative-deepening alpha-beta, within `timeMs`. Repeating an earlier position counts as a draw. */
export function search(g: GameState, timeMs: number, rng: Rng, style?: Int16Array, maxDepth = 32): BotResult {
  const color = g.turn;
  const ctx: SearchCtx = { cells: g.cells.slice(), deadline: performance.now() + timeMs, nodes: 0, style };
  // shuffle first so equal moves are picked at random, then put the forcing ones up front
  let root = legalPlayMoves(ctx.cells, color, g.limping);
  for (let i = root.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [root[i], root[j]] = [root[j]!, root[i]!];
  }
  root = sortMoves(root);
  const repeats = root.map((m) => {
    makeMove(ctx.cells, m);
    const key = positionKey({ ...g, cells: ctx.cells, turn: other(color) });
    unmakeMove(ctx.cells, m);
    return (g.seen[key] ?? 0) > 0;
  });
  let best: BotResult = { move: root[0]!, score: 0, depth: 0 };
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let alpha = -Infinity;
      let bestIdx = 0;
      for (let i = 0; i < root.length; i++) {
        const m = root[i]!;
        makeMove(ctx.cells, m);
        let score = -negamax(ctx, other(color), depth - 1, 1, -Infinity, -alpha);
        unmakeMove(ctx.cells, m);
        // a repetition is a draw, and nobody winning wants one
        if (repeats[i]) score = Math.min(score, -20);
        if (score > alpha) {
          alpha = score;
          bestIdx = i;
        }
      }
      // search the best move first next time round
      const [top] = root.splice(bestIdx, 1);
      const [rep] = repeats.splice(bestIdx, 1);
      root.unshift(top!);
      repeats.unshift(rep!);
      best = { move: top!, score: color === WHITE ? alpha : -alpha, depth, nodes: ctx.nodes };
      if (Math.abs(alpha) > MATE - 100) break; // found a mate either way
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // restore the board: unwinding through the throw skipped the unmakes
      ctx.cells = g.cells.slice();
      break;
    }
  }
  best.nodes = ctx.nodes;
  return best;
}

// ---- the bots ----

/** One move deep: take the most valuable thing, don't leave the moved piece hanging. */
function magpie(g: GameState, moves: Move[], rng: Rng): Move {
  const cells = g.cells.slice();
  const them = other(g.turn);
  let best: Move[] = [];
  let bestScore = -Infinity;
  for (const m of moves) {
    let score = VALUE[typeOf(m.captured)]! + (m.promo ? VALUE[typeOf(m.promo)]! - VALUE[PAWN]! : 0);
    makeMove(cells, m);
    const moved = typeOf(m.promo || m.piece);
    if (isAttacked(cells, m.to, them)) score -= moved === KING ? 0 : VALUE[moved]!;
    if (inCheck(cells, them)) score += legalPlayMoves(cells, them).length ? 30 : MATE;
    unmakeMove(cells, m);
    if (isAttacked(cells, m.from, them)) score += VALUE[typeOf(m.piece)]! / 2;
    score += rng() * 20;
    if (score > bestScore) {
      bestScore = score;
      best = [m];
    } else if (score === bestScore) best.push(m);
  }
  return pick(best, rng);
}

const engines = new Map<BotId, Engine>();

/** Pick `bot`'s move in `g`, which must not be over. `seed` gives each game its own flavour. */
export function chooseMove(g: GameState, bot: BotId, rng: Rng, seed = 0): BotResult {
  const moves = legalMoves(g);
  if (!moves.length) throw new Error("no legal moves");
  const info = botInfo(bot);
  switch (bot) {
    case "random":
      return { move: pick(moves, rng) };
    case "magpie":
      return { move: magpie(g, moves, rng) };
    case "classic":
      return search(g, info.timeMs!, rng, makeStyle(makeRng(seed)));
    default: {
      let engine = engines.get(bot);
      if (!engine) engines.set(bot, (engine = new Engine(undefined, { noise: 6 })));
      engine.opts.seed = seed;
      const r = engine.run(Position.fromGame(g), { timeMs: info.timeMs });
      return { move: toRulesMove(g, r.move), score: g.turn === WHITE ? r.score : -r.score, depth: r.depth, nodes: r.nodes };
    }
  }
}
