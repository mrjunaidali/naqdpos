import type { AdminSessionState } from '@naqdpos/core';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/index.ts';
import { getToken, setToken } from '../api/session.ts';
import { EnrollTwoFactor, TwoFactorPrompt } from './TwoFactor.tsx';
import { SignInPage } from './SignInPage.tsx';
import { Button } from './ui.tsx';

type Gate =
  | { kind: 'loading' }
  | { kind: 'signed_out'; message?: string }
  | { kind: 'state'; state: AdminSessionState; email: string };

/**
 * Admin sign-in (architecture §5): Google or email code, then TOTP every session; first sign-in
 * of an admin without 2FA enrols before anything else. Sessions end after 12 hours (401).
 */
export function AuthGate({
  children,
  message,
}: {
  children: (email: string, signOut: () => void) => ReactNode;
  /** Shown on the sign-in screen (e.g. after the session ended). */
  message?: string | undefined;
}) {
  // Without a token the sign-in screen shows straight away; with one, the server decides.
  const [gate, setGate] = useState<Gate>(() =>
    getToken()
      ? { kind: 'loading' }
      : message
        ? { kind: 'signed_out', message }
        : { kind: 'signed_out' },
  );

  const refresh = useCallback(async () => {
    if (!getToken())
      return setGate(message ? { kind: 'signed_out', message } : { kind: 'signed_out' });
    try {
      const me = await api.adminMe();
      if (me.state === 'session_expired' || me.state === 'no_session') {
        setToken(null);
        return setGate({ kind: 'signed_out', message: 'Your admin session ended. Sign in again.' });
      }
      setGate({ kind: 'state', state: me.state, email: me.email });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setToken(null);
        return setGate({ kind: 'signed_out', message: 'Your admin session ended. Sign in again.' });
      }
      setGate({ kind: 'signed_out', message: 'Could not reach the server.' });
    }
  }, [message]);

  useEffect(() => {
    if (!getToken()) return;
    // Checked once on mount; the result arrives asynchronously.
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const signOut = useCallback(() => {
    void api.signOut().catch(() => undefined);
    setToken(null);
    setGate({ kind: 'signed_out' });
  }, []);

  if (gate.kind === 'loading') return <p className="p-6 text-muted">Loading…</p>;
  if (gate.kind === 'signed_out') {
    return (
      <SignInPage
        {...(gate.message ? { message: gate.message } : {})}
        onSignedIn={(token) => {
          setToken(token);
          void refresh();
        }}
      />
    );
  }
  switch (gate.state) {
    case 'admin_required':
      return (
        <main className="mx-auto max-w-md space-y-4 p-6">
          <h1 className="text-2xl font-bold">Not an admin</h1>
          <p className="text-muted">{gate.email} is not a NaqdPOS system admin.</p>
          <Button onClick={signOut}>Sign out</Button>
        </main>
      );
    case 'two_factor_setup':
      return (
        <EnrollTwoFactor
          onDone={(token) => (token && setToken(token), void refresh())}
          onSignOut={signOut}
        />
      );
    case 'two_factor_required':
      return (
        <TwoFactorPrompt
          onDone={(token) => (token && setToken(token), void refresh())}
          onSignOut={signOut}
        />
      );
    case 'ok':
      return <>{children(gate.email, signOut)}</>;
    default:
      return <SignInPage onSignedIn={(token) => (setToken(token), void refresh())} />;
  }
}
