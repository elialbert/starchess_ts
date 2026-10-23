// One player against a list of references, for tracking progress over time.
//   npm run gauntlet -- [--a engine,nodes=20000] [--refs "spec;spec;..."] [--pairs 100]
// The default references are fixed points: the old bots, and the engine with
// round-1 weights and none of the later search changes (tools/refs/).
import { parseArgs, runMatch } from "./lib/match";
import { Pool } from "./lib/pool";

const args = parseArgs(process.argv.slice(2));
const a = args.a ?? "engine,nodes=20000";
const refs = (
  args.refs ??
  "magpie;classic,timeMs=50;engine,nodes=20000,weights=tools/refs/weights-r1.json,seePrune=false;engine,nodes=5000"
).split(";");
const pairs = Number(args.pairs ?? 100);
const pool = await Pool.start(args.threads ? Number(args.threads) : undefined);
console.log(`${a}: ${pairs} pairs against each reference\n`);
for (const b of refs) {
  const r = await runMatch(pool, { a, b, pairs, seed: 5, setups: "playable", quiet: true });
  console.log(`vs ${b.padEnd(70)} +${r.tally.wins} =${r.tally.draws} -${r.tally.losses}  ${r.elo}`);
}
await pool.close();
