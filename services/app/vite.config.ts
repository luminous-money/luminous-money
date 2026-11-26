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
      // A new version waits for the app to take it in (src/web/lib/updates.ts): by itself when
      // nobody's working on anything, or at a reload.
      registerType: "prompt",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Luminous Money",
        short_name: "Luminous",
        description:
          "Double-entry accounting to manage your assets, expenses, goals, budgets and loans on mobile or desktop. Open source and self-hostable.",
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
        // Installed (as a WebAPK: Chrome, Edge or Samsung Internet on Android), the app is in the
        // share sheet: a photo or PDF shared to it opens Capture receipt with it
        // (public/share-target.js).
        share_target: {
          action: "/ui/share-receipt",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "receipt", accept: ["image/*", "application/pdf"] }] },
        },
      },
      workbox: {
        importScripts: ["share-target.js"],
        navigateFallback: "/ui/index.html",
        // The typeface's files too, so the installed app keeps its look offline.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
