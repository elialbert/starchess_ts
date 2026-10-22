// Headless bot tournament: every pairing plays N games each way, then the table.
// Usage: npm run arena -- [gamesPerSide=4] [bots=random,magpie,tactician]
import { BOTS, type BotId, botInfo, chooseMove, makeRng, makeStyle } from "../src/engine/bots";
import { COLOR_NAME, WHITE, applyMove, legalMoves, newGame, outcome } from "../src/engine/rules";

const n = Number(process.argv[2] ?? 4);
const ids = (process.argv[3]?.split(",") ?? BOTS.filter((b) => b.id !== "oracle").map((b) => b.id)) as BotId[];
const score = new Map<BotId, number>(ids.map((id) => [id, 0]));

for (const white of ids) {
  for (const black of ids) {
    if (white === black && ids.length > 1) continue;
    for (let i = 0; i < n; i++) {
      const seed = 1000 * i + ids.indexOf(white) * 31 + ids.indexOf(black);
      const rng = makeRng(seed);
      const styles = [makeStyle(makeRng(seed + 1)), makeStyle(makeRng(seed + 2))];
      let g = newGame();
      let res = outcome(g);
      while (!res) {
        g = applyMove(g, chooseMove(g, g.turn === WHITE ? white : black, rng, styles[g.turn]).move);
        res = outcome(g, legalMoves(g));
      }
      const winner = res.winner === null ? null : res.winner === WHITE ? white : black;
      if (winner) score.set(winner, score.get(winner)! + 1);
      else for (const id of [white, black]) score.set(id, score.get(id)! + 0.5);
      console.log(
        `${botInfo(white).name} vs ${botInfo(black).name}: ${res.winner === null ? "draw" : COLOR_NAME[res.winner] + " wins"} by ${res.reason} in ${g.ply} plies`
      );
    }
  }
}
console.log("\n" + [...score].sort((a, b) => b[1] - a[1]).map(([id, s]) => `${botInfo(id).name.padEnd(10)} ${s}`).join("\n"));
