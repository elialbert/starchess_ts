// Player specs for the harness: "engine,nodes=20000,lmr=false,weights=tuning/w.json".
// The first token is the kind (engine | classic | magpie | random); the rest are
// key=value pairs: nodes, timeMs, depth, weights (a JSON file of eval weights),
// w.<weight name> (override one eval weight), name, jitter, impl (engine0: the
// frozen engine in tools/refs/engine0, for time-limited matches against older
// code), and anything else goes to the engine's SearchOptions.
import { readFileSync } from "node:fs";
import { type Rng, chooseMove, makeRng, makeStyle, search } from "../../src/engine/bots";
import { DEFAULT_OPTIONS, Engine, type Limits, Position, type SearchOptions, toRulesMove } from "../../src/engine/engine";
import { PARAM_NAMES, weightsFromJSON } from "../../src/engine/eval";
import { DEFAULT_WEIGHTS } from "../../src/engine/weights";
import * as engine0 from "../refs/engine0/engine";
import * as engine0Eval from "../refs/engine0/eval";
import { DEFAULT_WEIGHTS as ENGINE0_WEIGHTS } from "../refs/engine0/weights";
import { type GameState, type Move, WHITE } from "../../src/engine/rules";

export interface PlayerSpec {
  name: string;
  kind: "engine" | "classic" | "magpie" | "random";
  limits: Limits;
  weights?: string;
  /** which engine code to play: the current one, or a frozen reference */
  impl: "src" | "engine0";
  /** individual eval weights to override, by name ("w.val[2]=480") */
  overrides: Record<string, number>;
  opts: Partial<SearchOptions>;
  /** vary the node budget per move by ±this fraction, so repeated pairings differ */
  jitter: number;
}

export function parseSpec(text: string): PlayerSpec {
  const [kind, ...rest] = text.split(",");
  const spec: PlayerSpec = { name: text, kind: kind as PlayerSpec["kind"], limits: {}, overrides: {}, opts: {}, jitter: 0.1, impl: "src" };
  if (!["engine", "classic", "magpie", "random"].includes(spec.kind)) throw new Error(`unknown player kind ${kind}`);
  for (const kv of rest) {
    const [k, v = ""] = kv.split("=");
    const num = Number(v);
    const val = v === "true" ? true : v === "false" ? false : Number.isFinite(num) && v !== "" ? num : v;
    if (k === "nodes" || k === "timeMs" || k === "depth") spec.limits[k] = val as number;
    else if (k === "weights") spec.weights = v;
    else if (k === "name") spec.name = v;
    else if (k === "jitter") spec.jitter = val as number;
    else if (k === "impl") {
      if (v !== "src" && v !== "engine0") throw new Error(`unknown engine impl ${v}`);
      spec.impl = v;
    } else if (k!.startsWith("w.")) spec.overrides[k!.slice(2)] = Number(v);
    else if (k! in DEFAULT_OPTIONS) (spec.opts as Record<string, unknown>)[k!] = val;
    else throw new Error(`unknown player option ${k}`);
  }
  const names = spec.impl === "engine0" ? engine0Eval.PARAM_NAMES : PARAM_NAMES;
  for (const n in spec.overrides) if (!names.includes(n)) throw new Error(`unknown eval weight ${n}`);
  if (spec.kind === "engine" && !spec.limits.nodes && !spec.limits.timeMs && !spec.limits.depth) spec.limits.nodes = 20000;
  if (spec.kind === "classic" && !spec.limits.timeMs) spec.limits.timeMs = 100;
  return spec;
}

export interface Reply {
  move: Move;
  /** for the side to move, in centipawns, if the player searched */
  score?: number;
  depth?: number;
  nodes?: number;
}

export interface Player {
  spec: PlayerSpec;
  newGame(seed: number): void;
  play(g: GameState): Reply;
}

const weightCache = new Map<string, Float64Array>();
export function loadWeights(path?: string, impl: PlayerSpec["impl"] = "src") {
  if (!path) return impl === "engine0" ? ENGINE0_WEIGHTS : DEFAULT_WEIGHTS;
  const key = impl + ":" + path;
  const fromJSON = impl === "engine0" ? engine0Eval.weightsFromJSON : weightsFromJSON;
  if (!weightCache.has(key)) weightCache.set(key, fromJSON(JSON.parse(readFileSync(path, "utf8"))));
  return weightCache.get(key)!;
}

/** An engine of either implementation, and a function to search a game state with it. */
function newEngine(impl: PlayerSpec["impl"], weights: Float64Array, opts: Partial<SearchOptions>) {
  if (impl === "engine0") {
    const e = new engine0.Engine(weights, opts);
    const think = (g: GameState, l: Limits) => {
      const r = e.run(engine0.Position.fromGame(g), l);
      return { ...r, move: engine0.toRulesMove(g, r.move) };
    };
    return { engine: e, think };
  }
  const e = new Engine(weights, opts);
  const think = (g: GameState, l: Limits) => {
    const r = e.run(Position.fromGame(g), l);
    return { ...r, move: toRulesMove(g, r.move) };
  };
  return { engine: e, think };
}

export function makePlayer(spec: PlayerSpec): Player {
  let rng: Rng = makeRng(1);
  let seed = 0;
  if (spec.kind === "engine") {
    let weights = loadWeights(spec.weights, spec.impl);
    if (Object.keys(spec.overrides).length) {
      const names = spec.impl === "engine0" ? engine0Eval.PARAM_NAMES : PARAM_NAMES;
      weights = Float64Array.from(weights);
      for (const [n, x] of Object.entries(spec.overrides)) weights[names.indexOf(n)] = x;
    }
    const { engine, think } = newEngine(spec.impl, weights, { ttBits: 18, ...spec.opts });
    return {
      spec,
      newGame(s) {
        seed = s;
        rng = makeRng(s);
        engine.newGame();
        engine.opts.seed = s;
      },
      play(g) {
        const limits = { ...spec.limits };
        if (limits.nodes) limits.nodes = Math.round(limits.nodes * (1 + spec.jitter * (rng() * 2 - 1)));
        const r = think(g, limits);
        return { move: r.move, score: r.score, depth: r.depth, nodes: r.nodes };
      }
    };
  }
  return {
    spec,
    newGame(s) {
      seed = s;
      rng = makeRng(s);
    },
    play(g) {
      if (spec.kind === "classic") {
        const r = search(g, spec.limits.timeMs!, rng, makeStyle(makeRng(seed)), spec.limits.depth);
        return { move: r.move, score: g.turn === WHITE ? r.score : -r.score!, depth: r.depth, nodes: r.nodes };
      }
      return chooseMove(g, spec.kind as "random" | "magpie", rng, seed);
    }
  };
}
