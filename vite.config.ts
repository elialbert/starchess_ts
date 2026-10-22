import { defineConfig } from "vite";

export default defineConfig({
  // Local builds are portable; Pages serves the site from /starchess_ts/.
  base: "./",
  server: { host: true },
  build: { target: "es2022", outDir: "dist" },
  worker: { format: "es" }
});
