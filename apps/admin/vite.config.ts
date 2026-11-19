import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // One .env at the repo root for every app; Vite only exposes VITE_* names to the browser.
  envDir: '../..',
  plugins: [react(), tailwindcss()],
});
