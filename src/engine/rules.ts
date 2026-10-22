import { KNIGHT_TURNS, MIRROR_V, N, NE, NEIGHBORS, NW, S, SE, SPACE_COUNT, SW } from "./board";

/**
 * Starchess rules, ported from the original Ruby engine (lib/starchess):
 *
 * - Each side has five pawns, and a king, queen, rook, bishop and knight on
 *   its five back spaces. The original let players arrange those; here each
 *   game draws one arrangement for white and black gets its mirror image.
 * - Pawns step forward (white north, black south), may step twice from their
 *   starting space, and capture one space diagonally forward. A pawn reaching
 *   the enemy's back spaces promotes.
 * - Bishops slide along the four diagonal directions, queens along all six.
 * - Rooks slide north/south, and may also take a single non-capturing step
 *   diagonally.
 * - Knights jump two-then-one along neighbouring directions.
 * - Kings step one space. Checkmate wins; stalemate is a draw.
 *
 * Pieces are small integers: type | color << 3, so a board is a plain array.
 */

export type Color = 0 | 1;
export const WHITE: Color = 0;
export const BLACK: Color = 1;
export const other = (c: Color): Color => (c ^ 1) as Color;
export const COLOR_NAME = ["white", "black"] as const;

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;
export const PIECE_NAME = ["", "pawn", "knight", "bishop", "rook", "queen", "king"] as const;
export const PIECE_LETTER = ["", "", "N", "B", "R", "Q", "K"] as const;

export const piece = (type: PieceType, color: Color) => type | (color << 3);
export const typeOf = (p: number) => (p & 7) as PieceType;
export const colorOf = (p: number) => (p >> 3) as Color;

export const PAWN_SPACES: readonly (readonly number[])[] = [
  [5, 12, 18, 23, 29],
  [9, 15, 20, 26, 33]
];
/** Each side's back spaces: where its pieces start, and where enemy pawns promote. Black's mirror white's. */
export const BACK_SPACES: readonly (readonly number[])[] = [
  [4, 11, 17, 22, 28],
  [10, 16, 21, 27, 34]
];
/** A setup: the piece on each of white's back spaces, in BACK_SPACES order. */
export type Setup = readonly PieceType[];
export const CLASSIC_SETUP: Setup = [KING, QUEEN, ROOK, BISHOP, KNIGHT];
/** All 120 arrangements. */
export const ALL_SETUPS: readonly Setup[] = (function permute(rest: PieceType[]): PieceType[][] {
  if (rest.length <= 1) return [rest];
  return rest.flatMap((t, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)]).map((p) => [t, ...p]));
})([...CLASSIC_SETUP]);
export const setupName = (s: Setup) => s.map((t) => PIECE_LETTER[t]).join("");
export const parseSetup = (name: string): Setup => [...name].map((l) => PIECE_LETTER.indexOf(l as "K") as PieceType);
export const PROMOTIONS: readonly PieceType[] = [QUEEN, KNIGHT, ROOK, BISHOP];

const PAWN_FORWARD = [N, S];
const PAWN_CAPTURES = [
  [NW, NE],
  [SW, SE]
];
const BISHOP_DIRS = [NW, SW, SE, NE];
const ROOK_DIRS = [N, S];
const ALL_DIRS = [0, 1, 2, 3, 4, 5];
const IS_PAWN_START = PAWN_SPACES.map((spaces) => {
  const set = new Array<boolean>(SPACE_COUNT + 1).fill(false);
  for (const s of spaces) set[s] = true;
  return set;
});
/** IS_PROMOTION[color][space]: a pawn of `color` arriving here promotes. */
const IS_PROMOTION = [BACK_SPACES[1]!, BACK_SPACES[0]!].map((spaces) => {
  const set = new Array<boolean>(SPACE_COUNT + 1).fill(false);
  for (const s of spaces) set[s] = true;
  return set;
});

/** Every space a knight on `from` can jump to, regardless of what's there. */
export const KNIGHT_TARGETS: readonly (readonly number[])[] = Array.from({ length: SPACE_COUNT + 1 }, (_, from) => {
  if (!from) return [];
  const out = new Set<number>();
  const step = (s: number, d: number) => (s ? NEIGHBORS[s]![d]! : 0);
  for (let d = 0; d < 6; d++) {
    for (const turn of KNIGHT_TURNS[d]!) {
      // two along, one over
      const a = step(step(step(from, d), d), turn);
      if (a) out.add(a);
      // one along, two over
      const b = step(step(step(from, d), turn), turn);
      if (b) out.add(b);
    }
  }
  return [...out].sort((x, y) => x - y);
});

export interface Move {
  from: number;
  to: number;
  /** the piece that moves */
  piece: number;
  /** the piece taken, or 0 */
  captured: number;
  /** what a promoting pawn becomes, or 0 */
  promo: number;
}

