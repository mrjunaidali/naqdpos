import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => {
  vi.restoreAllMocks();
});

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The gate renders once Dexie answers, so wait for the form. */
async function openSignIn(path = '/sign-in') {
  const result = renderAt(path);
  await screen.findByLabelText('Email');
  return result;
}

async function reachCodeStep(email = 'ali@shop.pk') {
  mocked.sendSignInCode.mockResolvedValue({ success: true });
  await openSignIn();
  typeInto('Email', email);
  fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
  await screen.findByLabelText('6-digit code');
}

describe('sign-in with an email code', () => {
  it('sends a code, signs in, stores the bearer token and moves on to setup', async () => {
    mocked.signInWithCode.mockResolvedValue({
      token: 'bearer-123',
      user: { id: USER_ID, email: 'ali@shop.pk' },
    });
    mocked.me.mockResolvedValue(me());
    await reachCodeStep(' ali@shop.pk ');
    expect(mocked.sendSignInCode).toHaveBeenCalledWith('ali@shop.pk');
    expect(screen.getByText('We sent a 6-digit code to ali@shop.pk.')).toBeInTheDocument();

    typeInto('6-digit code', '12 34-56'); // non-digits are dropped as you type
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // No shop yet, so the app continues to onboarding.
    expect(await screen.findByRole('heading', { name: 'Set up your shop' })).toBeInTheDocument();
    expect(mocked.signInWithCode).toHaveBeenCalledWith('ali@shop.pk', '123456');
    expect(await getStoredSession()).toMatchObject({
      token: 'bearer-123',
      user_id: USER_ID,
      email: 'ali@shop.pk',
    });
  });

  it('says so when the code is wrong, and stores nothing', async () => {
    mocked.signInWithCode.mockRejectedValue(new ApiError(400, 'INVALID_OTP'));
    await reachCodeStep();
    typeInto('6-digit code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right');
    expect(await getStoredSession()).toBeUndefined();
  });

  it('explains an expired code and too many attempts', async () => {
    mocked.signInWithCode.mockRejectedValueOnce(new ApiError(400, 'OTP_EXPIRED'));
    mocked.signInWithCode.mockRejectedValueOnce(new ApiError(403, 'TOO_MANY_ATTEMPTS'));
    await reachCodeStep();
    typeInto('6-digit code', '111111');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts'));
  });

  it('checks the email and the code before calling the server', async () => {
    await openSignIn();
    typeInto('Email', 'not-an-email');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(mocked.sendSignInCode).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a short code without calling the server', async () => {
    await reachCodeStep();
    typeInto('6-digit code', '123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter the 6 digits from the email.')).toBeInTheDocument();
    expect(mocked.signInWithCode).not.toHaveBeenCalled();
  });

  it('can resend the code and go back to change the email', async () => {
    await reachCodeStep();
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(mocked.sendSignInCode).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(screen.getByLabelText('Email')).toHaveValue('ali@shop.pk');
  });

  it('uses a numeric one-time-code field', async () => {
    await reachCodeStep();
    const input = screen.getByLabelText('6-digit code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  });
});

describe('Google button', () => {
  it('is hidden when the API reports Google off', async () => {
    renderAt('/sign-in');
    await waitFor(() => expect(mocked.config).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
  });

  it('is hidden when the API cannot be reached', async () => {
    mocked.config.mockRejectedValue(new ApiError(0, 'network'));
    renderAt('/sign-in');
    await waitFor(() => expect(mocked.config).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
  });

  it('is shown when Google is on, and starts the redirect through the API', async () => {
    mocked.config.mockResolvedValue({ google: true });
    mocked.googleSignInUrl.mockResolvedValue('https://accounts.google.test/consent');
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      origin: 'https://pos.test',
      assign,
    });
    renderAt('/sign-in');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.google.test/consent'),
    );
    expect(mocked.googleSignInUrl).toHaveBeenCalledWith(
      'https://pos.test/auth/callback',
      'https://pos.test/sign-in',
    );
  });

  it('shows a message when Google sends the user back with an error', async () => {
    renderAt('/sign-in?error=access_denied');
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in did not finish');
  });
});

describe('offline', () => {
  it('explains that sign-in needs the internet and disables sending', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderAt('/sign-in');
    expect(await screen.findByText(/You are offline/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
  });

  it('shows the offline message when the request cannot reach the server', async () => {
    mocked.sendSignInCode.mockRejectedValue(new ApiError(0, 'network'));
    await openSignIn();
    typeInto('Email', 'ali@shop.pk');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No internet connection');
  });
});
