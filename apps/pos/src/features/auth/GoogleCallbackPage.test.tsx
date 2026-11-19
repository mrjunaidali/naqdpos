import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../api/index.ts';
import { getStoredSession } from '../../db/session.ts';
import { resetApiMock } from '../../test/apiMock.ts';
import { me, resetDb, USER_ID } from '../../test/fixtures.ts';
import { renderAt } from '../../test/render.tsx';

vi.mock('../../api/index.ts', () => import('../../test/apiMock.ts'));

const mocked = vi.mocked(api);

beforeEach(async () => {
  resetApiMock();
  await resetDb();
});

/** The app is opened at /auth/callback#ott=… by the API's redirect. */
function arriveWith(hash: string) {
  window.history.replaceState(null, '', `/auth/callback${hash}`);
  return renderAt('/auth/callback');
}

describe('Google sign-in callback', () => {
  it('trades the one-time token once, stores the session and clears the token from the URL', async () => {
    mocked.exchangeOneTimeToken.mockResolvedValue({
      token: 'bearer-from-google',
      user: { id: USER_ID, email: 'ali@gmail.com' },
    });
    mocked.me.mockResolvedValue(me());
    arriveWith('#ott=single-use-123');

    expect(await screen.findByRole('heading', { name: 'Set up your shop' })).toBeInTheDocument();
    expect(mocked.exchangeOneTimeToken).toHaveBeenCalledTimes(1);
    expect(mocked.exchangeOneTimeToken).toHaveBeenCalledWith('single-use-123');
    expect(window.location.hash).toBe('');
    expect(await getStoredSession()).toMatchObject({
      token: 'bearer-from-google',
      email: 'ali@gmail.com',
    });
  });

  it('shows an error without a token and does not call the server', async () => {
    arriveWith('');
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in did not finish');
    expect(mocked.exchangeOneTimeToken).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Back to sign-in' })).toBeInTheDocument();
  });

  it('shows an error when the token is used up or expired', async () => {
    mocked.exchangeOneTimeToken.mockRejectedValue(new ApiError(400, 'auth_error', 'Invalid token'));
    arriveWith('#ott=already-used');
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in did not finish');
    expect(window.location.hash).toBe('');
    await waitFor(async () => expect(await getStoredSession()).toBeUndefined());
  });
});
