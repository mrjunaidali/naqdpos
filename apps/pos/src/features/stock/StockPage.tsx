import {
  can,
  displayName,
  needsStockCheck,
  searchItems,
  type ProductRow,
  type StaffRow,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/schema.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { useShopProducts } from '../catalogue/catalogueData.ts';
import { ProductIcon } from '../catalogue/ProductIcon.tsx';
import { useOwnerHere } from '../pin/useOwnerHere.ts';
import { OwnerPinDialog } from '../sale/OwnerPinDialog.tsx';
import { StockActionSheet, type SheetAction } from './StockActionSheet.tsx';
import { useStockByProduct, useStockText } from './stockData.ts';

const buttonClass =
  'min-h-11 flex-1 rounded-md border border-border bg-surface px-2 text-sm font-medium text-text';

interface Open {
  product: ProductRow;
  action: SheetAction;
  staff: StaffRow;
}

/**
 * Stock (US024, US025): every product that tracks stock with its current stock. Wastage for
 * owners and cashiers; Stock in and Set stock need an owner (PIN unless an owner is here).
 */
export function StockPage() {
  const { t, i18n } = useTranslation();
  const products = useShopProducts();
  const stock = useStockByProduct();
  const current = useCurrentStaff();
  const ownerHere = useOwnerHere();
  const stockText = useStockText();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Open | null>(null);
  const [askOwner, setAskOwner] = useState<Omit<Open, 'staff'> | null>(null);
  const [error, setError] = useState<string>();

  const tracked = searchItems(
    (products ?? []).filter((p) => p.track_stock && p.deleted_at === null),
    query,
  );

  async function openAs(product: ProductRow, action: SheetAction, staffId: string) {
    const staff = await db.staff.get(staffId);
    if (!staff) return;
    setOpen({ product, action, staff });
  }

  function start(product: ProductRow, action: SheetAction) {
    setError(undefined);
    if (action === 'wastage') {
      if (!current?.valid || !can(current.staff.role, 'record_wastage')) {
        setError(t('stock.errors.no_staff'));
        return;
      }
      setOpen({ product, action, staff: current.staff });
      return;
    }
    if (ownerHere) void openAs(product, action, ownerHere);
    else setAskOwner({ product, action });
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('stock.title')}</h1>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('products.searchPlaceholder')}
        aria-label={t('stock.search')}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-lg"
      />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {products && tracked.length === 0 ? (
        <p className="text-muted">{query ? t('stock.noMatch') : t('stock.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {tracked.map((p) => {
            const qty = stock?.get(p.id) ?? 0;
            const check = needsStockCheck(qty);
            const name = displayName(p, i18n.language);
            return (
              <li
                key={p.id}
                aria-label={name}
                className="space-y-2 rounded-2xl border border-border bg-surface p-3"
              >
                <div className="flex items-center gap-3">
                  <ProductIcon icon={p.icon} />
                  <span className="flex-1 font-semibold">{name}</span>
                  <span className={`text-end ${check ? 'font-semibold text-warning' : ''}`}>
                    <span className="block" dir="ltr">
                      {stockText(qty, p.unit)}
                    </span>
                    {check && <span className="block text-xs">{t('stock.check')}</span>}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={t('stock.wastageFor', { name })}
                    onClick={() => start(p, 'wastage')}
                  >
                    {t('stock.wastage')}
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={t('stock.stockInFor', { name })}
                    onClick={() => start(p, 'stock_in')}
                  >
                    {t('stock.stockIn')}
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={t('stock.setStockFor', { name })}
                    onClick={() => start(p, 'set_stock')}
                  >
                    {t('stock.setStock')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {askOwner && (
        <OwnerPinDialog
          message={t('stock.ownerPin')}
          onClose={() => setAskOwner(null)}
          onSuccess={(ownerId) => {
            const pending = askOwner;
            setAskOwner(null);
            void openAs(pending.product, pending.action, ownerId);
          }}
        />
      )}
      {open && (
        <StockActionSheet
          product={open.product}
          action={open.action}
          staff={open.staff}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
