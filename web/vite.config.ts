import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Cross-origin isolation lets onnxruntime-web use WASM threads (SharedArrayBuffer).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// The local API (`make serve`); the browser talks to it through this proxy in development.
const api = "http://127.0.0.1:8765";

export default defineConfig({
  base: "./",
  plugins: [react()],
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  server: {
    headers: isolation,
    proxy: { "/api": { target: api, changeOrigin: true } },
  },
  preview: {
    headers: isolation,
    proxy: { "/api": { target: api, changeOrigin: true } },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
});
