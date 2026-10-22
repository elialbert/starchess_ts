import { describe, expect, it } from "vitest";
import { AXIAL, AXIAL_STEP, NEIGHBORS, OPPOSITE_DIR, SPACE_COUNT, hexShade } from "../src/engine/board";

describe("board geometry", () => {
  it("has 37 spaces with distinct coordinates", () => {
    const keys = new Set<string>();
    for (let s = 1; s <= SPACE_COUNT; s++) {
      const [q, r] = AXIAL[s]!;
      expect(Number.isFinite(q) && Number.isFinite(r)).toBe(true);
      keys.add(`${q},${r}`);
    }
    expect(keys.size).toBe(37);
  });

  it("neighbours are symmetric and match the axial steps", () => {
    for (let s = 1; s <= SPACE_COUNT; s++) {
      NEIGHBORS[s]!.forEach((n, d) => {
        if (!n) return;
        expect(NEIGHBORS[n]![OPPOSITE_DIR[d]!]).toBe(s);
        const [dq, dr] = AXIAL_STEP[d]!;
        expect(AXIAL[n]).toEqual([AXIAL[s]![0] + dq, AXIAL[s]![1] + dr]);
      });
    }
  });

  it("every space that would be adjacent by coordinates is listed as a neighbour", () => {
    const at = new Map<string, number>();
    for (let s = 1; s <= SPACE_COUNT; s++) at.set(AXIAL[s]!.join(","), s);
    for (let s = 1; s <= SPACE_COUNT; s++) {
      AXIAL_STEP.forEach(([dq, dr], d) => {
        const n = at.get(`${AXIAL[s]![0] + dq},${AXIAL[s]![1] + dr}`) ?? 0;
        expect(NEIGHBORS[s]![d]).toBe(n);
      });
    }
  });

  it("three-colours the board", () => {
    for (let s = 1; s <= SPACE_COUNT; s++) {
      for (const n of NEIGHBORS[s]!) if (n) expect(hexShade(n)).not.toBe(hexShade(s));
    }
  });
});
