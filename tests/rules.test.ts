import { describe, expect, it } from "vitest";
import { MIRROR_V } from "../src/engine/board";
import {
  ALL_SETUPS,
  BLACK,
  KING,
  KNIGHT,
  KNIGHT_TARGETS,
  type Move,
  WHITE,
  applyMove,
  inCheck,
  legalMoves,
  moveLabel,
  newGame,
  outcome,
  parseSetup,
  piece,
  position,
  setupName
} from "../src/engine/rules";

const targets = (moves: Move[], from: number) => moves.filter((m) => m.from === from).map((m) => m.to).sort((a, b) => a - b);

describe("setups", () => {
  it("there are 120, and black mirrors white", () => {
    expect(new Set(ALL_SETUPS.map(setupName)).size).toBe(120);
    const g = newGame(parseSetup("NBKRQ"));
    expect(g.cells[4]).toBe(piece(KNIGHT, WHITE));
    expect(g.cells[10]).toBe(piece(KNIGHT, BLACK));
    expect(g.cells[17]).toBe(piece(KING, WHITE));
    expect(g.cells[21]).toBe(piece(KING, BLACK));
    expect(g.cells.filter(Boolean)).toHaveLength(20);
    for (let s = 1; s <= 37; s++) {
      const p = g.cells[s]!;
      const q = g.cells[MIRROR_V[s]!]!;
      expect(p ? p ^ 8 : 0).toBe(q);
    }
  });
});

describe("piece moves", () => {
  it("pawns step, double-step from the start and capture diagonally forward", () => {
    expect(targets(legalMoves(newGame()), 12)).toEqual([13, 14]);
    // 13 is blocked by 14, can take on 19 (northeast) but not its own piece on 7 (northwest)
    const g = position({ 13: "wP", 14: "bP", 19: "bP", 7: "wN", 4: "wK", 34: "bK" });
    expect(targets(legalMoves(g), 13)).toEqual([19]);
  });

  it("white pawns promote on black's back spaces", () => {
    const g = position({ 15: "wP", 4: "wK", 34: "bK" });
    const promos = legalMoves(g).filter((m) => m.from === 15);
    expect(promos.map((m) => m.to)).toEqual([16, 16, 16, 16]);
    expect(promos.every((m) => m.promo)).toBe(true);
  });

  it("rooks slide north/south and take one quiet diagonal step", () => {
    const g = position({ 19: "wR", 4: "wK", 34: "bK", 21: "bP" });
    // north 20, 21 (capture); south 18, 17; diagonals 14, 13, 24, 25
    expect(targets(legalMoves(g), 19)).toEqual([13, 14, 17, 18, 20, 21, 24, 25]);
  });

  it("rooks can't capture diagonally", () => {
    const g = position({ 19: "wR", 4: "wK", 34: "bK", 14: "bP" });
    expect(targets(legalMoves(g), 19)).not.toContain(14);
  });

  it("knights have twelve jumps from the centre, and every jump can be reversed", () => {
    expect(KNIGHT_TARGETS[19]).toEqual([2, 3, 5, 9, 11, 16, 22, 27, 29, 33, 35, 36]);
    KNIGHT_TARGETS.forEach((ts, from) => ts.forEach((to) => expect(KNIGHT_TARGETS[to]).toContain(from)));
  });

  it("kings may not step into attack", () => {
    const g = position({ 4: "wK", 27: "bQ", 10: "bK" });
    for (const m of legalMoves(g)) {
      const after = applyMove(g, m);
      expect(inCheck(after.cells, WHITE)).toBe(false);
    }
  });
});

describe("game end", () => {
  it("detects checkmate", () => {
    // the queen on 3 checks along the diagonal 8-15-21-27-34, which also covers the king's only flight
    const g = position({ 34: "bK", 33: "bP", 4: "wK", 3: "wQ" }, BLACK);
    expect(outcome(g)).toEqual({ winner: WHITE, reason: "checkmate" });
  });

  it("calls bare kings a draw", () => {
    expect(outcome(position({ 4: "wK", 34: "bK" }))?.reason).toBe("bare kings");
  });

  it("notates moves", () => {
    const g = newGame();
    const m = legalMoves(g).find((m) => m.from === 12 && m.to === 14)!;
    expect(moveLabel(m, applyMove(g, m))).toBe("12-14");
  });

  it("calls threefold repetition a draw", () => {
    let g = position({ 4: "wK", 34: "bK", 17: "wR", 21: "bR" });
    const shuffle = [
      [4, 5],
      [34, 33],
      [5, 4],
      [33, 34]
    ];
    for (let i = 0; i < 2; i++) {
      for (const [from, to] of shuffle) g = applyMove(g, legalMoves(g).find((m) => m.from === from && m.to === to)!);
    }
    expect(outcome(g)?.reason).toBe("repetition");
  });
});
