import { type Weights, weightsFromJSON } from "./eval";
import tuned from "./weights.json";

/** The engine's evaluation weights: the hand-set base, overridden by whatever tools/texel.ts has tuned. */
export const DEFAULT_WEIGHTS: Weights = weightsFromJSON(tuned as Record<string, number>);
