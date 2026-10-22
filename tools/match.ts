// Head-to-head match between two players, in parallel, from the playable
// setups (each setup played twice, colours swapped). Prints Elo for A with a
// 95% interval; with --sprt stops as soon as the result is clear.
//
//   npm run match -- --a engine,nodes=20000 --b engine,nodes=20000,lmr=false --pairs 300
//   npm run match -- --a engine,weights=tuning/new.json --b engine --sprt 0,10
//
// Options: --a, --b player specs (tools/lib/players.ts); --pairs (default 200);
// --threads; --sprt elo0,elo1; --seed; --setups playable|all; --json out.json;
// --quiet (just the final line).
import { writeFileSync } from "node:fs";
import { type MatchOptions, parseArgs, runMatch } from "./lib/match";
import { Pool } from "./lib/pool";

{
  const args = parseArgs(process.argv.slice(2));
  const o: MatchOptions = {
    a: args.a ?? "engine",
    b: args.b ?? "engine",
    pairs: Number(args.pairs ?? 200),
    sprt: args.sprt ? (args.sprt.split(",").map(Number) as [number, number]) : undefined,
    seed: Number(args.seed ?? 1),
    setups: (args.setups as "all") ?? "playable",
    quiet: args.quiet === "true"
  };
  const pool = await Pool.start(args.threads ? Number(args.threads) : undefined);
  console.log(`A: ${o.a}\nB: ${o.b}\n${o.pairs} pairs on ${pool.size} threads${o.sprt ? `, SPRT [${o.sprt}]` : ""}`);
  const r = await runMatch(pool, o);
  await pool.close();
  console.log(
    `\nA vs B: +${r.tally.wins} =${r.tally.draws} -${r.tally.losses}  elo ${r.elo}${r.verdict ? `  SPRT ${r.verdict === "H1" ? "PASSED" : "FAILED"} (LLR ${r.llr!.toFixed(2)})` : ""}`
  );
  console.log(`endings ${JSON.stringify(r.reasons)}  avg ${r.avgPlies.toFixed(0)} plies  ${r.seconds.toFixed(0)}s`);
  if (args.json) writeFileSync(args.json, JSON.stringify({ options: o, ...r }, null, 2));
}
