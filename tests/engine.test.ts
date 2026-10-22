import { describe, expect, it } from "vitest";
import { makeRng } from "../src/engine/bots";
import { Engine, MATE, Position, moveFrom, moveTo, movePromo, toRulesMove } from "../src/engine/engine";
import { NPARAMS, baseWeights, evaluate } from "../src/engine/eval";
import { type GameState, applyMove, legalMoves, newGame, outcome, position } from "../src/engine/rules";

const key = (from: number, to: number, promo: number) => `${from}-${to}=${promo}`;

/** Random play-phase positions, for cross-checking. */
function* randomPositions(seed: number, games: number) {
  const rng = makeRng(seed);
  for (let i = 0; i < games; i++) {
    let g = newGame();
    while (!outcome(g)) {
      yield g;
      const ms = legalMoves(g);
      g = applyMove(g, ms[Math.floor(rng() * ms.length)]!);
    }
  }
}

function perftRules(g: GameState, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(g)) n += perftRules(applyMove(g, m), depth - 1);
  return n;
}
function perftEngine(e: Engine, pos: Position, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of e.rootMoves(pos)) {
    pos.make(m);
    n += perftEngine(e, pos, depth - 1);
    pos.unmake(m);
  }
  return n;
}

describe("engine move generation", () => {
  const engine = new Engine(baseWeights(), { ttBits: 10 });

  it("matches the rules module's legal moves in random positions", () => {
    let checked = 0;
    for (const g of randomPositions(3, 30)) {
      const pos = Position.fromGame(g);
      const mine = engine.rootMoves(pos).map((m) => key(moveFrom(m), moveTo(m), movePromo(m))).sort();
      const theirs = legalMoves(g).map((m) => key(m.from, m.to, m.promo & 7)).sort();
      expect(mine).toEqual(theirs);
      expect(pos.inCheck()).toBe(legalMoves(g).length >= 0 && pos.attacked(pos.king[g.turn]!, g.turn ^ 1));
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("perft matches and make/unmake restores the hash", () => {
    const g = newGame();
    const pos = Position.fromGame(g);
    const { lo, hi } = pos;
    expect(perftEngine(engine, pos, 3)).toBe(perftRules(g, 3));
    expect([pos.lo, pos.hi]).toEqual([lo, hi]);
  });

  it("hashes incrementally the same as from scratch", () => {
    for (const g of randomPositions(9, 5)) {
      const pos = Position.fromGame(g);
      for (const m of engine.rootMoves(pos)) {
        pos.make(m);
        const fresh = Position.fromGame(applyMove(g, toRulesMove(g, m)));
        expect([pos.lo, pos.hi]).toEqual([fresh.lo, fresh.hi]);
        pos.unmake(m);
      }
    }
  });
});

describe("evaluation", () => {
  it("is the dot product of weights and trace, and symmetric", () => {
    const w = baseWeights();
    for (const g of [...randomPositions(5, 3)].slice(0, 60)) {
      const pos = Position.fromGame(g);
      const trace = new Float64Array(NPARAMS);
      const e = evaluate(pos.cells, pos.side, w, trace);
      const dot = trace.reduce((s, t, i) => s + t * w[i]!, 0);
      expect(e).toBeCloseTo(pos.side ? -dot : dot, 6);
    }
  });
});

describe("engine search", () => {
  it("finds mate in one", () => {
    const g = position({ 34: "bK", 33: "bP", 4: "wK", 2: "wQ", 1: "wR" });
    const e = new Engine(baseWeights(), { ttBits: 16 });
    const r = e.run(Position.fromGame(g), { depth: 4 });
    expect(r.score).toBeGreaterThan(MATE - 10);
    expect(outcome(applyMove(g, toRulesMove(g, r.move)))?.reason).toBe("checkmate");
  });

  it("takes a free queen", () => {
    const g = position({ 4: "wK", 34: "bK", 19: "wN", 22: "bQ" });
    const r = new Engine(baseWeights(), { ttBits: 16 }).run(Position.fromGame(g), { nodes: 20000 });
    expect(moveTo(r.move)).toBe(22);
  });

  it("respects a node limit and leaves the position as it was", () => {
    const g = newGame();
    const pos = Position.fromGame(g);
    const before = [...pos.cells];
    const r = new Engine(baseWeights(), { ttBits: 16 }).run(pos, { nodes: 5000 });
    expect(r.nodes).toBeLessThanOrEqual(5001);
    expect([...pos.cells]).toEqual(before);
    expect(r.depth).toBeGreaterThan(1);
  });
});
