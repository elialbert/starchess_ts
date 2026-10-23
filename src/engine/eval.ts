import { AXIAL, MIRROR_LR, MIRROR_V, NEIGHBORS, SPACE_COUNT, hexCenter } from "./board";
import { KNIGHT_TARGETS } from "./rules";

/**
 * The tunable evaluation. It's linear in its weights: every term is a weight
 * times a count (white's minus black's), so `evaluate` can also report the
 * counts ("trace") for Texel tuning (tools/texel.ts). Each feature has a
 * middlegame and an endgame weight ("eg.<name>"), blended by the material
 * left on the board.
 */

export const NSQ = SPACE_COUNT + 1;

// ---- board symmetry ----

const centers = Array.from({ length: NSQ }, (_, s) => (s ? hexCenter(s, 1) : [NaN, NaN]));
const [xc, yc] = centers[19]!;

/** Spaces grouped with their left-right mirror: the piece-square tables have one weight per group. */
export const ORBIT = new Int8Array(NSQ);
export const NORB = (() => {
  let n = 0;
  const seen = new Map<number, number>();
  for (let s = 1; s < NSQ; s++) {
    const key = Math.min(s, MIRROR_LR[s]!);
    if (!seen.has(key)) seen.set(key, n++);
    ORBIT[s] = seen.get(key)!;
  }
  return n;
})();
/** ORB[color][space]: the table entry for a piece of `color` on `space`, seen from its own side. */
const ORB = [Int8Array.from(ORBIT), Int8Array.from({ length: NSQ }, (_, s) => (s ? ORBIT[MIRROR_V[s]!]! : 0))];

/** AHEAD[color][space]: spaces in front of a pawn there, in its own and the neighbouring columns */
const AHEAD = [0, 1].map((c) =>
  Array.from({ length: NSQ }, (_, s) => {
    if (!s) return new Int8Array(0);
    const [x, y] = centers[s]!;
    const out: number[] = [];
    for (let t = 1; t < NSQ; t++) {
      const [tx, ty] = centers[t]!;
      const ahead = c === 0 ? ty! < y! - 1e-6 : ty! > y! + 1e-6;
      if (ahead && Math.abs(tx! - x!) < 1.6) out.push(t);
    }
    return Int8Array.from(out);
  })
);
/** pawn steps from each space to the far edge, per colour */
const TO_EDGE = [0, 3].map((dir) =>
  Int8Array.from({ length: NSQ }, (_, s) => {
    let n = 0;
    for (let t = s ? NEIGHBORS[s]![dir]! : 0; t; t = NEIGHBORS[t]![dir]!) n++;
    return n;
  })
);
/** column of each space */
const COLUMN = Int8Array.from({ length: NSQ }, (_, s) => (s ? AXIAL[s]![0]! : 0));

// ---- parameter layout ----

const FEATURES: string[] = [];
const block = (name: string, n: number) => {
  const start = FEATURES.length;
  for (let i = 0; i < n; i++) FEATURES.push(n === 1 ? name : `${name}[${i}]`);
  return start;
};
/** material, by piece type (index 0 and the king unused) */
export const I_VAL = block("val", 7);
/** piece-square tables: type * NORB + orbit */
export const I_PST = block("pst", 7 * NORB);
/** per move available, by piece type */
export const I_MOB = block("mob", 7);
/** enemy attacks on the king and its neighbours, bucketed 0..7+ */
export const I_KZONE = block("kzone", 8);
/** own pieces next to the king, 0..6 */
export const I_SHELTER = block("shelter", 7);
/** attacked and undefended, by type */
export const I_HANG = block("hang", 7);
/** attacked by an enemy pawn, by type */
export const I_PTHREAT = block("pthreat", 7);
/** attacked by an enemy piece of lower value, by type */
export const I_LTHREAT = block("lthreat", 7);
/** pawn defended by a pawn */
export const I_PDEF = block("pdef", 1);
/** passed pawn (no enemy pawn ahead in its own or a neighbouring column), by steps left to promotion */
export const I_PASSED = block("passed", 7);
/** pawn with another of its own pawns in the same column */
export const I_DOUBLED = block("doubled", 1);
/** pawn whose forward space is occupied */
export const I_BLOCKED = block("blocked", 1);
/** side to move */
export const I_TEMPO = block("tempo", 1);
/** number of features; weight i is feature i's middlegame weight, NF + i its endgame weight */
export const NF = FEATURES.length;
export const PARAM_NAMES: readonly string[] = [...FEATURES, ...FEATURES.map((n) => "eg." + n)];
export const NPARAMS = PARAM_NAMES.length;

