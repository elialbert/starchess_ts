import { type GameState, type Outcome, WHITE, applyMove, legalMoves, moveLabel, newGame, outcome, parseSetup } from "../../src/engine/rules";
import { makeRng } from "../../src/engine/bots";
import type { Player } from "./players";

export interface GameRecord {
  setup: string;
  /** 1 white won, 0.5 draw, 0 black won */
  result: number;
  reason: Outcome["reason"] | "adjudicated";
  plies: number;
  moves: string[];
  /** every position played, as "turn:cells" keys, for training data */
  positions?: string[];
}

/**
 * One game between two players from a setup. Adjudicates a win when both
 * searching players agree the score is past ±`adjudicate` for 4 plies running.
 */
export function playGame(
  white: Player,
  black: Player,
  setup: string,
  seed: number,
  opts: { keepPositions?: boolean; adjudicate?: number; randomPlies?: number } = {}
): GameRecord {
  const rng = makeRng(seed ^ 0x5bd1e995);
  let g: GameState = newGame(parseSetup(setup));
  white.newGame(seed);
  black.newGame(seed + 1);
  const moves: string[] = [];
  const positions: string[] = [];
  const limit = opts.adjudicate ?? 1500;
  let streak = 0;
  for (;;) {
    const legal = legalMoves(g);
    const res = outcome(g, legal);
    if (res) {
      return { setup, result: res.winner === null ? 0.5 : res.winner === WHITE ? 1 : 0, reason: res.reason, plies: g.ply, moves, positions: opts.keepPositions ? positions : undefined };
    }
    if (opts.keepPositions && g.ply >= (opts.randomPlies ?? 0)) positions.push(`${g.turn}:${g.cells.join(",")}`);
    const mover = g.turn === WHITE ? white : black;
    const reply = g.ply < (opts.randomPlies ?? 0) ? { move: legal[Math.floor(rng() * legal.length)]! } : mover.play(g);
    // scores from white's point of view, for adjudication
    if ("score" in reply && reply.score !== undefined && Math.abs(reply.score) >= limit) {
      const whiteView = g.turn === WHITE ? reply.score : -reply.score;
      streak = streak !== 0 && Math.sign(streak) === Math.sign(whiteView) ? streak + Math.sign(whiteView) : Math.sign(whiteView);
      if (Math.abs(streak) >= 4) {
        return { setup, result: streak > 0 ? 1 : 0, reason: "adjudicated", plies: g.ply, moves, positions: opts.keepPositions ? positions : undefined };
      }
    } else streak = 0;
    const next = applyMove(g, reply.move);
    moves.push(moveLabel(reply.move, next));
    g = next;
  }
}
