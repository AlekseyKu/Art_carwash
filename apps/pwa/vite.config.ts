import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  // Локально по умолчанию cloud-api :3002; опционально VITE_API_PROXY_TARGET=https://carwash-jd.ru
  const apiTarget = env.VITE_API_PROXY_TARGET?.trim() || "http://127.0.0.1:3002";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon-32.png", "logo/logo.jpeg", "logo/logo.png", "logo/logo-app.png", "pwa-192.png", "pwa-512.png"],
        manifest: {
          name: "Автомойка у ЖД",
          short_name: "Автомойка у ЖД",
          description: "Прайс, запись и личный кабинет автомойки в Ступино",
          theme_color: "#303236",
          background_color: "#303236",
          display: "standalone",
          lang: "ru",
          start_url: "/",
          icons: [
            {
              src: "/pwa-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts",
                expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              urlPattern: /\/api\/customer\/catalog$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "catalog",
                networkTimeoutSeconds: 5,
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@art/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      },
    },
    server: {
      port: 5174,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
