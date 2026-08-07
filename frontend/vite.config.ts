import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Production is served from an Nginx subpath; dev is served from the root. Everything that needs
// the prefix (router basename, manifest paths) reads import.meta.env.BASE_URL, so this is the one
// place it is declared.
const PROD_BASE = '/programs/moj-pcelinjak/'
const API_PORT = 3001

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? PROD_BASE : '/',

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Moj Pčelinjak',
        short_name: 'Pčelinjak',
        description: 'Digitalni dnevnik hrvatskog pčelara — košnice, obveze, proizvodnja.',
        lang: 'hr',
        theme_color: '#b45309',
        background_color: '#fdfaf3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: mode === 'production' ? PROD_BASE : '/',
        scope: mode === 'production' ? PROD_BASE : '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The API is never precached — a stale colony count is worse than no colony count.
        // Etapa 1 adds the Dexie outbox for offline writes; this only covers the app shell.
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],

  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
}))
