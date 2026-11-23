// The admin portal's one way to reach the backend (CLAUDE.md, Portability 3). The base URL comes
// only from VITE_API_URL (on the dev server, empty or /api = the same-origin dev proxy, as in pos:
// packages/core/src/api/baseUrl.ts); the bearer token from sessionStorage.
import { apiBaseUrl, createApiClient } from '@naqdpos/core';
import { getToken } from './session.ts';

export { ApiError } from '@naqdpos/core';

export const api = createApiClient({
  baseUrl: apiBaseUrl(import.meta.env.VITE_API_URL, import.meta.env.DEV, window.location.origin),
  fetch: (url, init) => fetch(url, init),
  getToken: () => getToken(),
});
