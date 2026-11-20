// The app's one way to reach the backend (CLAUDE.md, Portability 3). The base URL comes only
// from VITE_API_URL (on the dev server, empty or /api = the same-origin dev proxy, see baseUrl.ts);
// the token and device id come from Dexie, so calls work after a restart.
import { createApiClient } from '@naqdpos/core';
import { APP_VERSION } from '../app/version.ts';
import { getStoredDevice, getStoredSession } from '../db/session.ts';
import { apiBaseUrl } from './baseUrl.ts';

export { ApiError } from '@naqdpos/core';

const baseUrl = apiBaseUrl(
  import.meta.env.VITE_API_URL,
  import.meta.env.DEV,
  window.location.origin,
);

export const api = createApiClient({
  baseUrl,
  fetch: (url, init) => fetch(url, init),
  getToken: async () => (await getStoredSession())?.token ?? null,
  getDeviceId: async () => (await getStoredDevice())?.id ?? null,
  appVersion: APP_VERSION,
});

/**
 * A client that uses the given token instead of the stored session: checks a fresh sign-in (e.g. its
 * shops) before the session is replaced.
 */
export function apiWithToken(token: string) {
  return createApiClient({
    baseUrl,
    fetch: (url, init) => fetch(url, init),
    getToken: () => token,
    getDeviceId: async () => (await getStoredDevice())?.id ?? null,
    appVersion: APP_VERSION,
  });
}
