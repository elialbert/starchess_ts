import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works from any base path.
  base: "./",
  server: { host: true },
  build: { target: "es2022", outDir: "dist" },
  worker: { format: "es" }
});
