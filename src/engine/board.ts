/**
 * The starchess board: 37 hexagonal spaces in a six-pointed star, numbered
 * 1–37 column by column from the left (as in the original Rails app). White
 * starts at the bottom and moves north; black starts at the top.
 */

export const DIRECTIONS = ["north", "northwest", "southwest", "south", "southeast", "northeast"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const N = 0, NW = 1, SW = 2, S = 3, SE = 4, NE = 5;

export const SPACE_COUNT = 37;

/** Neighbours of each space, indexed [north, northwest, southwest, south, southeast, northeast]. */
const SPACE_DEFS: Record<number, (number | null)[]> = {
  1: [null, null, null, null, 2, 3],
  2: [3, 1, null, null, 6, 7],
  3: [null, null, 1, 2, 7, 8],
  4: [5, null, null, null, null, 11],
  5: [6, null, null, 4, 11, 12],
  6: [7, 2, null, 5, 12, 13],
  7: [8, 3, 2, 6, 13, 14],
  8: [9, null, 3, 7, 14, 15],
  9: [10, null, null, 8, 15, 16],
  10: [null, null, null, 9, 16, null],
  11: [12, 5, 4, null, null, 17],
  12: [13, 6, 5, 11, 17, 18],
  13: [14, 7, 6, 12, 18, 19],
  14: [15, 8, 7, 13, 19, 20],
  15: [16, 9, 8, 14, 20, 21],
  16: [null, 10, 9, 15, 21, null],
  17: [18, 12, 11, null, 22, 23],
  18: [19, 13, 12, 17, 23, 24],
  19: [20, 14, 13, 18, 24, 25],
  20: [21, 15, 14, 19, 25, 26],
  21: [null, 16, 15, 20, 26, 27],
  22: [23, 17, null, null, 28, 29],
  23: [24, 18, 17, 22, 29, 30],
  24: [25, 19, 18, 23, 30, 31],
  25: [26, 20, 19, 24, 31, 32],
  26: [27, 21, 20, 25, 32, 33],
  27: [null, null, 21, 26, 33, 34],
  28: [29, 22, null, null, null, null],
  29: [30, 23, 22, 28, null, null],
  30: [31, 24, 23, 29, null, 35],
  31: [32, 25, 24, 30, 35, 36],
  32: [33, 26, 25, 31, 36, null],
  33: [34, 27, 26, 32, null, null],
  34: [null, null, 27, 33, null, null],
  35: [36, 31, 30, null, null, 37],
  36: [null, 32, 31, 35, 37, null],
  37: [null, 36, 35, null, null, null]
};

/** NEIGHBORS[space][dir]: the adjacent space id, or 0 off the board. Index 0 is unused. */
export const NEIGHBORS: readonly (readonly number[])[] = Array.from({ length: SPACE_COUNT + 1 }, (_, id) =>
  id === 0 ? [0, 0, 0, 0, 0, 0] : (SPACE_DEFS[id] ?? []).map((n) => n ?? 0)
);

export const OPPOSITE_DIR = [S, SE, NE, N, NW, SW] as const;

/** Axial (q, r) step for each direction on flat-topped hexes: q grows to the east, r to the south. */
export const AXIAL_STEP: readonly (readonly [number, number])[] = [
  [0, -1], // north
  [-1, 0], // northwest
  [-1, 1], // southwest
  [0, 1], // south
  [1, 0], // southeast
  [1, -1] // northeast
];

/** Axial (q, r) coordinates of every space, walked out from space 1 at (0, 0). */
export const AXIAL: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = Array.from({ length: SPACE_COUNT + 1 }, () => [NaN, NaN]);
  out[1] = [0, 0];
  const queue = [1];
  while (queue.length) {
    const id = queue.shift()!;
    const [q, r] = out[id]!;
    NEIGHBORS[id]!.forEach((n, d) => {
      if (!n || !Number.isNaN(out[n]![0])) return;
      const [dq, dr] = AXIAL_STEP[d]!;
      out[n] = [q + dq, r + dr];
      queue.push(n);
    });
  }
  return out;
})();

/** Pixel centre of a space for flat-topped hexes of circumradius `size`. */
export function hexCenter(id: number, size: number): [number, number] {
  const [q, r] = AXIAL[id]!;
  return [size * 1.5 * q, size * Math.sqrt(3) * (r + q / 2)];
}

/** Three-colouring of the hex grid, as on a Gliński board: 0, 1 or 2. */
export function hexShade(id: number): number {
  const [q, r] = AXIAL[id]!;
  return (((q - r) % 3) + 3) % 3;
}

/** The two directions a knight may turn to after heading in each direction. */
export const KNIGHT_TURNS: readonly (readonly number[])[] = [
  [NE, NW], // north
  [N, SW], // northwest
  [NW, S], // southwest
  [SW, SE], // south
  [S, NE], // southeast
  [SE, N] // northeast
];
