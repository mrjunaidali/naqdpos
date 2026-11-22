import type { AdminEnrollResponse } from '@naqdpos/core';
import { useEffect, useState, type FormEvent } from 'react';
import { renderSVG } from 'uqr';
import { api } from '../api/index.ts';
import { Alert, Button, Card, Field } from './ui.tsx';

/**
 * First sign-in of an admin without 2FA: scan the QR (drawn here, in the page: the secret never
 * leaves the browser), save the backup codes, then enter the first code.
 */
export function EnrollTwoFactor(props: {
  onDone: (token?: string) => void;
  onSignOut: () => void;
}) {
  const [data, setData] = useState<AdminEnrollResponse | null>(null);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api
      .adminEnrollTwoFactor()
      .then(setData)
      .catch(() => setError('Could not start two-factor setup.'));
  }, []);

  async function finish(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api.adminVerifyTwoFactor({ code: code.trim() });
      props.onDone(result.token);
    } catch {
      setError('That code is not right. Check the time on your phone and try again.');
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-bold">Set up two-factor sign-in</h1>
      <p className="text-muted">
        Admins need a code from an authenticator app every time they sign in.
      </p>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <Card title="1. Scan with your authenticator app">
            <div
              role="img"
              aria-label="QR code for the authenticator app"
              className="mx-auto w-56 bg-surface p-2 text-text"
              // Generated in the browser from the otpauth link (uqr); no network call.
              dangerouslySetInnerHTML={{ __html: renderSVG(data.totp_uri) }}
            />
            <p className="text-sm text-muted">Or type this key:</p>
            <code className="block break-all rounded-md bg-bg p-2 font-mono" data-testid="secret">
              {data.secret}
            </code>
          </Card>
          <Card title="2. Save your backup codes">
            <p className="text-sm text-muted">
              Each code works once if you lose your phone. Keep them somewhere safe.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono">
              {data.backup_codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
                className="size-5"
              />
              I have saved my backup codes
            </label>
          </Card>
          <Card title="3. Enter the code from the app">
            <form className="space-y-3" onSubmit={(e) => void finish(e)}>
              <Field
                label="6-digit code"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" disabled={!saved || !/^\d{6}$/.test(code.trim())}>
                Turn on two-factor
              </Button>
            </form>
          </Card>
        </>
      )}
      <Button variant="secondary" onClick={props.onSignOut}>
        Sign out
      </Button>
    </main>
  );
}

/** Every new admin session: a TOTP code, or a backup code. */
export function TwoFactorPrompt(props: {
  onDone: (token?: string) => void;
  onSignOut: () => void;
}) {
  const [backup, setBackup] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api.adminVerifyTwoFactor(
        backup ? { backup_code: value.trim() } : { code: value.trim() },
      );
      props.onDone(result.token);
    } catch {
      setError('That code is not right.');
    }
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-bold">Two-factor code</h1>
      {error && <Alert>{error}</Alert>}
      <form className="space-y-3" onSubmit={(e) => void submit(e)}>
        <Field
          label={backup ? 'Backup code' : 'Code from your authenticator app'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="one-time-code"
        />
        <Button type="submit" className="w-full" disabled={!value.trim()}>
          Continue
        </Button>
      </form>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => (setBackup(!backup), setValue(''))}
      >
        {backup ? 'Use the authenticator app' : 'Use a backup code'}
      </Button>
      <Button variant="secondary" className="w-full" onClick={props.onSignOut}>
        Sign out
      </Button>
    </main>
  );
}
