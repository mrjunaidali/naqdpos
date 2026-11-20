import { ROLES, validateStaffForm, type StaffFormResult, type StaffRow } from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { db } from '../../db/schema.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { LastOwnerError, saveStaff, setStaffActive } from './staffRepo.ts';

/** /staff/new and /staff/:staffId (owner screen, US017). */
export function StaffFormPage() {
  const { staffId } = useParams();
  const existing = useLiveQuery(
    async () => (staffId ? ((await db.staff.get(staffId)) ?? null) : null),
    [staffId],
  );
  if (existing === undefined) return null;
  // Keyed so the form starts from the stored values without syncing state in an effect.
  return <StaffForm key={existing?.id ?? 'new'} existing={existing} />;
}

const ERROR_KEYS: Record<string, string> = {
  required: 'staff.errors.required',
  too_long: 'staff.errors.tooLong',
  invalid_mobile: 'onboarding.invalidMobile',
  invalid_role: 'staff.errors.role',
  invalid_pin: 'onboarding.invalidPin',
  pin_mismatch: 'onboarding.pinMismatch',
};

function StaffForm({ existing }: { existing: StaffRow | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const actor = useActingOwnerId();
  const roleId = useId();
  const isNew = existing === null;
  const [values, setValues] = useState({
    name: existing?.name ?? '',
    phone: existing?.phone ?? '',
    role: existing?.role ?? 'cashier',
    pin: '',
    pinConfirm: '',
  });
  const [errors, setErrors] = useState<StaffFormResult['errors']>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const set = (name: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [name]: e.target.value }));
  const errorText = (field: keyof StaffFormResult['errors']) => {
    const code = errors[field];
    return code ? t(ERROR_KEYS[code] ?? 'errors.generic') : undefined;
  };

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      void navigate('/staff');
    } catch (e) {
      setError(t(e instanceof LastOwnerError ? 'staff.errors.lastOwner' : 'errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateStaffForm(values, isNew);
    setErrors(result.errors);
    const value = result.value;
    if (!value) return;
    void run(() => saveStaff(existing, { ...value, active: existing?.active ?? true }, actor));
  }

  return (
    <form className="mx-auto max-w-md space-y-4" onSubmit={submit} noValidate>
      <h1 className="text-2xl font-bold">{isNew ? t('staff.addTitle') : t('staff.editTitle')}</h1>
      {error && <Alert>{error}</Alert>}
      {existing && !existing.active && <Alert tone="info">{t('staff.inactiveNotice')}</Alert>}
      <Field
        label={t('staff.name')}
        value={values.name}
        onChange={set('name')}
        error={errorText('name')}
        autoComplete="off"
        required
      />
      <Field
        label={t('staff.phone')}
        type="tel"
        inputMode="tel"
        dir="ltr"
        placeholder="0300 1234567"
        value={values.phone}
        onChange={set('phone')}
        error={errorText('phone')}
        hint={t('staff.phoneHint')}
      />
      <div className="space-y-1">
        <label htmlFor={roleId} className="block font-medium">
          {t('staff.role')}
        </label>
        <select
          id={roleId}
          value={values.role}
          onChange={set('role')}
          className="min-h-12 w-full rounded-md border border-border bg-surface px-3 text-lg"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`role.${role}`)}
            </option>
          ))}
        </select>
      </div>
      <Field
        label={t('staff.pin')}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={4}
        dir="ltr"
        value={values.pin}
        onChange={set('pin')}
        error={errorText('pin')}
        hint={isNew ? t('staff.pinHint') : t('staff.pinKeepHint')}
        required={isNew}
      />
      <Field
        label={t('staff.pinConfirm')}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={4}
        dir="ltr"
        value={values.pinConfirm}
        onChange={set('pinConfirm')}
        error={errorText('pinConfirm')}
        required={isNew}
      />
      <Button type="submit" disabled={busy}>
        {busy ? t('common.wait') : t('staff.save')}
      </Button>
      {existing && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => setStaffActive(existing, !existing.active, actor))}
        >
          {existing.active ? t('staff.deactivate') : t('staff.reactivate')}
        </Button>
      )}
    </form>
  );
}
