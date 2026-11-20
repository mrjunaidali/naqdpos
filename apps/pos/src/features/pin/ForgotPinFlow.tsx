import { isValidPin, type StaffRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/index.ts';
import { useOnline } from '../../app/useOnline.ts';
import { getStoredSession } from '../../db/session.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { resetPinWithCode, sendResetCode } from './forgotPin.ts';

const ERRORS: Record<string, string> = {
  invalid_code: 'forgotPin.wrongCode',
  code_expired: 'forgotPin.expired',
  too_many_attempts: 'forgotPin.tooManyAttempts',
  code_cooldown: 'forgotPin.cooldown',
  code_daily_cap: 'forgotPin.dailyCap',
};

function errorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'forgotPin.offline';
    return ERRORS[error.code] ?? 'errors.generic';
  }
  return 'errors.generic';
}

interface Props {
  staff: StaffRow;
  onDone: () => void;
  onCancel: () => void;
}

/** Email code → new PIN (owner only, online). */
export function ForgotPinFlow({ staff, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const email = useLiveQuery(async () => (await getStoredSession())?.email ?? '');
  const [step, setStep] = useState<'start' | 'code'>('start');
  const [values, setValues] = useState({ code: '', pin: '', pinConfirm: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    void run(async () => {
      await sendResetCode(staff.id);
      setStep('code');
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof fieldErrors = {};
    if (!/^[0-9]{6}$/.test(values.code)) found.code = t('signIn.invalidCode');
    if (!isValidPin(values.pin)) found.pin = t('onboarding.invalidPin');
    else if (values.pin !== values.pinConfirm) found.pinConfirm = t('onboarding.pinMismatch');
    setFieldErrors(found);
    if (Object.keys(found).length) return;
    void run(async () => {
      await resetPinWithCode(staff.id, values.code, values.pin);
      onDone();
    });
  }

  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value.replace(/[^0-9]/g, '') }));

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">{t('forgotPin.title', { name: staff.name })}</h3>
      {!online ? (
        <Alert tone="info">{t('forgotPin.offline')}</Alert>
      ) : (
        <>
          {error && <Alert>{error}</Alert>}
          {step === 'start' ? (
            <>
              <p className="text-muted">{t('forgotPin.intro', { email })}</p>
              <Button disabled={busy} onClick={send}>
                {busy ? t('common.wait') : t('forgotPin.send')}
              </Button>
            </>
          ) : (
            <form className="space-y-3" onSubmit={submit} noValidate>
              <p className="text-muted">{t('forgotPin.sent', { email })}</p>
              <Field
                label={t('signIn.code')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                dir="ltr"
                value={values.code}
                onChange={set('code')}
                error={fieldErrors.code}
              />
              <Field
                label={t('forgotPin.newPin')}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                dir="ltr"
                value={values.pin}
                onChange={set('pin')}
                error={fieldErrors.pin}
              />
              <Field
                label={t('onboarding.pinConfirm')}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                dir="ltr"
                value={values.pinConfirm}
                onChange={set('pinConfirm')}
                error={fieldErrors.pinConfirm}
              />
              <Button type="submit" disabled={busy}>
                {busy ? t('common.wait') : t('forgotPin.save')}
              </Button>
              <Button variant="link" disabled={busy} onClick={send}>
                {t('signIn.resend')}
              </Button>
            </form>
          )}
        </>
      )}
      <Button variant="secondary" onClick={onCancel}>
        {t('forgotPin.back')}
      </Button>
    </div>
  );
}
