import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Two pages: the landing page (index.html) and the reel (reel.html), the frame the demo video is
// recorded from, one scene at a time. Relative base, so the build works at any path (GitHub
// Pages serves it under /luminous-money/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), reel: resolve(__dirname, 'reel.html') } },
  },
  server: { host: '127.0.0.1', port: 5190, strictPort: true },
  preview: { host: '127.0.0.1', port: 5191, strictPort: true },
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'] },
})