export type Weights = Float64Array;

/** non-pawn material for the game phase: knight, bishop, rook 1, queen 2; 10 at the start */
const PHASE = [0, 0, 1, 1, 1, 2, 0];
const PHASE_MAX = 10;

/** Hand-set starting weights (tools/texel.ts improves on them), the same in middlegame and endgame. */
export function baseWeights(): Weights {
  const w = new Float64Array(NPARAMS);
  [0, 100, 450, 350, 400, 900, 0].forEach((v, t) => (w[I_VAL + t] = v));
  for (let s = 1; s < NSQ; s++) {
    const [q, r] = [centers[s]![0]! - xc!, centers[s]![1]! - yc!];
    const central = Math.max(0, 3 - Math.hypot(q, r) / Math.sqrt(3));
    for (let t = 2; t <= 5; t++) w[I_PST + t * NORB + ORBIT[s]!] = Math.round(8 * central);
    w[I_PST + 6 * NORB + ORBIT[s]!] = Math.round(-10 * central);
    // pawns: further north is better (white's view)
    w[I_PST + 1 * NORB + ORBIT[s]!] = Math.round(-r * 7);
  }
  for (let t = 2; t <= 6; t++) w[I_MOB + t] = 3;
  [0, -8, -20, -40, -65, -95, -130, -170].forEach((v, i) => (w[I_KZONE + i] = v));
  [-30, -10, 0, 8, 12, 14, 14].forEach((v, i) => (w[I_SHELTER + i] = v));
  [0, -15, -60, -50, -55, -120, 0].forEach((v, t) => (w[I_HANG + t] = v));
  [0, 0, -40, -35, -40, -80, 0].forEach((v, t) => (w[I_PTHREAT + t] = v));
  [0, 0, -20, -15, -20, -60, 0].forEach((v, t) => (w[I_LTHREAT + t] = v));
  w[I_PDEF] = 8;
  w[I_TEMPO] = 15;
  w.copyWithin(NF, 0, NF);
  return w;
}

export const weightsToJSON = (w: Weights) => Object.fromEntries(PARAM_NAMES.map((n, i) => [n, Math.round(w[i]! * 10) / 10]));
/** Weights from JSON; an endgame weight that's missing takes its middlegame value. */
export function weightsFromJSON(o: Record<string, number>): Weights {
  const w = baseWeights();
  FEATURES.forEach((n, i) => {
    if (typeof o[n] === "number") w[i] = o[n]!;
    w[NF + i] = typeof o["eg." + n] === "number" ? o["eg." + n]! : w[i]!;
  });
  return w;
}

// ---- evaluation ----

const NB = Int8Array.from(NEIGHBORS.flat());
const KN = KNIGHT_TARGETS.map((ts) => Int8Array.from(ts));
const PAWN_CAP = [
  [1, 5],
  [2, 4]
];
const DIAG = [1, 2, 4, 5];
const ROOK_DIRS = [0, 3];
const ALL = [0, 1, 2, 3, 4, 5];
const SLIDE_DIRS = [[], [], [], DIAG, ROOK_DIRS, ALL, []].map((d) => Int8Array.from(d));
const RANK = [0, 1, 3, 3, 3, 9, 100];

