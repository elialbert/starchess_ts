import type { BotRequest, BotResponse } from "../engine/bot.worker";
import type { BotId } from "../engine/bots";
import type { GameState } from "../engine/rules";

/** Runs the bots in a worker so the board keeps animating while they think. */
export class BotClient {
  private readonly worker = new Worker(new URL("../engine/bot.worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private readonly waiting = new Map<number, (r: BotResponse) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<BotResponse>) => {
      const resolve = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      resolve?.(e.data);
    };
  }

  request(game: GameState, bot: BotId, seed: number, styleSeed: number): Promise<BotResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, game, bot, seed, styleSeed } satisfies BotRequest);
    });
  }
}
