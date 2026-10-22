import { describe, expect, it } from "vitest";
import { BOTS, type BotId, chooseMove, makeRng, makeStyle, search } from "../src/engine/bots";
import { applyMove, legalMoves, outcome, position, newGame, sameMove, WHITE } from "../src/engine/rules";

function playOut(white: BotId, black: BotId, seed: number) {
  const rng = makeRng(seed);
  let g = newGame();
  for (;;) {
    const moves = legalMoves(g);
    const res = outcome(g, moves);
    if (res) return { g, res };
    const r = chooseMove(g, g.turn === WHITE ? white : black, rng);
    expect(moves.some((m) => sameMove(m, r.move))).toBe(true);
    g = applyMove(g, r.move);
  }
}

describe("bots", () => {
  it("random vs random games always finish", () => {
    for (let seed = 1; seed <= 20; seed++) expect(playOut("random", "random", seed).res).toBeTruthy();
  });

  it("magpie beats random most of the time", () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) if (playOut("magpie", "random", seed).res.winner === WHITE) wins++;
    expect(wins).toBeGreaterThanOrEqual(12);
  });

  it("search finds a mate in one", () => {
    // black king boxed in at 34 (neighbours 27, 33); Q2-3 is the only mate
    const g = position({ 34: "bK", 33: "bP", 4: "wK", 2: "wQ", 1: "wR" });
    const r = search(g, 500, makeRng(1));
    const after = applyMove(g, r.move);
    const res = outcome(after);
    expect(res?.reason).toBe("checkmate");
  });

  it("search takes a free queen", () => {
    const g = position({ 4: "wK", 34: "bK", 19: "wN", 22: "bQ" });
    const r = search(g, 300, makeRng(1), makeStyle(makeRng(2)));
    expect(r.move.to).toBe(22);
  });

  it("every quick bot can play a whole game", () => {
    for (const b of BOTS.filter((b) => !b.timeMs)) expect(playOut(b.id, b.id, 7).res).toBeTruthy();
  });

  it("the engine bots return legal moves with a score", () => {
    const g = newGame();
    const r = chooseMove(g, "tactician", makeRng(1), 5);
    expect(legalMoves(g).some((m) => sameMove(m, r.move))).toBe(true);
    expect(r.depth).toBeGreaterThan(2);
  });
});
