/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { readFileSync } from 'node:fs';

const THEME_COLOR = '#15803d';
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

/**
 * `pnpm dev:lan` (scripts/dev-lan.ts) sets NAQDPOS_LAN=1: the dev server then listens on all
 * interfaces with a self-signed HTTPS certificate, so a phone on the same Wi-Fi gets a secure
 * context (WebCrypto PIN hashing, the service worker, storage.persist()). Dev only: builds and
 * the normal `pnpm dev` are unchanged.
 */
const lan = process.env.NAQDPOS_LAN === '1';
/** Where the dev proxy sends /api/* (the local API). */
const DEV_API_TARGET = process.env.NAQDPOS_DEV_API ?? 'http://localhost:8787';

export default defineConfig({
  // One .env at the repo root for every app; Vite only exposes VITE_* names to the browser.
  envDir: '../..',
  // App version for X-App-Version (architecture §4), from package.json at build time.
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    ...(lan && { host: true }),
    // Dev only: /api/* → the local API, so the app calls its own origin (src/api/baseUrl.ts).
    // Every request header (Authorization, X-Device-Id, X-App-Version) passes through as is.
    proxy: {
      '/api': {
        target: DEV_API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '') || '/',
        configure: (proxy) => {
          // Better Auth checks the Origin of sign-in requests against its trusted origins. A
          // phone's origin (https://192.168.x.x:5173) is not one of them, so in dev the proxy
          // presents the API's own origin, which Better Auth always trusts. Production has no
          // proxy and keeps APP_ORIGINS exactly as set.
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', new URL(DEV_API_TARGET).origin);
          });
        },
      },
    },
  },
  plugins: [
    ...(lan ? [basicSsl()] : []),
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
    // Tests never call a real API (the client is mocked), but the module needs a base URL.
    env: { VITE_API_URL: 'http://api.test' },
  },
});
