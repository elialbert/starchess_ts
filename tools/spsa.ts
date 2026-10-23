// SPSA hill-climbing of numeric engine parameters by self-play. Each step
// nudges every parameter up or down at random (θ+ and θ-), plays the two
// against each other, and moves θ towards whichever did better.
//
//   npm run spsa -- --params futilityMargin:120:20,rfpMargin:90:20,w.val[2]:450:25 --iters 200
//
// --params is name:start:step (step = the perturbation size, c). Names are
// SearchOptions fields or w.<eval weight>. --base is the rest of the player
// spec (default engine,nodes=5000). Progress goes to tuning/spsa-<time>.log.
import { appendFileSync, mkdirSync } from "node:fs";
import { makeRng } from "../src/engine/bots";
import { parseArgs } from "./lib/match";
import { runMatch } from "./lib/match";
import { Pool } from "./lib/pool";

const args = parseArgs(process.argv.slice(2));
const base = args.base ?? "engine,nodes=5000";
const iters = Number(args.iters ?? 200);
const pairsPerIter = Number(args.pairs ?? 22);
const params = (args.params ?? "").split(",").filter(Boolean).map((p) => {
  const [name, start, step] = p.split(":");
  return { name: name!, value: Number(start), c: Number(step) };
});
if (!params.length) throw new Error("--params name:start:step,...");
const INTEGER_OPTIONS = ["ttBits", "nullBase", "nullDiv", "lmrMinMoves", "lmpBase"];
const integer = (n: string) => INTEGER_OPTIONS.includes(n);
const fmt = (n: string, x: number) => (integer(n) ? Math.round(x) : Math.round(x * 10) / 10);
const spec = (vals: number[]) => base + "," + params.map((p, i) => `${p.name}=${fmt(p.name, vals[i]!)}`).join(",");

mkdirSync("tuning", { recursive: true });
const log = `tuning/spsa-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
const rng = makeRng(Number(args.seed ?? Date.now() % 1e6));
const pool = await Pool.start(args.threads ? Number(args.threads) : undefined);
console.log(`SPSA over ${params.map((p) => p.name).join(", ")}, ${iters} iterations of ${pairsPerIter} pairs on ${pool.size} threads; log ${log}`);

// standard SPSA gain schedules: a_k = a / (k + A)^0.602, c_k = c / k^0.101
const A = iters / 10;
const a = Number(args.a ?? 2);
let theta = params.map((p) => p.value);
for (let k = 1; k <= iters; k++) {
  const ck = 1 / k ** 0.101;
  const ak = a / (k + A) ** 0.602;
  const delta = params.map(() => (rng() < 0.5 ? -1 : 1));
  const plus = theta.map((t, i) => t + params[i]!.c * ck * delta[i]!);
  const minus = theta.map((t, i) => t - params[i]!.c * ck * delta[i]!);
  const r = await runMatch(pool, { a: spec(plus), b: spec(minus), pairs: pairsPerIter, seed: k * 31 + 7, setups: "playable", quiet: true });
  const n = r.tally.wins + r.tally.draws + r.tally.losses;
  const score = (r.tally.wins - r.tally.losses) / n; // in [-1, 1]
  // step each parameter by its own scale c, so the gains are unit-free
  theta = theta.map((t, i) => t + ak * params[i]!.c * score * delta[i]!);
  const line = `${k} score ${score.toFixed(3)}  ` + params.map((p, i) => `${p.name}=${fmt(p.name, theta[i]!)}`).join(" ");
  console.log(line);
  appendFileSync(log, line + "\n");
}
await pool.close();
console.log(`\nfinal: ${spec(theta)}`);
