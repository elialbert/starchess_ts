import { MIRROR_LR, MIRROR_V, NEIGHBORS, SPACE_COUNT, hexCenter } from "./board";
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
const SLIDE_DIRS = [[], [], [], DIAG, ROOK_DIRS, ALL, []] as number[][];
const RANK = [0, 1, 3, 3, 3, 9, 100];

// the running total, kept at module level so `add` needn't be a closure
let score = 0;
let curW: ArrayLike<number> = [];
let curTrace: Float64Array | null = null;
let mgF = 1, egF = 0;
function add(i: number, v: number) {
  score += (curW[i]! * mgF + curW[NF + i]! * egF) * v;
  if (curTrace) {
    curTrace[i]! += v * mgF;
    curTrace[NF + i]! += v * egF;
  }
}

const att = [new Int8Array(NSQ), new Int8Array(NSQ)];
const patt = [new Uint8Array(NSQ), new Uint8Array(NSQ)];
/** lowest-valued attacker rank on each space, per side */
const low = [new Uint8Array(NSQ), new Uint8Array(NSQ)];

/**
 * Score of `cells` for the side to move, in centipawns. With `trace`, adds
 * each feature's count (white minus black) into it: then the white-view score
 * is exactly the dot product of the weights and the trace.
 */
export function evaluate(cells: Int8Array, side: number, W: ArrayLike<number>, trace?: Float64Array): number {
  curW = W;
  curTrace = trace ?? null;
  score = 0;
  let phase = 0;
  for (let s = 1; s < NSQ; s++) phase += PHASE[cells[s]! & 7]!;
  mgF = Math.min(phase, PHASE_MAX) / PHASE_MAX;
  egF = 1 - mgF;
  for (let c = 0; c < 2; c++) {
    att[c]!.fill(0);
    patt[c]!.fill(0);
    low[c]!.fill(255);
  }
  const kings = [0, 0];

  for (let s = 1; s < NSQ; s++) {
    const p = cells[s]!;
    if (!p) continue;
    const t = p & 7, c = p >> 3, sign = c ? -1 : 1;
    const a = att[c]!, lo = low[c]!, rank = RANK[t]!;
    add(I_VAL + t, sign);
    add(I_PST + t * NORB + ORB[c]![s]!, sign);
    let mob = 0;
    if (t === 1) {
      for (const d of PAWN_CAP[c]!) {
        const n = NB[s * 6 + d]!;
        if (n) {
          a[n]!++;
          patt[c]![n] = 1;
          if (rank < lo[n]!) lo[n] = rank;
        }
      }
    } else if (t === 2) {
      for (const n of KN[s]!) {
        a[n]!++;
        if (rank < lo[n]!) lo[n] = rank;
        const q = cells[n]!;
        if (!q || q >> 3 !== c) mob++;
      }
    } else if (t === 6) {
      kings[c] = s;
      for (let d = 0; d < 6; d++) {
        const n = NB[s * 6 + d]!;
        if (!n) continue;
        a[n]!++;
        if (rank < lo[n]!) lo[n] = rank;
        const q = cells[n]!;
        if (!q || q >> 3 !== c) mob++;
      }
    } else {
      for (const d of SLIDE_DIRS[t]!) {
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
        for (const d of DIAG) {
          const n = NB[s * 6 + d]!;
          if (n && !cells[n]) mob++;
        }
      }
    }
    add(I_MOB + t, sign * mob);
  }

  for (let s = 1; s < NSQ; s++) {
    const p = cells[s]!;
    if (!p) continue;
    const t = p & 7, c = p >> 3, o = c ^ 1, sign = c ? -1 : 1;
    if (t === 6) continue;
    if (att[o]![s] && !att[c]![s]) add(I_HANG + t, sign);
    if (t !== 1 && patt[o]![s]) add(I_PTHREAT + t, sign);
    else if (low[o]![s]! < RANK[t]!) add(I_LTHREAT + t, sign);
    if (t === 1 && patt[c]![s]) add(I_PDEF, sign);
  }

  for (let c = 0; c < 2; c++) {
    const k = kings[c]!;
    if (!k) continue;
    const sign = c ? -1 : 1, o = c ^ 1;
    let hits = att[o]![k]!, shelter = 0;
    for (let d = 0; d < 6; d++) {
      const n = NB[k * 6 + d]!;
      if (!n) continue;
      hits += att[o]![n]!;
      const q = cells[n]!;
      if (q && q >> 3 === c) shelter++;
    }
    add(I_KZONE + Math.min(hits, 7), sign);
    add(I_SHELTER + shelter, sign);
  }
  add(I_TEMPO, side ? -1 : 1);
  return side ? -score : score;
}
