import { hashPin, isValidPin, normalizePkMobile, type AdminCatalogue } from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { api } from '../api/index.ts';
import { useFailure } from '../app/adminContext.ts';
import { Alert, Button, Card, Field, Select } from '../app/ui.tsx';
import { useAct } from './actContext.ts';

type Staff = AdminCatalogue['staff'][number];
const EMPTY = { name: '', phone: '', role: 'cashier' as 'cashier' | 'rider', pin: '', pin2: '' };

/**
 * US013: add cashiers and riders, deactivate / reactivate. Owners come only through invites and
 * set their own PIN. A cashier PIN, if the admin sets one, is hashed here in the browser and is
 * marked "set by admin" in the audit log; the admin tells it to the owner.
 */
export function StaffPage() {
  const { shop, catalogue, reload } = useAct();
  const fail = useFailure();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'phone' | 'pin' | 'pin2', string>>>(
    {},
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function write(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(fail(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const phone = form.phone.trim() ? normalizePkMobile(form.phone) : null;
    if (!form.name.trim()) next.name = 'Required.';
    if (form.phone.trim() && !phone) next.phone = 'Enter a Pakistani mobile, e.g. 0300 1234567.';
    const withPin = form.role === 'cashier' && form.pin !== '';
    if (withPin && !isValidPin(form.pin)) next.pin = 'The PIN is 4 digits.';
    else if (withPin && form.pin !== form.pin2) next.pin2 = 'The PINs do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const ok = await write(
      async () =>
        api.adminSaveStaff(shop.id, {
          name: form.name.trim(),
          phone,
          role: form.role,
          ...(withPin && { pin_hash: await hashPin(form.pin) }),
        }),
      'Could not add the staff member.',
    );
    if (ok) setForm(EMPTY);
  }

  // admin_save_staff writes the whole row, so name, phone and role are sent unchanged.
  const setActive = (s: Staff, active: boolean) =>
    void write(
      () =>
        api.adminSaveStaff(shop.id, {
          id: s.id,
          name: s.name,
          phone: s.phone,
          role: s.role === 'rider' ? 'rider' : 'cashier',
          active,
        }),
      'Could not change the staff member.',
    );

  return (
    <Card title={`Staff (${catalogue.staff.length})`}>
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-border text-sm">
        {catalogue.staff.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="flex-1">{s.name}</span>
            <span>{s.role}</span>
            <span className="text-muted">{s.has_pin ? 'PIN set' : 'no PIN'}</span>
            {!s.active && <span className="text-muted">inactive</span>}
            {s.role === 'owner' ? (
              <span className="text-muted">owner (by invite)</span>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => setActive(s, !s.active)}>
                {s.active ? 'Deactivate' : 'Reactivate'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <h3 className="font-semibold sm:col-span-2">Add staff</h3>
        <Field
          label="Name"
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          error={errors.name}
        />
        <Field
          label="Mobile (optional)"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone')(e.target.value)}
          error={errors.phone}
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(e) => set('role')(e.target.value)}
          options={[
            ['cashier', 'Cashier'],
            ['rider', 'Rider'],
          ]}
        />
        {form.role === 'cashier' && (
          <Field
            label="PIN (optional, 4 digits; tell it to the owner)"
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={form.pin}
            onChange={(e) => set('pin')(e.target.value)}
            error={errors.pin}
          />
        )}
        {form.role === 'cashier' && form.pin && (
          <Field
            label="PIN again"
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            value={form.pin2}
            onChange={(e) => set('pin2')(e.target.value)}
            error={errors.pin2}
          />
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            Add staff member
          </Button>
        </div>
      </form>
    </Card>
  );
}
