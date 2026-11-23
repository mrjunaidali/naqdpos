import { normalizePkMobile, SHOP_TYPES, type ShopType } from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api/index.ts';
import { useFailure } from './adminContext.ts';
import { InviteMessage } from './InviteMessage.tsx';
import { SHOP_TYPE_LABELS } from './labels.ts';
import { Alert, Button, Card, Field, Select } from './ui.tsx';

const EMPTY = {
  name: '',
  type: 'fruit_veg' as ShopType,
  city: '',
  address: '',
  phone: '',
  ownerName: '',
  ownerMobile: '',
  ownerEmail: '',
};
type Errors = Partial<Record<keyof typeof EMPTY, string>>;

/** US012: the admin creates a shop and invites its owner (matched later by the verified email). */
export function NewShopPage() {
  const fail = useFailure();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    shopId: string;
    name: string;
    email: string;
    mobile: string;
  }>();
  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const mobile = normalizePkMobile(form.ownerMobile);
    const email = form.ownerEmail.trim().toLowerCase();
    const next: Errors = {};
    if (!form.name.trim()) next.name = 'Shop name is required.';
    if (!form.ownerName.trim()) next.ownerName = "Owner's name is required.";
    if (!mobile) next.ownerMobile = 'Enter a Pakistani mobile, e.g. 0300 1234567.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.ownerEmail = 'Enter a valid email.';
    setErrors(next);
    if (Object.keys(next).length || !mobile) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.adminCreateShop({
        name: form.name.trim(),
        type: form.type,
        ...(form.city.trim() && { city: form.city.trim() }),
        ...(form.address.trim() && { address: form.address.trim() }),
        ...(form.phone.trim() && { phone: form.phone.trim() }),
        owner_name: form.ownerName.trim(),
        owner_mobile: mobile,
        owner_email: email,
      });
      setCreated({ shopId: r.shop_id, name: form.name.trim(), email, mobile });
    } catch (err) {
      setError(fail(err, 'Could not create the shop.'));
    } finally {
      setBusy(false);
    }
  }

  if (created)
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">Shop created</h1>
        <Card title={created.name}>
          <p>
            The owner is invited as <strong>{created.email}</strong>. The invite is valid for 14
            days and links when they first sign in with this email.
          </p>
          <InviteMessage shopName={created.name} email={created.email} mobile={created.mobile} />
          <div className="flex flex-wrap gap-2">
            <Link to={`/shops/${created.shopId}`} className="underline">
              Open the shop
            </Link>
            <Link to={`/shops/${created.shopId}/act`} className="underline">
              Act as shop: add products and staff
            </Link>
          </div>
        </Card>
      </section>
    );

  return (
    <section className="space-y-4">
      <Link to="/" className="underline">
        ← Shops
      </Link>
      <h1 className="text-2xl font-bold">New shop</h1>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <Card title="Shop">
          <Field
            label="Shop name"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            error={errors.name}
            maxLength={80}
          />
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => set('type')(e.target.value)}
            options={SHOP_TYPES.map((t) => [t, SHOP_TYPE_LABELS[t]] as const)}
          />
          <Field
            label="City"
            value={form.city}
            onChange={(e) => set('city')(e.target.value)}
            maxLength={60}
          />
          <Field
            label="Address"
            value={form.address}
            onChange={(e) => set('address')(e.target.value)}
            maxLength={200}
          />
          <Field
            label="Shop phone"
            value={form.phone}
            onChange={(e) => set('phone')(e.target.value)}
            maxLength={20}
            inputMode="tel"
          />
        </Card>
        <Card title="Owner">
          <Field
            label="Owner's name"
            value={form.ownerName}
            onChange={(e) => set('ownerName')(e.target.value)}
            error={errors.ownerName}
            maxLength={60}
          />
          <Field
            label="Owner's mobile"
            value={form.ownerMobile}
            onChange={(e) => set('ownerMobile')(e.target.value)}
            error={errors.ownerMobile}
            inputMode="tel"
            placeholder="0300 1234567"
          />
          <Field
            label="Owner's email"
            type="email"
            value={form.ownerEmail}
            onChange={(e) => set('ownerEmail')(e.target.value)}
            error={errors.ownerEmail}
          />
          <p className="text-sm text-muted">
            The owner signs in with this email (Google or an email code) and sets their own PIN.
          </p>
        </Card>
        <Button type="submit" disabled={busy}>
          Create shop and invite owner
        </Button>
      </form>
    </section>
  );
}
