import { displayName, parseRupees, type ProductRow } from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../ui/Button.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { rupeesInput, useCosts, useCostsHere, useShopProducts } from './catalogueData.ts';
import { saveTodaysRates, type RateChange } from './catalogueRepo.ts';
import { ProductIcon } from './ProductIcon.tsx';

/** Owner screen (US020): every product's sale price (and cost on owner devices), Save all once. */
export function TodaysRatesPage() {
  const products = useShopProducts();
  const costs = useCosts();
  const costsHere = useCostsHere();
  if (!products || !costs || costsHere === undefined) return null;
  const active = products
    .filter((p) => p.deleted_at === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Keyed on the product set so the inputs start from the stored values.
  return (
    <RatesForm
      key={active.map((p) => p.id).join()}
      products={active}
      costs={costs}
      costsHere={costsHere}
    />
  );
}

function RatesForm(props: {
  products: ProductRow[];
  costs: Map<string, number>;
  costsHere: boolean;
}) {
  const { t, i18n } = useTranslation();
  const actor = useActingOwnerId();
  const [sale, setSale] = useState(
    () => new Map(props.products.map((p) => [p.id, rupeesInput(p.sale_price_paisa)])),
  );
  const [cost, setCost] = useState(
    () => new Map(props.products.map((p) => [p.id, rupeesInput(props.costs.get(p.id))])),
  );
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveAll() {
    const changes: RateChange[] = [];
    const errors = new Set<string>();
    for (const product of props.products) {
      const s = parseRupees(sale.get(product.id) ?? '', true);
      const c = props.costsHere ? parseRupees(cost.get(product.id) ?? '', false) : { paisa: null };
      if (s.error || ('error' in c && c.error)) {
        errors.add(product.id);
        continue;
      }
      const costChanged = c.paisa !== null && c.paisa !== props.costs.get(product.id);
      if (s.paisa !== product.sale_price_paisa || costChanged) {
        changes.push({ product, sale: s.paisa!, cost: costChanged ? c.paisa : null });
      }
    }
    setBad(errors);
    if (errors.size) return;
    setBusy(true);
    try {
      setSaved(await saveTodaysRates(changes, actor, props.costsHere));
    } finally {
      setBusy(false);
    }
  }

  const input = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <input
      inputMode="decimal"
      dir="ltr"
      value={value}
      aria-label={label}
      aria-invalid={bad.has(id) || undefined}
      onChange={(e) => {
        onChange(e.target.value);
        setSaved(null);
      }}
      className={`min-h-11 w-24 rounded-md border px-2 text-end ${bad.has(id) ? 'border-danger' : 'border-border'}`}
    />
  );

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('rates.title')}</h1>
      <p className="text-muted">
        {props.costsHere ? t('rates.introOwner') : t('products.costElsewhere')}
      </p>
      {bad.size > 0 && <Alert>{t('rates.error')}</Alert>}
      {saved !== null && <Alert tone="info">{t('rates.saved', { count: saved })}</Alert>}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {props.products.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-2">
            <span className="w-10 shrink-0 text-center">
              <ProductIcon icon={p.icon} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{displayName(p, i18n.language)}</span>
              <span className="block text-sm text-muted">
                {t('rates.perUnit', { unit: t(`unit.${p.unit}`) })}
              </span>
            </span>
            {input(
              p.id,
              t('rates.saleFor', { name: displayName(p, i18n.language) }),
              sale.get(p.id) ?? '',
              (v) => setSale((m) => new Map(m).set(p.id, v)),
            )}
            {props.costsHere &&
              input(
                p.id,
                t('rates.costFor', { name: displayName(p, i18n.language) }),
                cost.get(p.id) ?? '',
                (v) => setCost((m) => new Map(m).set(p.id, v)),
              )}
          </li>
        ))}
      </ul>
      <div className="sticky bottom-nav z-10 -mx-4 border-t border-border bg-surface p-3">
        <Button disabled={busy} onClick={() => void saveAll()}>
          {t('rates.saveAll')}
        </Button>
      </div>
    </section>
  );
}
