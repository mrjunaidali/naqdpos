/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * `pnpm dev:lan` (scripts/dev-lan.ts) sets NAQDPOS_LAN=1: like apps/pos, the dev server then
 * listens on all interfaces with a self-signed HTTPS certificate so the portal opens on a phone on
 * the same Wi-Fi. Dev only: builds and the normal `pnpm dev` are unchanged.
 */
const lan = process.env.NAQDPOS_LAN === '1';
/** Where the dev proxy sends /api/* (the local API). */
const DEV_API_TARGET = process.env.NAQDPOS_DEV_API ?? 'http://localhost:8787';

export default defineConfig({
  // One .env at the repo root for every app; Vite only exposes VITE_* names to the browser.
  envDir: '../..',
  server: {
    // Fixed port (pos 5173, admin 5174): dev:lan prints these URLs.
    port: 5174,
    strictPort: true,
    ...(lan && { host: true }),
    // Dev only, same as apps/pos: /api/* → the local API, so the portal calls its own origin
    // (packages/core/src/api/baseUrl.ts). All request headers pass through.
    proxy: {
      '/api': {
        target: DEV_API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '') || '/',
        configure: (proxy) => {
          // Better Auth checks the Origin of sign-in requests; a phone's origin is not trusted, so
          // in dev the proxy presents the API's own origin. Production has no proxy.
          proxy.on('proxyReq', (req) => {
            if (req.getHeader('origin')) req.setHeader('origin', new URL(DEV_API_TARGET).origin);
          });
        },
      },
    },
  },
  plugins: [...(lan ? [basicSsl()] : []), react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    env: { VITE_API_URL: 'http://api.test', VITE_POS_URL: 'https://pos.test' },
  },
});
