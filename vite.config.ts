import { defineConfig } from "vite";

// Static build for Cloudflare Pages: `npm run build` -> dist/
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    sourcemap: false,
  },
  server: { host: true },
});
