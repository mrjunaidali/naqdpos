/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL, e.g. http://localhost:8787 (deployment §2). */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
