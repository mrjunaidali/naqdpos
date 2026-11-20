// This build's version (apps/pos/package.json, injected by vite.config.ts). Sent as X-App-Version
// on every API request (architecture §4).
export const APP_VERSION: string = __APP_VERSION__;
