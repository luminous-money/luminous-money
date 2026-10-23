import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// The PWA is served under /ui by the app service. In development, `pnpm dev` proxies /api to a
// running stack (LUMINOUS_MONEY_URL, default http://localhost:8080).
export default defineConfig({
  base: "/ui/",
  build: { outDir: "dist/web", emptyOutDir: true },
  test: { include: ["src/**/*.test.ts"] },
  server: {
    proxy: { "/api": process.env.LUMINOUS_MONEY_URL ?? "http://localhost:8080" },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Luminous Money",
        short_name: "Luminous",
        description: "Fast review and categorization for double-entry books.",
        start_url: "/ui/",
        scope: "/ui/",
        display: "standalone",
        background_color: "#efefef",
        theme_color: "#0062a8",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/ui/index.html",
      },
    }),
  ],
});
