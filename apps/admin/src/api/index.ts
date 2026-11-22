// The admin portal's one way to reach the backend (CLAUDE.md, Portability 3). The base URL comes
// only from VITE_API_URL; the bearer token from sessionStorage.
import { createApiClient } from '@naqdpos/core';
import { getToken } from './session.ts';

export { ApiError } from '@naqdpos/core';

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL,
  fetch: (url, init) => fetch(url, init),
  getToken: () => getToken(),
});
