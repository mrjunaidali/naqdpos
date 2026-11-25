import {
  displayName,
  parseQtyInput,
  unitRule,
  type ProductRow,
  type StaffRow,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { unitName } from '../sale/saleFormat.ts';
import { syncEngine } from '../../sync/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { showToast } from '../../ui/toastStore.ts';
import { NumberPad } from '../sale/NumberPad.tsx';
import { useProductStock, useStockText } from './stockData.ts';
import { recordStockAction, StockNotRecorded, syncBeforeCount } from './stockRepo.ts';

export type SheetAction = 'wastage' | 'stock_in' | 'set_stock';

interface Props {
  product: ProductRow;
  action: SheetAction;
  /** Who records it: the switched-in staff member (wastage) or the owner (stock in, set stock). */
  staff: StaffRow;
  onClose: () => void;
}

const QTY_ERRORS: Record<string, string> = {
  invalid: 'sale.errors.qty',
  zero: 'sale.errors.qty',
  too_many_decimals: 'sale.errors.decimals',
  too_large: 'sale.errors.tooLarge',
};

/**
 * One stock action for one product (US025). Quantity entry follows the sale keypad rules per
 * unit. Set stock first syncs (other devices' sales), and asks before counting without them.
 */
export function StockActionSheet({ product, action, staff, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const stockText = useStockText();
  const stock = useProductStock(product.id) ?? 0;
  const [reason, setReason] = useState<'wastage' | 'damaged'>('wastage');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [phase, setPhase] = useState<'edit' | 'syncing' | 'confirm' | 'saving'>('edit');
  const name = displayName(product, i18n.language);
  const rules = unitRule(product.unit);

  /** The typed quantity; a count may be 0, the other actions need more than 0. */
  function typedQty(): number | { error: string } {
    const parsed = parseQtyInput(text, product.unit);
    if ('error' in parsed) {
      if (action === 'set_stock' && parsed.error === 'zero') return 0;
      return { error: parsed.error };
    }
    return parsed.qty_milli;
  }
  const typed = text ? typedQty() : null;
  const difference = action === 'set_stock' && typeof typed === 'number' ? typed - stock : null;

  async function write(qtyMilli: number) {
    setPhase('saving');
    try {
      const row = await recordStockAction({
        action: action === 'wastage' ? reason : action,
        product,
        qtyMilli,
        note: action === 'set_stock' ? null : note,
        staff,
      });
      showToast(row ? t('stock.saved') : t('stock.noChange'));
      onClose();
    } catch (e) {
      setPhase('edit');
      setError(e instanceof StockNotRecorded ? t(`stock.errors.${e.reason}`) : t('errors.generic'));
    }
  }

  async function save() {
    const qty = typedQty();
    if (typeof qty !== 'number') {
      setError(t(QTY_ERRORS[qty.error] ?? 'sale.errors.qty'));
      return;
    }
    if (action !== 'set_stock') return write(qty);
    // Other devices' sales may not be here yet: sync first (short wait), else ask.
    setPhase('syncing');
    const synced = await syncBeforeCount(() => syncEngine.syncNow());
    if (!synced) {
      setPhase('confirm');
      return;
    }
    return write(qty);
  }

  const title = t(`stock.titleFor.${action}`, { name });
  const busy = phase === 'syncing' || phase === 'saving';

  return (
    <Sheet title={title} onClose={onClose}>
      <p className={stock <= 0 ? 'font-semibold text-warning' : 'text-muted'}>
        {t('stock.inStock', { qty: stockText(stock, product.unit) })}
      </p>

      {action === 'wastage' && (
        <div className="flex gap-2" role="group" aria-label={t('stock.reasonLabel')}>
          {(['wastage', 'damaged'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={`min-h-11 flex-1 rounded-full border px-4 font-medium ${
                reason === r
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-border bg-surface text-text'
              }`}
            >
              {t(`stock.reason.${r}`)}
            </button>
          ))}
        </div>
      )}

      <div>
        <p className="font-medium">
          {action === 'set_stock' ? t('stock.counted') : t('stock.quantity')} (
          {unitName(t, product.unit)})
        </p>
        <output
          aria-label={t('stock.typedQty')}
          dir="ltr"
          className="mt-1 block min-h-12 rounded-md border border-border bg-bg px-3 py-2 text-end text-2xl font-semibold"
        >
          {text || '0'}
        </output>
        {difference !== null && (
          <p className="mt-1 text-sm text-muted">
            {difference === 0
              ? t('stock.sameAsStock')
              : t('stock.difference', {
                  qty: `${difference > 0 ? '+' : ''}${stockText(difference, product.unit)}`,
                })}
          </p>
        )}
      </div>
      <NumberPad
        value={text}
        onChange={(v) => {
          setText(v);
          setError(undefined);
        }}
        decimals={rules.decimals}
      />

      {action !== 'set_stock' && (
        <Field
          label={t('stock.note')}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          autoComplete="off"
        />
      )}

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {phase === 'confirm' ? (
        <div
          role="alertdialog"
          aria-label={t('stock.syncWarning')}
          className="space-y-3 rounded-xl border border-warning bg-warning-soft p-3 text-warning-fg"
        >
          <p className="font-semibold">{t('stock.syncWarning')}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPhase('edit')}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                const qty = typedQty();
                if (typeof qty === 'number') void write(qty);
              }}
            >
              {t('stock.countAnyway')}
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={busy || !text} onClick={() => void save()}>
          {phase === 'syncing'
            ? t('stock.syncing')
            : phase === 'saving'
              ? t('common.wait')
              : t(`stock.save.${action}`)}
        </Button>
      )}
    </Sheet>
  );
}
