import { NEIGHBORS } from "./board";
import { NSQ, type Weights, evaluate } from "./eval";
import { BACK_SPACES, type GameState, KNIGHT_TARGETS, type Move, PAWN_SPACES, legalMoves } from "./rules";
import { DEFAULT_WEIGHTS } from "./weights";

/**
 * The searching engine: integer moves, make/unmake on a typed array, a
 * transposition table, PVS with null-move pruning, late-move reductions,
 * futility pruning, check extensions, killers, history and quiescence.
 *
 * A move is from | to << 6 | promo << 12 (promo is a piece type, 0 if none).
 */

const NB = Int8Array.from(NEIGHBORS.flat());
const KN = KNIGHT_TARGETS.map((ts) => Int8Array.from(ts));
const OPP = [3, 4, 5, 0, 1, 2];
const PAWN_FWD = [0, 3];
const PAWN_CAP = [
  [1, 5],
  [2, 4]
];
const DIAG = [1, 2, 4, 5];
const IS_DIAG = [false, true, true, false, true, true];
const ROOK_DIRS = [0, 3];
const ALL = [0, 1, 2, 3, 4, 5];
const PROMO_TYPES = [5, 2, 4, 3];
const IS_START = PAWN_SPACES.map((ss) => Uint8Array.from({ length: NSQ }, (_, s) => (ss.includes(s) ? 1 : 0)));
const IS_PROMO = [BACK_SPACES[1]!, BACK_SPACES[0]!].map((ss) => Uint8Array.from({ length: NSQ }, (_, s) => (ss.includes(s) ? 1 : 0)));
/** rough piece values, for move ordering and pruning margins */
const SEE_VAL = [0, 100, 450, 350, 400, 900, 20000];

export const MATE = 30000;
const MATE_BOUND = MATE - 1000;
const INF = 32000;
const MAX_PLY = 96;
const MAX_MOVES = 256;

export const moveFrom = (m: number) => m & 63;
export const moveTo = (m: number) => (m >> 6) & 63;
export const movePromo = (m: number) => (m >> 12) & 7;
const encode = (from: number, to: number, promo = 0) => from | (to << 6) | (promo << 12);

// ---- hashing ----

const zrng = (() => {
  let a = 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
})();
const Z_LO = Int32Array.from({ length: 16 * NSQ }, zrng);
const Z_HI = Int32Array.from({ length: 16 * NSQ }, zrng);
const Z_SIDE_LO = zrng(), Z_SIDE_HI = zrng();

// ---- position ----

export class Position {
  cells = new Int8Array(NSQ);
  side = 0;
  king = [0, 0];
  lo = 0;
  hi = 0;
  /** hashes of every position so far (game + search path), for repetition */
  private histLo = new Int32Array(1024);
  private histHi = new Int32Array(1024);
  /** reversible plies leading to each position */
  private histQuiet = new Int32Array(1024);
  sp = 0;
  private undoCap = new Int8Array(1024);

  static fromGame(g: GameState): Position {
    const pos = new Position();
    // earlier positions since the last irreversible move, for repetition
    const earlier = Object.entries(g.seen).filter(([k]) => k !== `${g.turn}:${g.cells.join(",")}`);
    for (const [key] of earlier) {
      const [turn, cells] = key.split(":");
      pos.load(cells!.split(",").map(Number), Number(turn));
      pos.histLo[pos.sp] = pos.lo;
      pos.histHi[pos.sp] = pos.hi;
      pos.histQuiet[pos.sp] = pos.sp;
      pos.sp++;
    }
    pos.load(g.cells, g.turn);
    pos.histLo[pos.sp] = pos.lo;
    pos.histHi[pos.sp] = pos.hi;
    pos.histQuiet[pos.sp] = pos.sp;
    return pos;
  }

  /** A position with no history, from a cells array (index 0 unused). */
  static fromCells(cells: ArrayLike<number>, side: number): Position {
    const pos = new Position();
    pos.load(cells, side);
    pos.histLo[0] = pos.lo;
    pos.histHi[0] = pos.hi;
    return pos;
  }

  private load(cells: ArrayLike<number>, side: number) {
    this.lo = this.hi = 0;
    for (let s = 1; s < NSQ; s++) {
      const p = cells[s]!;
      this.cells[s] = p;
      if (p) {
        this.lo ^= Z_LO[p * NSQ + s]!;
        this.hi ^= Z_HI[p * NSQ + s]!;
        if ((p & 7) === 6) this.king[p >> 3] = s;
      }
    }
    this.side = side;
    if (side) {
      this.lo ^= Z_SIDE_LO;
      this.hi ^= Z_SIDE_HI;
    }
  }

