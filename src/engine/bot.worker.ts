/// <reference lib="webworker" />
import { type BotId, type BotResult, chooseMove, makeRng, makeStyle } from "./bots";
import type { GameState } from "./rules";

export interface BotRequest {
  id: number;
  game: GameState;
  bot: BotId;
  /** seeds the bot's dice for this move */
  seed: number;
  /** seeds the bot's style for the whole game */
  styleSeed: number;
}
export interface BotResponse extends BotResult {
  id: number;
}

let styleFor: { seed: number; style: Int16Array } = { seed: NaN, style: new Int16Array(0) };

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, game, bot, seed, styleSeed } = e.data;
  if (styleFor.seed !== styleSeed) styleFor = { seed: styleSeed, style: makeStyle(makeRng(styleSeed)) };
  const result = chooseMove(game, bot, makeRng(seed), styleFor.style);
  self.postMessage({ id, ...result } satisfies BotResponse);
};
