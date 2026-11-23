import {
  PRODUCT_UNITS,
  validateProductForm,
  type AdminCatalogueProduct,
  type ProductFormError,
} from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { api } from '../api/index.ts';
import { useFailure } from '../app/adminContext.ts';
import { Alert, Button, Card, Field, Select } from '../app/ui.tsx';
import { rupees, useAct } from './actContext.ts';

const ERROR_TEXT: Record<ProductFormError, string> = {
  required: 'Required.',
  too_long: 'Too long.',
  invalid_unit: 'Choose a unit.',
  invalid: 'Enter a number, e.g. 120 or 120.50.',
  negative: 'Cannot be negative.',
  too_many: 'At most 20 search words.',
  invalid_icon: 'Use one emoji (or leave empty).',
  invalid_qty: 'Invalid quantity.',
  too_large: 'Too large.',
};

/** US013: the shop's products as the admin sees them (cost prices included; hide / restore). */
export function ProductsPage() {
  const { shop, catalogue, reload } = useAct();
  const fail = useFailure();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminCatalogueProduct | 'new' | null>(null);
  const [error, setError] = useState<string>();
  const categoryName = new Map(catalogue.categories.map((c) => [c.id, c.name]));
  const q = query.trim().toLowerCase();
  const shown = catalogue.products.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.name_ur ?? '').includes(q) ||
      p.search_terms.some((t) => t.toLowerCase().includes(q)),
  );

  async function hide(p: AdminCatalogueProduct) {
    setError(undefined);
    try {
      await api.adminHideProduct(shop.id, p.id, !p.hidden);
      await reload();
    } catch (e) {
      setError(fail(e, 'Could not change the product.'));
    }
  }

  if (editing)
    return (
      <ProductForm product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
    );

  return (
    <Card title={`Products (${catalogue.products.length})`}>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Search products"
          placeholder="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 flex-1 rounded-md border border-border bg-surface px-3"
        />
        <Button onClick={() => setEditing('new')}>Add product</Button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No products yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="w-6 text-center">{p.icon ?? ''}</span>
              <span className="flex-1">
                <span className="font-semibold">{p.name}</span>
                {p.name_ur && (
                  <span lang="ur" dir="rtl" className="ms-2">
                    {p.name_ur}
                  </span>
                )}
                <span className="ms-2 text-muted">
                  {p.category_id ? categoryName.get(p.category_id) : 'No category'}
                </span>
              </span>
              <span>
                {rupees(p.sale_price_paisa)} / {p.unit}
              </span>
              <span className="text-muted">
                cost {p.cost_price_paisa === null ? '—' : rupees(p.cost_price_paisa)}
              </span>
              {p.hidden && <span className="rounded-full bg-bg px-2 text-muted">hidden</span>}
              <Button variant="secondary" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => void hide(p)}>
                {p.hidden ? 'Restore' : 'Hide'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProductForm({
  product,
  onDone,
}: {
  product: AdminCatalogueProduct | null;
  onDone: () => void;
}) {
  const { shop, catalogue, reload } = useAct();
  const fail = useFailure();
  const [form, setForm] = useState({
    name: product?.name ?? '',
    nameUr: product?.name_ur ?? '',
    unit: product?.unit ?? 'kg',
    categoryId: product?.category_id ?? '',
    salePrice: product ? String(product.sale_price_paisa / 100) : '',
    costPrice: product?.cost_price_paisa != null ? String(product.cost_price_paisa / 100) : '',
    searchTerms: product?.search_terms.join(', ') ?? '',
    icon: product?.icon ?? '',
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateProductForm>['errors']>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const err = (key: keyof typeof errors) => {
    const e = errors[key];
    return e ? ERROR_TEXT[e] : undefined;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateProductForm({
      ...form,
      icon: form.icon.trim() || null,
      trackStock: false, // not on this form; the server keeps the owner's setting
    });
    setErrors(result.errors);
    const v = result.value;
    if (!v) return;
    const duplicate = catalogue.products.some(
      (p) => p.id !== product?.id && p.name.toLowerCase() === v.name.toLowerCase(),
    );
    if (duplicate) return setError(`A product named "${v.name}" already exists.`);
    setBusy(true);
    setError(undefined);
    try {
      await api.adminSaveProduct(shop.id, {
        ...(product && { id: product.id }),
        name: v.name,
        name_ur: v.name_ur,
        unit: v.unit,
        category_id: v.category_id,
        sale_price_paisa: v.sale_price_paisa,
        // Blank cost = leave it as it is (admins can set, not clear, a cost price).
        ...(v.cost_price_paisa !== null && { cost_price_paisa: v.cost_price_paisa }),
        icon: v.icon,
        search_terms: v.search_terms,
      });
      await reload();
      onDone();
    } catch (e2) {
      setError(fail(e2, 'Could not save the product.'));
      setBusy(false);
    }
  }

  return (
    <Card title={product ? `Edit ${product.name}` : 'Add product'}>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field
          label="Name (English)"
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          error={err('name')}
        />
        <Field
          label="Name (Urdu)"
          lang="ur"
          dir="rtl"
          value={form.nameUr}
          onChange={(e) => set('nameUr')(e.target.value)}
          error={err('nameUr')}
        />
        <Select
          label="Unit"
          value={form.unit}
          onChange={(e) => set('unit')(e.target.value)}
          options={PRODUCT_UNITS.map((u) => [u, u] as const)}
        />
        <Select
          label="Category"
          value={form.categoryId}
          onChange={(e) => set('categoryId')(e.target.value)}
          options={[
            ['', 'No category'],
            ...catalogue.categories.map((c) => [c.id, c.name] as const),
          ]}
        />
        <Field
          label="Sale price (Rs)"
          inputMode="decimal"
          value={form.salePrice}
          onChange={(e) => set('salePrice')(e.target.value)}
          error={err('salePrice')}
        />
        <Field
          label="Cost price (Rs, optional)"
          inputMode="decimal"
          value={form.costPrice}
          onChange={(e) => set('costPrice')(e.target.value)}
          error={err('costPrice')}
        />
        <Field
          label="Picture (one emoji, optional)"
          value={form.icon}
          onChange={(e) => set('icon')(e.target.value)}
          error={err('icon')}
        />
        <Field
          label="Search words (comma separated)"
          value={form.searchTerms}
          onChange={(e) => set('searchTerms')(e.target.value)}
          error={err('searchTerms')}
        />
        <div className="flex gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Save product
          </Button>
        </div>
      </form>
    </Card>
  );
}
