import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../../api/index.ts';
import { useOnline } from '../../app/useOnline.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { errorMessageKey } from '../../ui/errors.ts';
import { Field } from '../../ui/Field.tsx';
import { SignInBlocked } from './SignInBlocked.tsx';
import { completeSignIn, type SignInOutcome } from './completeSignIn.ts';

type Step = 'email' | 'code';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Owner sign-in (architecture §5): email → 6-digit code, or Google when the API offers it. */
export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(
    params.get('error') ? t('signIn.googleFailed') : undefined,
  );
  const [fieldError, setFieldError] = useState<string>();
  const [google, setGoogle] = useState(false);
  const [blocked, setBlocked] = useState<Exclude<SignInOutcome, { status: 'ok' }>>();

  useEffect(() => {
    // Only show Google when the API has it configured; any failure just hides the button.
    api.config().then(
      (config) => setGoogle(config.google),
      () => setGoogle(false),
    );
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(t(errorMessageKey(e)));
    } finally {
      setBusy(false);
    }
  }

  function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL.test(trimmed)) {
      setFieldError(t('signIn.invalidEmail'));
      return;
    }
    setFieldError(undefined);
    void run(async () => {
      await api.sendSignInCode(trimmed);
      setEmail(trimmed);
      setCode('');
      setStep('code');
    });
  }

  function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) {
      setFieldError(t('signIn.invalidCode'));
      return;
    }
    setFieldError(undefined);
    void run(async () => {
      const outcome = await completeSignIn(await api.signInWithCode(email, code));
      if (outcome.status === 'ok') void navigate('/', { replace: true });
      else setBlocked(outcome);
    });
  }

  function signInWithGoogle() {
    void run(async () => {
      const origin = window.location.origin;
      const url = await api.googleSignInUrl(`${origin}/auth/callback`, `${origin}/sign-in`);
      window.location.assign(url);
    });
  }

  return (
    <section className="mx-auto max-w-sm space-y-5">
      <h1 className="text-2xl font-bold">{t('signIn.title')}</h1>
      {!online && <Alert tone="info">{t('signIn.offline')}</Alert>}
      {error && <Alert>{error}</Alert>}
      {blocked && <SignInBlocked outcome={blocked} />}

      {step === 'email' ? (
        <form className="space-y-4" onSubmit={sendCode} noValidate>
          <Field
            label={t('signIn.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError}
            required
          />
          <Button type="submit" disabled={busy || !online}>
            {busy ? t('common.wait') : t('signIn.sendCode')}
          </Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={verifyCode} noValidate>
          <p>{t('signIn.codeSent', { email })}</p>
          <Field
            label={t('signIn.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            dir="ltr"
            className="tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            error={fieldError}
            required
          />
          <Button type="submit" disabled={busy || !online}>
            {busy ? t('common.wait') : t('signIn.signIn')}
          </Button>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="link" onClick={() => sendCode()} disabled={busy || !online}>
              {t('signIn.resend')}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setStep('email');
                setError(undefined);
                setFieldError(undefined);
              }}
            >
              {t('signIn.changeEmail')}
            </Button>
          </div>
        </form>
      )}

      {google && step === 'email' && (
        <>
          <p className="text-center text-muted">{t('signIn.or')}</p>
          <Button variant="secondary" onClick={signInWithGoogle} disabled={busy || !online}>
            {t('signIn.google')}
          </Button>
        </>
      )}
    </section>
  );
}