  make(m: number) {
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7;
    const c = this.cells, p = c[from]!, cap = c[to]!;
    this.undoCap[this.sp] = cap;
    let lo = this.lo ^ Z_LO[p * NSQ + from]! ^ Z_SIDE_LO, hi = this.hi ^ Z_HI[p * NSQ + from]! ^ Z_SIDE_HI;
    if (cap) {
      lo ^= Z_LO[cap * NSQ + to]!;
      hi ^= Z_HI[cap * NSQ + to]!;
    }
    const np = promo ? promo | (p & 8) : p;
    lo ^= Z_LO[np * NSQ + to]!;
    hi ^= Z_HI[np * NSQ + to]!;
    c[from] = 0;
    c[to] = np;
    if ((p & 7) === 6) this.king[p >> 3] = to;
    this.side ^= 1;
    this.lo = lo;
    this.hi = hi;
    const sp = ++this.sp;
    this.histLo[sp] = lo;
    this.histHi[sp] = hi;
    this.histQuiet[sp] = cap || (p & 7) === 1 ? 0 : this.histQuiet[sp - 1]! + 1;
  }

  unmake(m: number) {
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7;
    const sp = --this.sp;
    const c = this.cells;
    let p = c[to]!;
    if (promo) p = 1 | (p & 8);
    c[from] = p;
    c[to] = this.undoCap[sp]!;
    if ((p & 7) === 6) this.king[p >> 3] = from;
    this.side ^= 1;
    this.lo = this.histLo[sp]!;
    this.hi = this.histHi[sp]!;
  }

  makeNull() {
    this.side ^= 1;
    this.lo ^= Z_SIDE_LO;
    this.hi ^= Z_SIDE_HI;
    const sp = ++this.sp;
    this.histLo[sp] = this.lo;
    this.histHi[sp] = this.hi;
    this.histQuiet[sp] = 0;
  }

  unmakeNull() {
    const sp = --this.sp;
    this.side ^= 1;
    this.lo = this.histLo[sp]!;
    this.hi = this.histHi[sp]!;
  }

  /** Has this position occurred before (same side to move)? */
  isRepeat(): boolean {
    const q = this.histQuiet[this.sp]!;
    for (let i = this.sp - 2; i >= this.sp - q; i -= 2) {
      if (this.histLo[i] === this.lo && this.histHi[i] === this.hi) return true;
    }
    return false;
  }

  quietPlies() {
    return this.histQuiet[this.sp]!;
  }

  attacked(sq: number, by: number): boolean {
    const c = this.cells;
    const pawn = 1 | (by << 3);
    for (const d of PAWN_CAP[by]!) {
      const n = NB[sq * 6 + OPP[d]!]!;
      if (n && c[n] === pawn) return true;
    }
    const knight = 2 | (by << 3);
    for (const n of KN[sq]!) if (c[n] === knight) return true;
    const king = 6 | (by << 3);
    for (let d = 0; d < 6; d++) {
      let n = NB[sq * 6 + d]!;
      if (!n) continue;
      if (c[n] === king) return true;
      while (n) {
        const p = c[n]!;
        if (p) {
          if (p >> 3 === by) {
            const t = p & 7;
            if (t === 5 || (t === 3 && IS_DIAG[d]) || (t === 4 && (d === 0 || d === 3))) return true;
          }
          break;
        }
        n = NB[n * 6 + d]!;
      }
    }
    return false;
  }

  inCheck(side = this.side) {
    return this.attacked(this.king[side]!, side ^ 1);
  }

  hasPieces(side: number) {
    for (let s = 1; s < NSQ; s++) {
      const p = this.cells[s]!;
      if (p && p >> 3 === side && (p & 7) !== 1 && (p & 7) !== 6) return true;
    }
    return false;
  }

