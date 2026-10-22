// A pool of worker threads running tools/lib/worker.ts, bundled with esbuild
// so plain node can run it.
import { build } from "esbuild";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Handlers } from "./worker";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export class Pool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { type: string; args: unknown; resolve: (r: unknown) => void; reject: (e: Error) => void }[] = [];
  private pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void; worker: Worker }>();
  private nextId = 1;

  static async start(threads = Math.max(1, availableParallelism() - 2)): Promise<Pool> {
    const outfile = `${ROOT}/.cache/harness-worker.mjs`;
    await build({
      entryPoints: [`${ROOT}/tools/lib/worker.ts`],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile,
      logLevel: "warning"
    });
    const pool = new Pool();
    for (let i = 0; i < threads; i++) {
      const w = new Worker(outfile);
      w.on("message", ({ id, result, error }) => {
        const p = pool.pending.get(id)!;
        pool.pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(result);
        pool.idle.push(w);
        pool.pump();
      });
      w.on("error", (e) => {
        for (const [id, p] of pool.pending) if (p.worker === w) (pool.pending.delete(id), p.reject(e));
      });
      pool.workers.push(w);
      pool.idle.push(w);
    }
    return pool;
  }

  get size() {
    return this.workers.length;
  }

  run<K extends keyof Handlers>(type: K, args: Parameters<Handlers[K]>[0]): Promise<ReturnType<Handlers[K]>> {
    return new Promise((resolve, reject) => {
      this.queue.push({ type, args, resolve: resolve as (r: unknown) => void, reject });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const t = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, { resolve: t.resolve, reject: t.reject, worker: w });
      w.postMessage({ id, type: t.type, args: t.args });
    }
  }

  /** Drop queued work that hasn't started. */
  clearQueue() {
    this.queue.length = 0;
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
