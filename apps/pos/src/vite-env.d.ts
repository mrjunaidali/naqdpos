/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL, e.g. http://localhost:8787 (deployment §2). */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** apps/pos/package.json version, injected by vite.config.ts `define`. */
declare const __APP_VERSION__: string;