  /** Pseudo-legal moves into `out` from `start`; returns the new end. */
  gen(out: Int32Array, start: number, capturesOnly: boolean): number {
    const c = this.cells, side = this.side;
    let n = start;
    for (let s = 1; s < NSQ; s++) {
      const p = c[s]!;
      if (!p || p >> 3 !== side) continue;
      const t = p & 7;
      if (t === 1) {
        const f = NB[s * 6 + PAWN_FWD[side]!]!;
        if (f && !c[f]) {
          if (IS_PROMO[side]![f]) for (const pt of PROMO_TYPES) out[n++] = encode(s, f, pt);
          else if (!capturesOnly) {
            out[n++] = encode(s, f);
            const f2 = NB[f * 6 + PAWN_FWD[side]!]!;
            if (IS_START[side]![s] && f2 && !c[f2]) {
              if (IS_PROMO[side]![f2]) for (const pt of PROMO_TYPES) out[n++] = encode(s, f2, pt);
              else out[n++] = encode(s, f2);
            }
          }
        }
        for (const d of PAWN_CAP[side]!) {
          const to = NB[s * 6 + d]!;
          const q = to ? c[to]! : 0;
          if (q && q >> 3 !== side) {
            if (IS_PROMO[side]![to]) for (const pt of PROMO_TYPES) out[n++] = encode(s, to, pt);
            else out[n++] = encode(s, to);
          }
        }
      } else if (t === 2) {
        for (const to of KN[s]!) {
          const q = c[to]!;
          if (q ? q >> 3 !== side : !capturesOnly) out[n++] = encode(s, to);
        }
      } else if (t === 6) {
        for (let d = 0; d < 6; d++) {
          const to = NB[s * 6 + d]!;
          if (!to) continue;
          const q = c[to]!;
          if (q ? q >> 3 !== side : !capturesOnly) out[n++] = encode(s, to);
        }
      } else {
        const dirs = t === 3 ? DIAG : t === 4 ? ROOK_DIRS : ALL;
        for (const d of dirs) {
          let to = NB[s * 6 + d]!;
          while (to) {
            const q = c[to]!;
            if (q) {
              if (q >> 3 !== side) out[n++] = encode(s, to);
              break;
            }
            if (!capturesOnly) out[n++] = encode(s, to);
            to = NB[to * 6 + d]!;
          }
        }
        if (t === 4 && !capturesOnly) {
          for (const d of DIAG) {
            const to = NB[s * 6 + d]!;
            if (to && !c[to]) out[n++] = encode(s, to);
          }
        }
      }
    }
    return n;
  }

  /** Is pseudo-legal `m` legal? (Doesn't leave the mover's king attacked.) */
  legal(m: number): boolean {
    this.make(m);
    const ok = !this.attacked(this.king[this.side ^ 1]!, this.side);
    this.unmake(m);
    return ok;
  }
}

// ---- search ----

export interface SearchOptions {
  /** transposition table size, log2 entries */
  ttBits: number;
  nullMove: boolean;
  nullBase: number;
  nullDiv: number;
  lmr: boolean;
  lmrBase: number;
  lmrDiv: number;
  lmrMinMoves: number;
  futility: boolean;
  futilityMargin: number;
  rfpMargin: number;
  deltaMargin: number;
  checkExt: boolean;
  aspiration: number;
  /** draw score for the side to move (negative: avoid draws) */
  contempt: number;
  /** pseudo-random eval jitter in centipawns, keyed by position and seed, for variety */
  noise: number;
  seed: number;
}

export const DEFAULT_OPTIONS: SearchOptions = {
  ttBits: 20,
  nullMove: true,
  nullBase: 2,
  nullDiv: 6,
  lmr: true,
  lmrBase: 0.5,
  lmrDiv: 2.5,
  lmrMinMoves: 3,
  futility: true,
  futilityMargin: 120,
  rfpMargin: 90,
  deltaMargin: 200,
  checkExt: true,
  aspiration: 40,
  contempt: 0,
  noise: 0,
  seed: 0
};

export interface Limits {
  nodes?: number;
  timeMs?: number;
  depth?: number;
}

export interface SearchResult {
  move: number;
  /** for the side to move */
  score: number;
  depth: number;
  nodes: number;
  pv: number[];
  timeMs: number;
}

class Stop extends Error {}

const EXACT = 1, LOWER = 2, UPPER = 3;

