import { type Weights, weightsFromJSON } from "./eval";
import tuned from "./weights.json";

export const DEFAULT_WEIGHTS: Weights = weightsFromJSON(tuned as Record<string, number>);
