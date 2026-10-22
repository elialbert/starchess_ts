/// <reference lib="webworker" />
import { type BotId, type BotResult, chooseMove, makeRng } from "./bots";
import type { GameState } from "./rules";

export interface BotRequest {
  id: number;
  game: GameState;
  bot: BotId;
  /** seeds the bot's dice for this move */
  seed: number;
  /** seeds the bot's flavour for the whole game */
  gameSeed: number;
}
export interface BotResponse extends BotResult {
  id: number;
}

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, game, bot, seed, gameSeed } = e.data;
  const result = chooseMove(game, bot, makeRng(seed), gameSeed);
  self.postMessage({ id, ...result } satisfies BotResponse);
};