export class Engine {
  readonly opts: SearchOptions;
  readonly weights: Weights;
  private ttMask: number;
  private ttKey: Int32Array;
  private ttMove: Int32Array;
  private ttScore: Int16Array;
  private ttDepth: Int8Array;
  private ttFlag: Uint8Array;
  private moves = new Int32Array(MAX_PLY * MAX_MOVES);
  private scores = new Int32Array(MAX_PLY * MAX_MOVES);
  private killers = new Int32Array(MAX_PLY * 2);
  private history = new Int32Array(16 * NSQ);
  private lmrTable: Uint8Array;
  private pos!: Position;
  private nodes = 0;
  private nodeLimit = Infinity;
  private deadline = Infinity;
  private pvTable = new Int32Array(MAX_PLY * MAX_PLY);
  private pvLen = new Int32Array(MAX_PLY);

  constructor(weights: Weights = DEFAULT_WEIGHTS, opts: Partial<SearchOptions> = {}) {
    this.weights = weights;
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    const size = 1 << this.opts.ttBits;
    this.ttMask = size - 1;
    this.ttKey = new Int32Array(size);
    this.ttMove = new Int32Array(size);
    this.ttScore = new Int16Array(size);
    this.ttDepth = new Int8Array(size);
    this.ttFlag = new Uint8Array(size);
    this.lmrTable = new Uint8Array(64 * 64);
    for (let d = 1; d < 64; d++)
      for (let i = 1; i < 64; i++)
        this.lmrTable[d * 64 + i] = Math.max(0, Math.floor(this.opts.lmrBase + (Math.log(d) * Math.log(i)) / this.opts.lmrDiv));
  }

  newGame() {
    this.ttFlag.fill(0);
    this.history.fill(0);
  }

  private eval(): number {
    const p = this.pos;
    let e = evaluate(p.cells, p.side, this.weights);
    if (this.opts.noise) {
      const h = Math.imul(p.lo ^ this.opts.seed, 0x9e3779b1) >>> 0;
      e += Math.round(((h / 4294967296) * 2 - 1) * this.opts.noise);
    }
    return e;
  }

  private checkLimits() {
    if (this.nodes >= this.nodeLimit) throw new Stop();
    if ((this.nodes & 1023) === 0 && this.deadline !== Infinity && performance.now() > this.deadline) throw new Stop();
  }

  /** Order moves[start..end): TT move, captures by MVV-LVA, promotions, killers, history. */
  private score(start: number, end: number, ply: number, ttMove: number) {
    const c = this.pos.cells;
    const k0 = this.killers[ply * 2]!, k1 = this.killers[ply * 2 + 1]!;
    for (let i = start; i < end; i++) {
      const m = this.moves[i]!;
      let s: number;
      if (m === ttMove) s = 1 << 30;
      else {
        const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7;
        const cap = c[to]!;
        if (cap || promo) {
          s = (1 << 28) + SEE_VAL[cap & 7]! * 16 - SEE_VAL[c[from]! & 7]! / 16 + (promo ? SEE_VAL[promo]! : 0);
          // a capture of a lesser piece onto a defended space goes after the killers
          if (cap && SEE_VAL[cap & 7]! < SEE_VAL[c[from]! & 7]! && this.pos.attacked(to, this.pos.side ^ 1)) s -= 1 << 27;
          if (promo && promo !== 5) s -= 1 << 27;
        } else if (m === k0) s = (1 << 27) + 2;
        else if (m === k1) s = (1 << 27) + 1;
        else s = this.history[c[from]! * NSQ + to]!;
      }
      this.scores[i] = s;
    }
  }

  private pickNext(i: number, end: number) {
    let best = i;
    for (let j = i + 1; j < end; j++) if (this.scores[j]! > this.scores[best]!) best = j;
    if (best !== i) {
      const m = this.moves[i]!, s = this.scores[i]!;
      this.moves[i] = this.moves[best]!;
      this.scores[i] = this.scores[best]!;
      this.moves[best] = m;
      this.scores[best] = s;
    }
    return this.moves[i]!;
  }

