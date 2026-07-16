import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  ssr: true,
  server: {
    // Standalone node server output: .output/server/index.mjs
    preset: "node-server",
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Dev-only: proxy /api to the Rust backend container (same-origin, no CORS).
      proxy: {
        "/api": {
          target: process.env.WEFT_API_URL ?? "http://backend:8080",
          changeOrigin: true,
        },
      },
      watch: {
        // Windows bind mounts don't emit fs events.
        usePolling: true,
      },
    },
  },
});
