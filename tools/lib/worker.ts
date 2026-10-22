// Runs harness tasks on a worker thread (bundled by pool.ts).
import { parentPort } from "node:worker_threads";
import { Engine, Position } from "../../src/engine/engine";
import { newGame, parseSetup } from "../../src/engine/rules";
import { playGame } from "./game";
import { type Player, loadWeights, makePlayer, parseSpec } from "./players";

const players = new Map<string, Player>();
const player = (spec: string, role: string) => {
  const key = role + "|" + spec;
  if (!players.has(key)) players.set(key, makePlayer(parseSpec(spec)));
  return players.get(key)!;
};

export const handlers = {
  /** A pair of games from one setup, each player taking white once. Results are from A's point of view. */
  pair(args: { a: string; b: string; setup: string; seed: number; keepPositions?: boolean }) {
    const a = player(args.a, "a"), b = player(args.b, "b");
    const g1 = playGame(a, b, args.setup, args.seed, { keepPositions: args.keepPositions });
    const g2 = playGame(b, a, args.setup, args.seed + 7, { keepPositions: args.keepPositions });
    return [g1, g2];
  },
  /** Self-play games for training data: positions (as "turn:cells") with the result for white. */
  selfplay(args: { spec: string; setup: string; seed: number; randomPlies: number }) {
    const g = playGame(player(args.spec, "w"), player(args.spec, "b"), args.setup, args.seed, {
      keepPositions: true,
      randomPlies: args.randomPlies,
      adjudicate: 2500
    });
    return { result: g.result, positions: g.positions!, plies: g.plies, reason: g.reason };
  },
  /** The engine's score for white at the start of a setup. */
  analyze(args: { setup: string; nodes: number; weights?: string }) {
    const engine = new Engine(loadWeights(args.weights), { ttBits: 22 });
    const r = engine.run(Position.fromGame(newGame(parseSetup(args.setup))), { nodes: args.nodes });
    return { setup: args.setup, score: r.score, depth: r.depth, pv: r.pv };
  }
};
export type Handlers = typeof handlers;

parentPort?.on("message", ({ id, type, args }: { id: number; type: keyof Handlers; args: never }) => {
  try {
    parentPort!.postMessage({ id, result: handlers[type](args) });
  } catch (e) {
    parentPort!.postMessage({ id, error: e instanceof Error ? e.stack : String(e) });
  }
});
