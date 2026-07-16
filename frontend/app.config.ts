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
      // NOTE: server.hmr options are not currently forwarded by vinxi to the
      // client router (BUGS.md: BUG-001) — HMR websocket fails behind the
      // Docker port mapping, so refresh manually after edits for now.
      watch: {
        // Windows bind mounts don't emit fs events.
        usePolling: true,
      },
    },
  },
});
