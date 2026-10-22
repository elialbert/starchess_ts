// Elo from a match score, with a 95% interval, and a sequential test (SPRT)
// for "is A better than B by elo1, rather than elo0?"

export interface Tally {
  wins: number;
  draws: number;
  losses: number;
}

export const games = (t: Tally) => t.wins + t.draws + t.losses;
const eloOf = (score: number) => -400 * Math.log10(1 / Math.min(Math.max(score, 1e-6), 1 - 1e-6) - 1);

export function elo(t: Tally): { elo: number; low: number; high: number; score: number } {
  const n = games(t);
  if (!n) return { elo: 0, low: -Infinity, high: Infinity, score: 0.5 };
  const score = (t.wins + t.draws / 2) / n;
  const variance = (t.wins * (1 - score) ** 2 + t.draws * (0.5 - score) ** 2 + t.losses * score ** 2) / n;
  const margin = 1.96 * Math.sqrt(variance / n);
  return { elo: eloOf(score), low: eloOf(score - margin), high: eloOf(score + margin), score };
}

/** Log-likelihood ratio of the GSPRT (normal approximation). */
export function llr(t: Tally, elo0: number, elo1: number): number {
  const n = games(t);
  if (!n || !t.wins || !t.losses) return 0;
  const score = (t.wins + t.draws / 2) / n;
  const variance = (t.wins * (1 - score) ** 2 + t.draws * (0.5 - score) ** 2 + t.losses * score ** 2) / n;
  const s0 = 1 / (1 + 10 ** (-elo0 / 400)), s1 = 1 / (1 + 10 ** (-elo1 / 400));
  return (n * ((score - s0) ** 2 - (score - s1) ** 2)) / (2 * variance);
}

/** SPRT bounds for 5% error each way. */
export const SPRT_BOUNDS = { lower: Math.log(0.05 / 0.95), upper: Math.log(0.95 / 0.05) };

export const fmtElo = (t: Tally) => {
  const e = elo(t);
  const f = (x: number) => (Number.isFinite(x) ? (x >= 0 ? "+" : "") + x.toFixed(0) : x > 0 ? "+inf" : "-inf");
  return `${f(e.elo)} [${f(e.low)}, ${f(e.high)}]`;
};
