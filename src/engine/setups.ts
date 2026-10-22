import { type Setup, parseSetup } from "./rules";
import scores from "./setups.json";

/** Each setup's engine score for white at the start (tools/setups.ts). */
export const SETUP_SCORES = scores as Record<string, number>;

/** Setups that aren't decided before they start: the ones a deep search calls roughly level. */
export const PLAYABLE_SETUPS: readonly string[] = Object.keys(SETUP_SCORES).filter((s) => Math.abs(SETUP_SCORES[s]!) <= 300);

export const randomSetup = (rng: () => number = Math.random): Setup =>
  parseSetup(PLAYABLE_SETUPS[Math.floor(rng() * PLAYABLE_SETUPS.length)]!);