export interface GameState {
  /** cells[space]: a piece or 0. Index 0 is unused. */
  cells: number[];
  turn: Color;
  ply: number;
  /** plies since the last capture or pawn move */
  quiet: number;
  /** position keys since the last irreversible move, for repetition */
  seen: Record<string, number>;
}

export interface Outcome {
  winner: Color | null;
  reason: "checkmate" | "stalemate" | "repetition" | "quiet moves" | "move limit" | "bare kings";
}

export const QUIET_LIMIT = 100;
export const PLY_LIMIT = 400;

/** A new game from `setup`: white's pieces on its back spaces, black's on the mirror spaces. */
export function newGame(setup: Setup = CLASSIC_SETUP): GameState {
  const cells = new Array<number>(SPACE_COUNT + 1).fill(0);
  for (const c of [WHITE, BLACK]) for (const s of PAWN_SPACES[c]!) cells[s] = piece(PAWN, c);
  BACK_SPACES[WHITE]!.forEach((s, i) => {
    cells[s] = piece(setup[i]!, WHITE);
    cells[MIRROR_V[s]!] = piece(setup[i]!, BLACK);
  });
  const g: GameState = { cells, turn: WHITE, ply: 0, quiet: 0, seen: {} };
  g.seen[positionKey(g)] = 1;
  return g;
}

/** An arbitrary position, for tests and puzzles: `{ 4: "wK", 27: "bQ" }`. */
export function position(pieces: Record<number, string>, turn: Color = WHITE): GameState {
  const cells = new Array<number>(SPACE_COUNT + 1).fill(0);
  for (const [s, code] of Object.entries(pieces)) {
    const c: Color = code[0] === "w" ? WHITE : BLACK;
    const t = PIECE_LETTER.indexOf(code.slice(1) as "K");
    cells[+s] = piece((t > 0 ? t : PAWN) as PieceType, c);
  }
  const g: GameState = { cells, turn, ply: 0, quiet: 0, seen: {} };
  g.seen[positionKey(g)] = 1;
  return g;
}

export const positionKey = (g: Pick<GameState, "turn" | "cells">) => g.turn + ":" + g.cells.join(",");

// ---- move generation (on bare cell arrays, so the search can use it too) ----

function slide(cells: number[], from: number, dirs: readonly number[], color: Color, p: number, out: Move[]) {
  for (const d of dirs) {
    let s = NEIGHBORS[from]![d]!;
    while (s) {
      const t = cells[s]!;
      if (!t) out.push({ from, to: s, piece: p, captured: 0, promo: 0 });
      else {
        if (colorOf(t) !== color) out.push({ from, to: s, piece: p, captured: t, promo: 0 });
        break;
      }
      s = NEIGHBORS[s]![d]!;
    }
  }
}

function pushPawn(from: number, to: number, p: number, captured: number, color: Color, out: Move[]) {
  if (IS_PROMOTION[color]![to]) {
    for (const t of PROMOTIONS) out.push({ from, to, piece: p, captured, promo: piece(t, color) });
  } else out.push({ from, to, piece: p, captured, promo: 0 });
}

/** Moves that obey each piece's pattern, ignoring whether they leave the king in check. */
export function pseudoMoves(cells: number[], color: Color, out: Move[] = []): Move[] {
  for (let from = 1; from <= SPACE_COUNT; from++) {
    const p = cells[from]!;
    if (!p || colorOf(p) !== color) continue;
    const nb = NEIGHBORS[from]!;
    switch (typeOf(p)) {
      case PAWN: {
        const fwd = nb[PAWN_FORWARD[color]!]!;
        if (fwd && !cells[fwd]) {
          pushPawn(from, fwd, p, 0, color, out);
          const two = NEIGHBORS[fwd]![PAWN_FORWARD[color]!]!;
          if (IS_PAWN_START[color]![from] && two && !cells[two]) pushPawn(from, two, p, 0, color, out);
        }
        for (const d of PAWN_CAPTURES[color]!) {
          const s = nb[d]!;
          const t = s ? cells[s]! : 0;
          if (t && colorOf(t) !== color) pushPawn(from, s, p, t, color, out);
        }
        break;
      }
      case KNIGHT:
        for (const s of KNIGHT_TARGETS[from]!) {
          const t = cells[s]!;
          if (!t || colorOf(t) !== color) out.push({ from, to: s, piece: p, captured: t, promo: 0 });
        }
        break;
      case BISHOP:
        slide(cells, from, BISHOP_DIRS, color, p, out);
        break;
      case ROOK:
        slide(cells, from, ROOK_DIRS, color, p, out);
        for (const d of BISHOP_DIRS) {
          const s = nb[d]!;
          if (s && !cells[s]) out.push({ from, to: s, piece: p, captured: 0, promo: 0 });
        }
        break;
      case QUEEN:
        slide(cells, from, ALL_DIRS, color, p, out);
        break;
      case KING:
        for (const s of nb) {
          if (!s) continue;
          const t = cells[s]!;
          if (!t || colorOf(t) !== color) out.push({ from, to: s, piece: p, captured: t, promo: 0 });
        }
        break;
    }
  }
  return out;
}

