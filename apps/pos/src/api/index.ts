// The app's one way to reach the backend (CLAUDE.md, Portability 3). The base URL comes only
// from VITE_API_URL. Not used by features yet; sign-in will supply getToken.
import { createApiClient } from '@naqdpos/core';

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL,
  fetch: (url, init) => fetch(url, init),
});
