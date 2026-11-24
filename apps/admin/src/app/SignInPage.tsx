import { useEffect, useState, type FormEvent } from 'react';
import { EMAIL_SEND_FAILED } from '@naqdpos/core';
import { api, ApiError } from '../api/index.ts';
import { Alert, Button, Field } from './ui.tsx';

/** Google (when the API has it) or an email code. 2FA follows in AuthGate. */
export function SignInPage(props: { onSignedIn: (token: string) => void; message?: string }) {
  const [google, setGoogle] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>(props.message);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .config()
      .then((c) => setGoogle(c.google))
      .catch(() => setGoogle(false));
  }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.sendSignInCode(email.trim());
      setSent(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === EMAIL_SEND_FAILED
          ? "Couldn't send the code, try again."
          : 'Could not send the code. Check the email address.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.signInWithCode(email.trim(), code.trim());
      props.onSignedIn(result.token);
    } catch {
      setError('That code is not right or has expired.');
    } finally {
      setBusy(false);
    }
  }

  async function withGoogle() {
    const back = `${window.location.origin}/auth/callback`;
    window.location.href = await api.googleSignInUrl(back, back);
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-bold">NaqdPOS Admin</h1>
      {error && <Alert>{error}</Alert>}
      {google && (
        <Button className="w-full" variant="secondary" onClick={() => void withGoogle()}>
          Continue with Google
        </Button>
      )}
      {!sent ? (
        <form className="space-y-3" onSubmit={(e) => void send(e)}>
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
            Email me a code
          </Button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={(e) => void verify(e)}>
          <Field
            label="Code from the email"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
          <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
            Sign in
          </Button>
        </form>
      )}
    </main>
  );
}
