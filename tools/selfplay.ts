// Generates training positions by self-play, for tools/texel.ts.
// Each line of the output: 37 hex digits (the pieces on spaces 1..37), the
// side to move, and the game's result for white (1, 0.5, 0).
//
//   npm run selfplay -- --games 20000 --spec engine,nodes=5000,noise=20 --out data/selfplay.txt
//
// Games start from all 120 setups, with a few random plies first for variety.
import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { makeRng } from "../src/engine/bots";
import { ALL_SETUPS, setupName } from "../src/engine/rules";
import { parseArgs } from "./lib/match";
import { Pool } from "./lib/pool";

const args = parseArgs(process.argv.slice(2));
const total = Number(args.games ?? 10000);
const spec = args.spec ?? "engine,nodes=5000,noise=20";
const out = args.out ?? "data/selfplay.txt";
const seed = Number(args.seed ?? Date.now() % 100000);
mkdirSync(dirname(out), { recursive: true });
const file = createWriteStream(out, { flags: args.append ? "a" : "w" });
const rng = makeRng(seed);
const pool = await Pool.start(args.threads ? Number(args.threads) : undefined);
console.log(`${total} games of ${spec} on ${pool.size} threads -> ${out}`);

const t0 = Date.now();
let done = 0, positions = 0;
const results = { 1: 0, 0.5: 0, 0: 0 } as Record<number, number>;
let next = 0;
await Promise.all(
  Array.from({ length: pool.size * 2 }, async () => {
    while (next < total) {
      const i = next++;
      const setup = setupName(ALL_SETUPS[Math.floor(rng() * ALL_SETUPS.length)]!);
      const r = await pool.run("selfplay", { spec, setup, seed: seed * 7919 + i, randomPlies: Math.floor(rng() * 5) });
      for (const p of r.positions) {
        const [turn, cells] = p.split(":");
        const hex = cells!.split(",").slice(1).map((c) => Number(c).toString(16)).join("");
        file.write(`${hex} ${turn} ${r.result}\n`);
      }
      positions += r.positions.length;
      results[r.result]!++;
      if (++done % 500 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        console.log(`${done}/${total} games, ${positions} positions, ${rate.toFixed(1)} games/s, W/D/L ${results[1]}/${results[0.5]}/${results[0]}`);
      }
    }
  })
);
await new Promise((r) => file.end(r));
await pool.close();
console.log(`done: ${positions} positions in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
