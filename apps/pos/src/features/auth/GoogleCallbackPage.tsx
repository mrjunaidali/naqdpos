import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../../api/index.ts';
import { Alert } from '../../ui/Button.tsx';
import { SignInBlocked } from './SignInBlocked.tsx';
import { completeSignIn, type SignInOutcome } from './completeSignIn.ts';
import { takeOneTimeToken } from './oneTimeToken.ts';

/**
 * Google returns here through the API with a single-use token (apps/api/src/auth.ts). Trade it
 * for the bearer token once; the token is single-use, so a second attempt would fail.
 */
export function GoogleCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState<Exclude<SignInOutcome, { status: 'ok' }>>();

  useEffect(() => {
    // StrictMode runs effects twice in development; the token must be redeemed only once.
    if (started.current) return;
    started.current = true;
    const token = takeOneTimeToken();
    const exchange = token
      ? api.exchangeOneTimeToken(token)
      : Promise.reject(new Error('No one-time token in the callback URL'));
    exchange.then(
      async (result) => {
        const outcome = await completeSignIn(result);
        if (outcome.status === 'ok') void navigate('/', { replace: true });
        else setBlocked(outcome);
      },
      (e: unknown) =>
        setError(
          t(e instanceof ApiError && e.status === 0 ? 'errors.offline' : 'signIn.googleFailed'),
        ),
    );
  }, [navigate, t]);

  return (
    <section className="mx-auto max-w-sm space-y-4">
      {blocked ? (
        <SignInBlocked outcome={blocked} />
      ) : error ? (
        <>
          <Alert>{error}</Alert>
          <Link
            to="/sign-in"
            replace
            className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 text-primary-fg"
          >
            {t('signIn.backToSignIn')}
          </Link>
        </>
      ) : (
        <p role="status">{t('signIn.finishing')}</p>
      )}
    </section>
  );
}