// the running totals, kept at module level so `add` needn't be a closure;
// middlegame and endgame are summed apart and blended once at the end
let mg = 0, eg = 0;
let curW: ArrayLike<number> = [];
let tracing = false;
/** feature counts while tracing */
const cnt = new Float64Array(NF);
function add(i: number, v: number) {
  mg += curW[i]! * v;
  eg += curW[NF + i]! * v;
  if (tracing) cnt[i]! += v;
}

/** material + piece-square, signed for white, by piece code * NSQ + space; rebuilt when the weights change */
const psqMg = new Float64Array(16 * NSQ), psqEg = new Float64Array(16 * NSQ);
let psqW: ArrayLike<number> | null = null;
function buildPsq(W: ArrayLike<number>) {
  psqW = W;
  for (let c = 0; c < 2; c++)
    for (let t = 1; t <= 6; t++)
      for (let s = 1; s < NSQ; s++) {
        const i = (t | (c << 3)) * NSQ + s, sign = c ? -1 : 1;
        const pst = I_PST + t * NORB + ORB[c]![s]!;
        psqMg[i] = sign * (W[I_VAL + t]! + W[pst]!);
        psqEg[i] = sign * (W[NF + I_VAL + t]! + W[NF + pst]!);
      }
}

const att = [new Int8Array(NSQ), new Int8Array(NSQ)];
const patt = [new Uint8Array(NSQ), new Uint8Array(NSQ)];
/** lowest-valued attacker rank on each space, per side */
const low = [new Uint8Array(NSQ), new Uint8Array(NSQ)];
const pawnCols = [new Int8Array(9), new Int8Array(9)];

/**
 * Score of `cells` for the side to move, in centipawns. With `trace`, adds
 * each feature's count (white minus black) into it: then the white-view score
 * is the dot product of the weights and the trace. Material and piece-square
 * tables are cached per weights object, so don't change `W` in place.
 */
