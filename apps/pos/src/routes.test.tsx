import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api/index.ts';
import { checkSession } from './app/sessionCheck.ts';
import { db } from './db/schema.ts';
import { readSyncState } from './sync/state.ts';
import { getStoredDevice, getStoredSession } from './db/session.ts';
import { i18n } from './i18n/index.ts';
import { resetApiMock } from './test/apiMock.ts';
import { resetDb, seedReady, seedSession } from './test/fixtures.ts';
import { renderAt } from './test/render.tsx';
import { ApiError } from '@naqdpos/core';

vi.mock('./api/index.ts', () => import('./test/apiMock.ts'));

const mocked = vi.mocked(api);

beforeEach(async () => {
  resetApiMock();
  await resetDb();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(() => i18n.changeLanguage('en'));
});

describe('routes and app state', () => {
  it('opens home straight away when signed in and registered, without the network', async () => {
    await seedReady();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { router } = renderAt('/');
    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Ali Fruit')).toBeInTheDocument();
    expect(await screen.findByText('This device: A1')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(mocked.me).not.toHaveBeenCalled();
    expect(mocked.getSession).not.toHaveBeenCalled();
  });

  it('sends a signed-out device to sign-in', async () => {
    const { router } = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('sends a signed-in device without a shop to setup', async () => {
    await seedSession();
    mocked.me.mockReturnValue(new Promise(() => {})); // still loading
    const { router } = renderAt('/');
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('keeps a signed-in user away from the sign-in page', async () => {
    await seedReady();
    const { router } = renderAt('/sign-in');
    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening)$/ }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('renders the not-found page for unknown paths', async () => {
    renderAt('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('switches the UI to Urdu (rtl) from the header button', async () => {
    await seedReady();
    renderAt('/');
    const button = await screen.findByRole('button', { name: 'Change language' });
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { name: /بخیر/ })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('daily session check', () => {
  const dayAgo = () => new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

  it('does nothing when checked within the last day', async () => {
    await seedSession();
    await checkSession();
    expect(mocked.getSession).not.toHaveBeenCalled();
  });

  it('keeps the session and marks it checked when the server confirms it', async () => {
    await seedSession({ checked_at: dayAgo() });
    mocked.getSession.mockResolvedValue({
      user: { id: 'u', email: 'ali@shop.pk' },
      session: { expiresAt: '2027-02-01T00:00:00.000Z' },
    });
    await checkSession();
    const session = await getStoredSession();
    expect(Date.now() - Date.parse(session!.checked_at)).toBeLessThan(60_000);
  });

  it.each([
    ['no longer knows the session', () => mocked.getSession.mockResolvedValue(null)],
    ['answers 401', () => mocked.getSession.mockRejectedValue(new ApiError(401, 'unauthorized'))],
  ])(
    'never signs out when the server %s: keeps session and data, asks to sign in again',
    async (_, arrange) => {
      await seedReady();
      await seedSession({ checked_at: dayAgo() });
      arrange();
      await checkSession();
      expect(await getStoredSession()).toBeDefined();
      expect(await getStoredDevice()).toBeDefined();
      expect((await readSyncState(db)).authProblem).toBe('auth_required');
    },
  );

  it('keeps the session when offline', async () => {
    await seedSession({ checked_at: dayAgo() });
    mocked.getSession.mockRejectedValue(new ApiError(0, 'network'));
    await checkSession();
    expect(await getStoredSession()).toBeDefined();
  });
});
