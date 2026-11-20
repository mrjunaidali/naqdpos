// Where the app's API client sends requests (CLAUDE.md, Portability 1: settings only).
//
// Production and normal builds: exactly VITE_API_URL, as before.
// Dev server only: when VITE_API_URL is empty or "/api", the API is reached through the Vite
// dev proxy on the page's own origin (`<origin>/api` → http://localhost:8787). A phone on the
// same Wi-Fi then never calls "localhost" (which would be the phone itself), there is no mixed
// http/https content, and no CORS is needed because the request is same-origin.

export const DEV_PROXY_PATH = '/api';

export function apiBaseUrl(envUrl: string | undefined, isDev: boolean, origin: string): string {
  const value = (envUrl ?? '').trim();
  if (isDev && (value === '' || value === DEV_PROXY_PATH)) return `${origin}${DEV_PROXY_PATH}`;
  return value;
}