export function evaluate(cells: Int8Array, side: number, W: ArrayLike<number>, trace?: Float64Array): number {
  curW = W;
  tracing = trace !== undefined;
  if (tracing) cnt.fill(0);
  mg = eg = 0;
  if (W !== psqW) buildPsq(W);
  const att0 = att[0]!, att1 = att[1]!, patt0 = patt[0]!, patt1 = patt[1]!, low0 = low[0]!, low1 = low[1]!;
  att0.fill(0);
  att1.fill(0);
  patt0.fill(0);
  patt1.fill(0);
  low0.fill(255);
  low1.fill(255);
  let phase = 0, king0 = 0, king1 = 0;

  for (let s = 1; s < NSQ; s++) {
    const p = cells[s]!;
    if (!p) continue;
    const t = p & 7, c = p >> 3, sign = c ? -1 : 1;
    const a = c ? att1 : att0, lo = c ? low1 : low0, rank = RANK[t]!;
    phase += PHASE[t]!;
    if (tracing) {
      add(I_VAL + t, sign);
      add(I_PST + t * NORB + ORB[c]![s]!, sign);
    } else {
      mg += psqMg[p * NSQ + s]!;
      eg += psqEg[p * NSQ + s]!;
    }
    let mob = 0;
    if (t === 1) {
      const pc = PAWN_CAP[c]!, pa = c ? patt1 : patt0;
      for (let j = 0; j < 2; j++) {
        const n = NB[s * 6 + pc[j]!]!;
        if (n) {
          a[n]!++;
          pa[n] = 1;
          if (rank < lo[n]!) lo[n] = rank;
        }
      }
      pawnCols[c]![COLUMN[s]!]!++;
      continue;
    } else if (t === 2) {
      const kn = KN[s]!;
      for (let j = 0; j < kn.length; j++) {
        const n = kn[j]!;
        a[n]!++;
        if (rank < lo[n]!) lo[n] = rank;
        const q = cells[n]!;
        if (!q || q >> 3 !== c) mob++;
      }
    } else if (t === 6) {
      if (c) king1 = s;
      else king0 = s;
      for (let d = 0; d < 6; d++) {
        const n = NB[s * 6 + d]!;
        if (!n) continue;
        a[n]!++;
        if (rank < lo[n]!) lo[n] = rank;
        const q = cells[n]!;
        if (!q || q >> 3 !== c) mob++;
      }
    } else {
      const dirs = SLIDE_DIRS[t]!;
      for (let j = 0; j < dirs.length; j++) {
        const d = dirs[j]!;
        let n = NB[s * 6 + d]!;
        while (n) {
          a[n]!++;
          if (rank < lo[n]!) lo[n] = rank;
          const q = cells[n]!;
          if (!q) mob++;
          else {
            if (q >> 3 !== c) mob++;
            break;
          }
          n = NB[n * 6 + d]!;
        }
      }
      if (t === 4) {
        for (let j = 0; j < 4; j++) {
          const n = NB[s * 6 + DIAG[j]!]!;
          if (n && !cells[n]) mob++;
        }
      }
    }
    add(I_MOB + t, sign * mob);
  }

  for (let s = 1; s < NSQ; s++) {
    const p = cells[s]!;
    if (!p) continue;
    const t = p & 7;
    if (t === 6) continue;
    const c = p >> 3, sign = c ? -1 : 1;
    const own = c ? att1 : att0, opp = c ? att0 : att1, oppP = c ? patt0 : patt1;
    if (opp[s] && !own[s]) add(I_HANG + t, sign);
    if (t !== 1 && oppP[s]) add(I_PTHREAT + t, sign);
    else if ((c ? low0 : low1)[s]! < RANK[t]!) add(I_LTHREAT + t, sign);
    if (t === 1) {
      if ((c ? patt1 : patt0)[s]) add(I_PDEF, sign);
      const enemyPawn = 1 | ((c ^ 1) << 3);
      const ahead = AHEAD[c]![s]!;
      let passed = true;
      for (let j = 0; j < ahead.length; j++) {
        if (cells[ahead[j]!] === enemyPawn) {
          passed = false;
          break;
        }
      }
      if (passed) add(I_PASSED + Math.min(TO_EDGE[c]![s]!, 6), sign);
      const fwd = NB[s * 6 + (c ? 3 : 0)]!;
      if (fwd && cells[fwd]) add(I_BLOCKED, sign);
    }
  }
  for (let c = 0; c < 2; c++) {
    const pc = pawnCols[c]!;
    for (let col = 0; col < 9; col++) if (pc[col]! > 1) add(I_DOUBLED, (c ? -1 : 1) * (pc[col]! - 1));
    pc.fill(0);
  }

  for (let c = 0; c < 2; c++) {
    const k = c ? king1 : king0;
    if (!k) continue;
    const opp = c ? att0 : att1;
    let hits = opp[k]!, shelter = 0;
    for (let d = 0; d < 6; d++) {
      const n = NB[k * 6 + d]!;
      if (!n) continue;
      hits += opp[n]!;
      const q = cells[n]!;
      if (q && q >> 3 === c) shelter++;
    }
    const sign = c ? -1 : 1;
    add(I_KZONE + Math.min(hits, 7), sign);
    add(I_SHELTER + shelter, sign);
  }
  add(I_TEMPO, side ? -1 : 1);

  const mgF = Math.min(phase, PHASE_MAX) / PHASE_MAX, egF = 1 - mgF;
  if (trace) {
    for (let i = 0; i < NF; i++) {
      if (!cnt[i]) continue;
      trace[i]! += cnt[i]! * mgF;
      trace[NF + i]! += cnt[i]! * egF;
    }
  }
  const score = mg * mgF + eg * egF;
  return side ? -score : score;
}