  private quiesce(alpha: number, beta: number, ply: number): number {
    this.nodes++;
    this.checkLimits();
    this.pvLen[ply] = 0;
    const pos = this.pos;
    if (ply >= MAX_PLY - 1) return this.eval();
    const inCheck = pos.inCheck();
    let best = -INF;
    if (!inCheck) {
      best = this.eval();
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }
    const start = ply * MAX_MOVES;
    const end = pos.gen(this.moves, start, !inCheck);
    this.score(start, end, ply, 0);
    let legal = 0;
    for (let i = start; i < end; i++) {
      const m = this.pickNext(i, end);
      if (!inCheck) {
        const cap = pos.cells[(m >> 6) & 63]! & 7;
        const promo = (m >> 12) & 7;
        if (promo && promo !== 5) continue;
        if (!promo && best + SEE_VAL[cap]! + this.opts.deltaMargin <= alpha) continue;
      }
      pos.make(m);
      if (pos.attacked(pos.king[pos.side ^ 1]!, pos.side)) {
        pos.unmake(m);
        continue;
      }
      legal++;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      pos.unmake(m);
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) break;
        }
      }
    }
    if (inCheck && !legal) return -MATE + ply;
    return best;
  }

  private search(depth: number, alpha: number, beta: number, ply: number, allowNull: boolean): number {
    const pos = this.pos;
    const opts = this.opts;
    this.pvLen[ply] = 0;
    if (ply > 0) {
      if (pos.isRepeat() || pos.quietPlies() >= 100) return -opts.contempt;
      // mate distance pruning
      alpha = Math.max(alpha, -MATE + ply);
      beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }
    const inCheck = pos.inCheck();
    if (inCheck && opts.checkExt && ply < MAX_PLY / 2) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    this.nodes++;
    this.checkLimits();
    if (ply >= MAX_PLY - 2) return this.eval();

    const pvNode = beta - alpha > 1;
    // transposition table
    const idx = pos.lo & this.ttMask;
    let ttMove = 0;
    if (this.ttFlag[idx] && this.ttKey[idx] === pos.hi) {
      ttMove = this.ttMove[idx]!;
      if (!pvNode && ply > 0 && this.ttDepth[idx]! >= depth) {
        let s = this.ttScore[idx]!;
        if (s > MATE_BOUND) s -= ply;
        else if (s < -MATE_BOUND) s += ply;
        const f = this.ttFlag[idx];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }

    const staticEval = inCheck ? -INF : this.eval();
    if (!pvNode && !inCheck) {
      // reverse futility: far enough above beta that a shallow search won't come back down
      if (depth <= 3 && staticEval - opts.rfpMargin * depth >= beta && Math.abs(beta) < MATE_BOUND) return staticEval;
      // null move
      if (opts.nullMove && allowNull && depth >= 3 && staticEval >= beta && pos.hasPieces(pos.side)) {
        const r = opts.nullBase + Math.floor(depth / opts.nullDiv);
        pos.makeNull();
        const s = -this.search(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
        pos.unmakeNull();
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    const start = ply * MAX_MOVES;
    const end = pos.gen(this.moves, start, false);
    this.score(start, end, ply, ttMove);
    const futile = opts.futility && !pvNode && !inCheck && depth <= 2 && staticEval + opts.futilityMargin * depth <= alpha;
    let best = -INF, bestMove = 0, legal = 0;
    const origAlpha = alpha;
    for (let i = start; i < end; i++) {
      const m = this.pickNext(i, end);
      const to = (m >> 6) & 63;
      const isQuiet = !pos.cells[to] && !((m >> 12) & 7);
      pos.make(m);
      if (pos.attacked(pos.king[pos.side ^ 1]!, pos.side)) {
        pos.unmake(m);
        continue;
      }
      legal++;
      const givesCheck = pos.inCheck();
      if (futile && isQuiet && legal > 1 && !givesCheck) {
        pos.unmake(m);
        continue;
      }
      let score: number;
      if (legal === 1) score = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        let r = 0;
        if (opts.lmr && depth >= 3 && isQuiet && !inCheck && !givesCheck && legal > opts.lmrMinMoves) {
          r = this.lmrTable[Math.min(depth, 63) * 64 + Math.min(legal, 63)]!;
          if (pvNode && r > 0) r--;
          r = Math.min(r, depth - 2);
        }
        score = -this.search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (r > 0 && score > alpha) score = -this.search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -this.search(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.unmake(m);
      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          // collect the principal variation
          const base = ply * MAX_PLY, child = (ply + 1) * MAX_PLY;
          this.pvTable[base] = m;
          const len = this.pvLen[ply + 1]!;
          for (let j = 0; j < len; j++) this.pvTable[base + 1 + j] = this.pvTable[child + j]!;
          this.pvLen[ply] = len + 1;
          if (score >= beta) {
            if (isQuiet) {
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2]!;
                this.killers[ply * 2] = m;
              }
              const h = pos.cells[m & 63]! * NSQ + to;
              this.history[h] = Math.min(this.history[h]! + depth * depth, 1 << 24);
            }
            break;
          }
        }
      }
    }
    if (!legal) return inCheck ? -MATE + ply : -opts.contempt;

    let stored = best;
    if (stored > MATE_BOUND) stored += ply;
    else if (stored < -MATE_BOUND) stored -= ply;
    this.ttKey[idx] = pos.hi;
    this.ttMove[idx] = bestMove;
    this.ttScore[idx] = Math.max(-INF, Math.min(INF, stored));
    this.ttDepth[idx] = Math.min(depth, 127);
    this.ttFlag[idx] = best >= beta ? LOWER : best > origAlpha ? EXACT : UPPER;
    return best;
  }

  /** Quiescence score of `pos` for the side to move (for training: is the position quiet?). */
  qscore(pos: Position): number {
    this.pos = pos;
    this.nodes = 0;
    this.nodeLimit = 100000;
    this.deadline = Infinity;
    try {
      return this.quiesce(-INF, INF, 0);
    } catch {
      return NaN;
    }
  }

  /** Static evaluation of `pos` for the side to move. */
  staticEval(pos: Position): number {
    this.pos = pos;
    return this.eval();
  }

  /** Legal moves of the root position. */
  rootMoves(pos: Position): number[] {
    const out = new Int32Array(MAX_MOVES);
    const n = pos.gen(out, 0, false);
    return [...out.subarray(0, n)].filter((m) => pos.legal(m));
  }

  /** Iterative deepening within `limits`. */
  run(pos: Position, limits: Limits): SearchResult {
    const t0 = performance.now();
    this.pos = pos;
    this.nodes = 0;
    this.nodeLimit = limits.nodes ?? Infinity;
    this.deadline = limits.timeMs !== undefined ? t0 + limits.timeMs : Infinity;
    const maxDepth = Math.min(limits.depth ?? 64, MAX_PLY / 2);
    // age history between moves
    for (let i = 0; i < this.history.length; i++) this.history[i]! >>= 2;
    this.killers.fill(0);

    const roots = this.rootMoves(pos);
    let result: SearchResult = { move: roots[0] ?? 0, score: 0, depth: 0, nodes: 0, pv: roots.slice(0, 1), timeMs: 0 };
    if (roots.length <= 1) return { ...result, timeMs: performance.now() - t0 };
    const saved = { cells: pos.cells.slice(), side: pos.side, king: pos.king.slice(), lo: pos.lo, hi: pos.hi, sp: pos.sp };
    let prev = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      try {
        let window = this.opts.aspiration;
        let alpha = depth >= 4 ? prev - window : -INF;
        let beta = depth >= 4 ? prev + window : INF;
        let score: number;
        for (;;) {
          score = this.search(depth, alpha, beta, 0, false);
          if (score <= alpha) {
            alpha = Math.max(-INF, alpha - window);
            window *= 3;
          } else if (score >= beta) {
            beta = Math.min(INF, beta + window);
            window *= 3;
          } else break;
          if (window > 1000) {
            alpha = -INF;
            beta = INF;
          }
        }
        prev = score;
        const len = this.pvLen[0]!;
        const pv = [...this.pvTable.subarray(0, len)];
        result = { move: pv[0] ?? result.move, score, depth, nodes: this.nodes, pv, timeMs: performance.now() - t0 };
        if (Math.abs(score) > MATE_BOUND && depth > 2) break;
        // don't start a deeper iteration that likely won't finish
        if (this.deadline !== Infinity && performance.now() - t0 > (this.deadline - t0) * 0.55) break;
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        // put back whatever the interrupted search had made
        pos.cells.set(saved.cells);
        pos.side = saved.side;
        pos.king = saved.king;
        pos.lo = saved.lo;
        pos.hi = saved.hi;
        pos.sp = saved.sp;
        break;
      }
    }
    result.nodes = this.nodes;
    result.timeMs = performance.now() - t0;
    return result;
  }
}

/** The rules-level Move matching an engine move in `g`. */
export function toRulesMove(g: GameState, m: number): Move {
  const from = moveFrom(m), to = moveTo(m), promo = movePromo(m);
  const found = legalMoves(g).find((x) => x.from === from && x.to === to && (x.promo & 7) === promo);
  if (!found) throw new Error(`engine move ${from}-${to}${promo ? "=" + promo : ""} is not legal`);
  return found;
}
