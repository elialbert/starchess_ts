// Scores all 120 mirrored setups with a deep search and writes
// src/engine/setups.json, which the game and the harness draw openings from.
// Usage: npm run setups -- [nodes=3000000]
import { writeFileSync } from "node:fs";
import { ALL_SETUPS, setupName } from "../src/engine/rules";
import { Pool } from "./lib/pool";

const nodes = Number(process.argv[2] ?? 3_000_000);
const pool = await Pool.start();
const t0 = Date.now();
let done = 0;
const results = await Promise.all(
  ALL_SETUPS.map(async (s) => {
    const r = await pool.run("analyze", { setup: setupName(s), nodes });
    if (++done % 20 === 0) console.log(`${done}/120`);
    return r;
  })
);
await pool.close();
results.sort((a, b) => a.score - b.score);
const out = Object.fromEntries(results.map((r) => [r.setup, r.score]));
writeFileSync(new URL("../src/engine/setups.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const r of results) console.log(`${r.setup} ${String(r.score).padStart(6)}  depth ${r.depth}`);
