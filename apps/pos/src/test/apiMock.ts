// Stand-in for src/api/index.ts in component tests:
//   vi.mock('../api/index.ts', () => import('../test/apiMock.ts'));
// Tests then import { api } from the real path and get these mocks, typed as the real client.
import type { ApiClient } from '@naqdpos/core';
import { vi, type Mock } from 'vitest';

export { ApiError } from '@naqdpos/core';

export const api = {
  health: vi.fn(),
  config: vi.fn(),
  sendSignInCode: vi.fn(),
  signInWithCode: vi.fn(),
  googleSignInUrl: vi.fn(),
  exchangeOneTimeToken: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  me: vi.fn(),
  createShop: vi.fn(),
  registerDevice: vi.fn(),
  setDeviceMode: vi.fn(),
  syncPush: vi.fn(),
  syncPull: vi.fn(),
} satisfies Record<keyof ApiClient, Mock>;

/** apiWithToken(token) returns the same mocks; check which token was used via its calls. */
export const apiWithToken = vi.fn<(token: string) => typeof api>(() => api);

/** Clears calls and sets safe defaults: Google off, every other call unanswered. */
export function resetApiMock(): void {
  for (const fn of Object.values(api)) fn.mockReset();
  api.config.mockResolvedValue({ google: false });
  for (const [name, fn] of Object.entries(api)) {
    if (name !== 'config') fn.mockRejectedValue(new Error(`api.${name} not mocked`));
  }
}
