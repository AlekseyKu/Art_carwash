import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@art/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
      "/cloud-api": {
        target: "http://127.0.0.1:3002",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cloud-api/, ""),
      },
    },
  },
});
