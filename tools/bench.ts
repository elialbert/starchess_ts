// Fixed-depth searches from the first 16 playable setups: total nodes (a
// signature: a pure speed-up mustn't change it) and nodes per second.
//   npm run bench -- [depth=9]
import { Engine, Position } from "../src/engine/engine";
import { newGame, parseSetup } from "../src/engine/rules";
import { PLAYABLE_SETUPS } from "../src/engine/setups";

const depth = Number(process.argv[2] ?? 9);
let nodes = 0;
const t0 = performance.now();
for (const s of PLAYABLE_SETUPS.slice(0, 16)) {
  const engine = new Engine(undefined, { ttBits: 18 });
  nodes += engine.run(Position.fromGame(newGame(parseSetup(s))), { depth }).nodes;
}
const ms = performance.now() - t0;
console.log(`depth ${depth}: ${nodes} nodes  ${(ms / 1000).toFixed(2)}s  ${Math.round(nodes / (ms / 1000)).toLocaleString()} nps`);
