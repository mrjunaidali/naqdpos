// The app's one way to reach the backend (CLAUDE.md, Portability 3). The base URL comes only
// from VITE_API_URL; the token and device id come from Dexie, so calls work after a restart.
import { createApiClient } from '@naqdpos/core';
import { getStoredDevice, getStoredSession } from '../db/session.ts';

export { ApiError } from '@naqdpos/core';

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL,
  fetch: (url, init) => fetch(url, init),
  getToken: async () => (await getStoredSession())?.token ?? null,
  getDeviceId: async () => (await getStoredDevice())?.id ?? null,
});
