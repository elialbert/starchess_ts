// CPU profile of the fixed-depth benchmark (tools/bench.ts): bundles it with
// esbuild, runs it under node --cpu-prof, and prints the functions with the
// most self time.
// Usage: npm run profile -- [depth=9]
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dir = join(ROOT, ".cache/profile");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: [join(ROOT, "tools/bench.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(dir, "bench.mjs"),
  logLevel: "warning"
});
execFileSync("node", ["--cpu-prof", `--cpu-prof-dir=${dir}`, join(dir, "bench.mjs"), process.argv[2] ?? "9"], { stdio: "inherit" });

const file = readdirSync(dir).find((f) => f.endsWith(".cpuprofile"));
const prof = JSON.parse(readFileSync(join(dir, file), "utf8"));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
prof.samples.forEach((id, i) => {
  const n = byId.get(id);
  const key = `${n.callFrame.functionName || "(anonymous)"}:${n.callFrame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (prof.timeDeltas[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log("\nself time (line numbers are in the bundle, .cache/profile/bench.mjs):");
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