function slideHits(cells: number[], from: number, dirs: readonly number[], target: number): boolean {
  for (const d of dirs) {
    let s = NEIGHBORS[from]![d]!;
    while (s) {
      if (s === target) return true;
      if (cells[s]) break;
      s = NEIGHBORS[s]![d]!;
    }
  }
  return false;
}

/** Could a piece of `by` capture on `target` right now? */
export function isAttacked(cells: number[], target: number, by: Color): boolean {
  for (let from = 1; from <= SPACE_COUNT; from++) {
    const p = cells[from]!;
    if (!p || colorOf(p) !== by) continue;
    const nb = NEIGHBORS[from]!;
    switch (typeOf(p)) {
      case PAWN:
        if (nb[PAWN_CAPTURES[by]![0]!] === target || nb[PAWN_CAPTURES[by]![1]!] === target) return true;
        break;
      case KNIGHT:
        if (KNIGHT_TARGETS[from]!.includes(target)) return true;
        break;
      case BISHOP:
        if (slideHits(cells, from, BISHOP_DIRS, target)) return true;
        break;
      case ROOK:
        if (slideHits(cells, from, ROOK_DIRS, target)) return true;
        break;
      case QUEEN:
        if (slideHits(cells, from, ALL_DIRS, target)) return true;
        break;
      case KING:
        if (nb.includes(target)) return true;
        break;
    }
  }
  return false;
}

export function kingSpace(cells: number[], color: Color): number {
  const k = piece(KING, color);
  for (let s = 1; s <= SPACE_COUNT; s++) if (cells[s] === k) return s;
  return 0;
}

export function inCheck(cells: number[], color: Color): boolean {
  const k = kingSpace(cells, color);
  return k ? isAttacked(cells, k, other(color)) : false;
}

export function makeMove(cells: number[], m: Move) {
  cells[m.from] = 0;
  cells[m.to] = m.promo || m.piece;
}

export function unmakeMove(cells: number[], m: Move) {
  cells[m.to] = m.captured;
  cells[m.from] = m.piece;
}

/** Moves for `color` that don't leave its own king attacked. */
export function legalPlayMoves(cells: number[], color: Color): Move[] {
  const out: Move[] = [];
  for (const m of pseudoMoves(cells, color)) {
    makeMove(cells, m);
    if (!inCheck(cells, color)) out.push(m);
    unmakeMove(cells, m);
  }
  return out;
}

export function legalMoves(g: GameState): Move[] {
  return legalPlayMoves(g.cells, g.turn);
}

/** The state after `m`, which must be legal. The input is left untouched. */
export function applyMove(g: GameState, m: Move): GameState {
  const cells = g.cells.slice();
  makeMove(cells, m);
  const irreversible = !!m.captured || typeOf(m.piece) === PAWN;
  const next: GameState = {
    cells,
    turn: other(g.turn),
    ply: g.ply + 1,
    quiet: irreversible ? 0 : g.quiet + 1,
    seen: irreversible ? {} : { ...g.seen }
  };
  const key = positionKey(next);
  next.seen[key] = (next.seen[key] ?? 0) + 1;
  return next;
}

/** How the game has ended, or null while it's still going. */
export function outcome(g: GameState, moves: Move[] = legalMoves(g)): Outcome | null {
  if (!moves.length) {
    return inCheck(g.cells, g.turn)
      ? { winner: other(g.turn), reason: "checkmate" }
      : { winner: null, reason: "stalemate" };
  }
  if ((g.seen[positionKey(g)] ?? 0) >= 3) return { winner: null, reason: "repetition" };
  if (g.quiet >= QUIET_LIMIT) return { winner: null, reason: "quiet moves" };
  if (g.ply >= PLY_LIMIT) return { winner: null, reason: "move limit" };
  if (g.cells.every((p) => !p || typeOf(p) === KING)) return { winner: null, reason: "bare kings" };
  return null;
}

/** Short notation, e.g. "Q27x19+", "18-21=N". */
export function moveLabel(m: Move, after?: GameState): string {
  const letter = PIECE_LETTER[typeOf(m.piece)];
  let s = `${letter}${m.from}${m.captured ? "x" : "-"}${m.to}`;
  if (m.promo) s += "=" + PIECE_LETTER[typeOf(m.promo)];
  if (after && inCheck(after.cells, after.turn)) {
    s += legalMoves(after).length ? "+" : "#";
  }
  return s;
}

export const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.to === b.to && a.promo === b.promo && a.piece === b.piece;
