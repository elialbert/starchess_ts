// Running matches on a worker pool; see tools/match.ts for the command line.
import { makeRng } from "../../src/engine/bots";
import { ALL_SETUPS, setupName } from "../../src/engine/rules";
import { PLAYABLE_SETUPS } from "../../src/engine/setups";
import { SPRT_BOUNDS, type Tally, fmtElo, games, llr } from "./elo";
import type { GameRecord } from "./game";
import { Pool } from "./pool";

export interface MatchOptions {
  a: string;
  b: string;
  pairs: number;
  sprt?: [number, number];
  seed: number;
  setups: "playable" | "all";
  quiet?: boolean;
}

export interface MatchResult {
  tally: Tally;
  elo: string;
  llr?: number;
  verdict?: "H1" | "H0";
  reasons: Record<string, number>;
  avgPlies: number;
  seconds: number;
}

/** Run a match on `pool`. Results are from A's point of view. */
export async function runMatch(pool: Pool, o: MatchOptions): Promise<MatchResult> {
  const rng = makeRng(o.seed);
  const setups = (o.setups === "all" ? ALL_SETUPS.map(setupName) : [...PLAYABLE_SETUPS]).sort(() => rng() - 0.5);
  const tally: Tally = { wins: 0, draws: 0, losses: 0 };
  const reasons: Record<string, number> = {};
  let plies = 0;
  let verdict: MatchResult["verdict"];
  let lastPrint = 0;
  const t0 = Date.now();
  const status = () => {
    const l = o.sprt ? ` LLR ${llr(tally, ...o.sprt).toFixed(2)} (${SPRT_BOUNDS.lower.toFixed(2)}, ${SPRT_BOUNDS.upper.toFixed(2)})` : "";
    return `${games(tally)} games  +${tally.wins} =${tally.draws} -${tally.losses}  elo ${fmtElo(tally)}${l}  ${((Date.now() - t0) / 1000).toFixed(0)}s`;
  };
  const record = (g: GameRecord, aIsWhite: boolean) => {
    const s = aIsWhite ? g.result : 1 - g.result;
    if (s === 1) tally.wins++;
    else if (s === 0) tally.losses++;
    else tally.draws++;
    reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
    plies += g.plies;
  };

  let next = 0;
  const worker = async () => {
    while (next < o.pairs && !verdict) {
      const i = next++;
      const [g1, g2] = await pool.run("pair", { a: o.a, b: o.b, setup: setups[i % setups.length]!, seed: o.seed * 1000003 + i * 17 });
      if (verdict) return;
      record(g1!, true);
      record(g2!, false);
      if (o.sprt) {
        const l = llr(tally, ...o.sprt);
        if (l >= SPRT_BOUNDS.upper) verdict = "H1";
        else if (l <= SPRT_BOUNDS.lower) verdict = "H0";
      }
      if (!o.quiet && Date.now() - lastPrint > 5000) {
        lastPrint = Date.now();
        console.log(status());
      }
    }
  };
  await Promise.all(Array.from({ length: pool.size }, worker));
  return {
    tally,
    elo: fmtElo(tally),
    llr: o.sprt ? llr(tally, ...o.sprt) : undefined,
    verdict,
    reasons,
    avgPlies: plies / Math.max(1, games(tally)),
    seconds: (Date.now() - t0) / 1000
  };
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = "true";
    else out[a.slice(2)] = argv[++i]!;
  }
  return out;
}

