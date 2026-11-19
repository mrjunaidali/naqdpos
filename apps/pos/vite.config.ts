/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME_COLOR = '#15803d';

export default defineConfig({
  // One .env at the repo root for every app; Vite only exposes VITE_* names to the browser.
  envDir: '../..',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never auto-reload: the app shows its own "New version available" banner (architecture §6).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'NaqdPOS',
        short_name: 'NaqdPOS',
        description: 'Offline-first point of sale for small shops',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: THEME_COLOR,
        background_color: '#ffffff',
        lang: 'en',
        // Urdu switches `dir` at runtime; the manifest default stays ltr.
        dir: 'ltr',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the full app shell so the app opens offline on first launch after install.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,json,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
