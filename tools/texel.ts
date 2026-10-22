// Texel tuning: fit the evaluation weights so that sigmoid(eval) predicts the
// results of self-play games (tools/selfplay.ts). Only quiet positions are
// used (the quiescence search agrees with the static eval). The evaluation is
// linear in its weights, so each position becomes a sparse feature vector
// once, and the fit is plain gradient descent (Adam) on those.
//
//   npm run texel -- --data data/gen1.txt --out tuning/texel1.json [--epochs 1500] [--max 1500000]
//
// Then check it plays better:
//   npm run match -- --a engine,weights=tuning/texel1.json --b engine --sprt 0,10
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { makeRng } from "../src/engine/bots";
import { Engine, Position } from "../src/engine/engine";
import { NPARAMS, PARAM_NAMES, evaluate, weightsToJSON } from "../src/engine/eval";
import { loadWeights } from "./lib/players";
import { parseArgs } from "./lib/match";

const args = parseArgs(process.argv.slice(2));
const files = (args.data ?? "data/gen1.txt").split(",");
const out = args.out ?? "tuning/texel.json";
const epochs = Number(args.epochs ?? 1500);
const lr = Number(args.lr ?? 1.5);
const l2 = Number(args.l2 ?? 1e-7);
const maxPositions = Number(args.max ?? 1_500_000);
const quietMargin = Number(args.quiet ?? 30);
const base = loadWeights(args.base);

// ---- load and featurize ----

const rng = makeRng(7);
let lines = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean));
// shuffle, then cap
for (let i = lines.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [lines[i], lines[j]] = [lines[j]!, lines[i]!];
}
lines = lines.slice(0, maxPositions);
console.log(`${lines.length} positions from ${files.join(", ")}`);

const engine = new Engine(base, { ttBits: 10 });
const offsets: number[] = [0];
const idx: number[] = [];
const val: number[] = [];
const results: number[] = [];
const trace = new Float64Array(NPARAMS);
const cells = new Int8Array(38);
let skipped = 0;
const t0 = Date.now();
for (const line of lines) {
  const [hex, turn, result] = line.split(" ");
  for (let s = 1; s <= 37; s++) cells[s] = parseInt(hex![s - 1]!, 16);
  const side = Number(turn);
  const pos = Position.fromCells(cells, side);
  if (pos.inCheck()) {
    skipped++;
    continue;
  }
  const stat = engine.staticEval(pos);
  const q = engine.qscore(pos);
  if (!(Math.abs(q - stat) <= quietMargin)) {
    skipped++;
    continue;
  }
  trace.fill(0);
  evaluate(pos.cells, side, base, trace);
  for (let i = 0; i < NPARAMS; i++) {
    if (trace[i]) {
      idx.push(i);
      val.push(trace[i]!);
    }
  }
  offsets.push(idx.length);
  results.push(Number(result));
}
const N = results.length;
const IDX = Int16Array.from(idx), VAL = Float32Array.from(val), OFF = Int32Array.from(offsets), RES = Float32Array.from(results);
console.log(`${N} quiet positions (${skipped} skipped), ${(idx.length / N).toFixed(0)} features each, ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// hold out 5% to watch for overfitting
const nTrain = Math.floor(N * 0.95);

function evalOf(w: Float64Array, j: number) {
  let e = 0;
  for (let k = OFF[j]!; k < OFF[j + 1]!; k++) e += w[IDX[k]!]! * VAL[k]!;
  return e;
}
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function loss(w: Float64Array, K: number, from: number, to: number) {
  let sum = 0;
  for (let j = from; j < to; j++) {
    const d = RES[j]! - sigmoid(K * evalOf(w, j));
    sum += d * d;
  }
  return sum / (to - from);
}

// ---- fit the scale K for the starting weights ----

let lo = 0.0005, hi = 0.05;
for (let i = 0; i < 40; i++) {
  const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
  if (loss(base, m1, 0, nTrain) < loss(base, m2, 0, nTrain)) hi = m2;
  else lo = m1;
}
const K = (lo + hi) / 2;
console.log(`K = ${K.toFixed(5)}, starting loss ${loss(base, K, 0, nTrain).toFixed(6)} (held out ${loss(base, K, nTrain, N).toFixed(6)})`);

// ---- Adam ----

const w = Float64Array.from(base);
const m = new Float64Array(NPARAMS), v = new Float64Array(NPARAMS), g = new Float64Array(NPARAMS);
const b1 = 0.9, b2 = 0.999;
let best = { loss: Infinity, w: Float64Array.from(w), epoch: 0 };
for (let epoch = 1; epoch <= epochs; epoch++) {
  g.fill(0);
  let sum = 0;
  for (let j = 0; j < nTrain; j++) {
    const s = sigmoid(K * evalOf(w, j));
    const d = s - RES[j]!;
    sum += d * d;
    const coef = d * s * (1 - s) * K;
    for (let k = OFF[j]!; k < OFF[j + 1]!; k++) g[IDX[k]!]! += coef * VAL[k]!;
  }
  for (let i = 0; i < NPARAMS; i++) {
    const gi = (2 * g[i]!) / nTrain + l2 * (w[i]! - base[i]!);
    m[i] = b1 * m[i]! + (1 - b1) * gi;
    v[i] = b2 * v[i]! + (1 - b2) * gi * gi;
    const mh = m[i]! / (1 - b1 ** epoch), vh = v[i]! / (1 - b2 ** epoch);
    w[i]! -= (lr * mh) / (Math.sqrt(vh) + 1e-12);
  }
  if (epoch % 50 === 0 || epoch === epochs) {
    const held = loss(w, K, nTrain, N);
    if (held < best.loss) best = { loss: held, w: Float64Array.from(w), epoch };
    console.log(`epoch ${epoch}: train ${(sum / nTrain).toFixed(6)}  held out ${held.toFixed(6)}`);
  }
}

// ---- report ----

console.log(`\nbest held-out loss at epoch ${best.epoch}. Biggest changes:`);
const changes = PARAM_NAMES.map((n, i) => ({ n, from: base[i]!, to: best.w[i]! })).sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
for (const c of changes.slice(0, 25)) console.log(`  ${c.n.padEnd(14)} ${c.from.toFixed(0).padStart(6)} -> ${c.to.toFixed(0)}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(weightsToJSON(best.w), null, 1) + "\n");
console.log(`wrote ${out}`);
