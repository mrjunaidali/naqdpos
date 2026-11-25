import {
  giveAway,
  displayName,
  otherName,
  rupeesText,
  searchItems,
  type CartLine,
  type ProductRow,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../../ui/icons.tsx';
import { getStoredDevice } from '../../db/session.ts';
import { useCurrentStaff } from '../../staff/currentStaff.ts';
import { useCategories, usePriceLabel, useShopProducts } from '../catalogue/catalogueData.ts';
import { CategoryTabs } from '../catalogue/CategoryTabs.tsx';
import { ProductIcon } from '../catalogue/ProductIcon.tsx';
import { DayClosedBanner } from '../closing/DayClosedBanner.tsx';
import { CustomerChip } from '../khata/CustomerChip.tsx';
import { useWide } from '../../app/useWide.ts';
import { CartBar } from './CartBar.tsx';
import { CartPanel } from './CartPanel.tsx';
import { currentSeller, ownerApprovalNeeded } from './discountLimit.ts';
import { FocSuggestions } from './FocSuggestions.tsx';
import { OwnerPinDialog } from './OwnerPinDialog.tsx';
import { CartSheet } from './CartSheet.tsx';
import { useCartStore } from './cartStore.ts';
import { CustomItemDialog } from './CustomItemDialog.tsx';
import { QuantityPanel } from './QuantityPanel.tsx';
import { useQtyText } from './saleFormat.ts';

type Open =
  | {
      kind: 'product';
      product: Pick<ProductRow, 'id' | 'name' | 'name_ur' | 'unit' | 'icon' | 'sale_price_paisa'>;
      line?: CartLine | undefined;
    }
  | { kind: 'custom'; line?: CartLine | undefined }
  | { kind: 'cart' }
  | null;

/**
 * New sale (US029, US030; docs/design-theme.md "Screens → Sale"). Everything is read from Dexie
 * and kept in the cart store: nothing here waits for the network (rule 1). Anyone switched in can
 * sell; when nobody is, the header's "Who is working?" dialog asks first.
 */
export function SalePage() {
  const { t } = useTranslation();
  const products = useShopProducts();
  const categories = useCategories();
  const current = useCurrentStaff();
  const code = useLiveQuery(async () => (await getStoredDevice())?.code ?? '');
  const lines = useCartStore((s) => s.lines);
  const hydrate = useCartStore((s) => s.hydrate);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const search = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const wide = useWide();
  const [askOwner, setAskOwner] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // "/" jumps to search on a keyboard, unless someone is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Charge: a cashier over the discount limit needs the owner's PIN first (US032). */
  async function charge() {
    // Read the cart now, not from the render the handler was made in.
    const cart = useCartStore.getState();
    if (cart.lines.length === 0) return;
    const seller = await currentSeller();
    if (ownerApprovalNeeded(cart.lines, cart.billDiscount, cart.approval, seller).needed) {
      setAskOwner(true);
      return;
    }
    void navigate('/sale/pay');
  }
  // F2 = Charge (desktop counters); re-attached with the latest charge(). A layout effect, so the
  // key works from the moment the screen is shown (a passive effect runs a moment later).
  useLayoutEffect(() => {
    const onF2 = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      void charge();
    };
    window.addEventListener('keydown', onF2);
    return () => window.removeEventListener('keydown', onF2);
  });

  const canSell = current?.valid === true;
  const visible = searchItems(
    (products ?? []).filter(
      (p) => p.deleted_at === null && (category === null || p.category_id === category),
    ),
    query,
  );
  const lineOf = (productId: string) => lines.find((l) => l.product_id === productId);
  // Edit from the line's snapshot (the product may have changed or been hidden).
  const editLine = (line: CartLine) =>
    setOpen(
      line.product_id === null
        ? { kind: 'custom', line }
        : {
            kind: 'product',
            product: {
              id: line.product_id,
              name: line.name,
              name_ur: line.name_ur,
              unit: line.unit,
              icon: line.icon,
              sale_price_paisa: line.unit_price_paisa,
            },
            line,
          },
    );
  const tiles = visible.map((p) => (
    <SaleTile
      key={p.id}
      product={p}
      line={lineOf(p.id)}
      disabled={!canSell}
      wide={wide}
      onTap={() => setOpen({ kind: 'product', product: p, line: lineOf(p.id) })}
    />
  ));
  const nothing = products && visible.length === 0 && (
    <p className="text-muted">{query ? t('sale.noMatch') : t('sale.noProducts')}</p>
  );
  const overlays = (
    <>
      {askOwner && (
        <OwnerPinDialog
          message={t('discount.ownerNeeded')}
          onClose={() => setAskOwner(false)}
          onSuccess={(ownerId) => {
            const cart = useCartStore.getState();
            const { give_away_paisa } = giveAway(cart.lines, cart.billDiscount);
            cart.setApproval({ staffId: ownerId, give_away_paisa });
            setAskOwner(false);
            void navigate('/sale/pay');
          }}
        />
      )}
      {open?.kind === 'product' && (
        <QuantityPanel
          source={{
            product_id: open.product.id,
            name: open.product.name,
            name_ur: open.product.name_ur,
            unit: open.product.unit,
            icon: open.product.icon ?? null,
            unit_price_paisa: open.product.sale_price_paisa,
          }}
          existing={open.line}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'custom' && (
        <CustomItemDialog existing={open.line} onClose={() => setOpen(null)} />
      )}
      {open?.kind === 'cart' && <CartSheet onClose={() => setOpen(null)} onEdit={editLine} />}
    </>
  );

  if (wide)
    // ≥768px: products pane + a cart pane that is always there (no jump on the first item).
    return (
      <section className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              aria-label={t('sale.back')}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-text"
            >
              <Icon name="back" className="size-6 rtl:-scale-x-100" />
            </Link>
            <h1 className="shrink-0 text-xl font-bold">{t('sale.title')}</h1>
            <div className="relative min-w-0 flex-1">
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('products.searchPlaceholder')}
                aria-label={t('sale.search')}
                className="min-h-11 w-full rounded-xl border border-border bg-surface ps-4 pe-10 hover:border-border-strong"
              />
              {!query && (
                <kbd
                  aria-hidden="true"
                  className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 text-xs text-muted"
                >
                  /
                </kbd>
              )}
            </div>
            <button
              type="button"
              disabled={!canSell}
              onClick={() => setOpen({ kind: 'custom' })}
              className="min-h-11 shrink-0 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text hover:border-border-strong disabled:opacity-50"
            >
              {t('sale.customItem')}
            </button>
          </div>
          <DayClosedBanner />
          {categories && categories.length > 0 && (
            <CategoryTabs categories={categories} value={category} onChange={setCategory} />
          )}
          {canSell && products && <FocSuggestions products={products} inline />}
          {nothing || (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">{tiles}</ul>
          )}
        </div>
        <CartPanel onEdit={editLine} onCharge={() => void charge()} canSell={canSell} />
        {overlays}
      </section>
    );

  return (
    <section className="mx-auto max-w-4xl space-y-3 pb-32">
      <div className="flex items-center gap-2">
        <Link
          to="/"
          aria-label={t('sale.back')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-xl text-text rtl:rotate-180"
        >
          ←
        </Link>
        <h1 className="flex-1 text-xl font-bold">{t('sale.title')}</h1>
        {current?.valid && (
          <span className="text-sm text-muted">
            {current.staff.name}
            {code ? ` · ${code}` : ''}
          </span>
        )}
        <CustomerChip disabled={!canSell} />
      </div>
      <DayClosedBanner />

      <input
        ref={search}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('products.searchPlaceholder')}
        aria-label={t('sale.search')}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-lg"
      />
      {categories && categories.length > 0 && (
        <CategoryTabs categories={categories} value={category} onChange={setCategory} />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canSell}
          onClick={() => setOpen({ kind: 'custom' })}
          className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm font-medium text-text disabled:opacity-50"
        >
          {t('sale.customItem')}
        </button>
      </div>

      <div>
        {nothing || (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{tiles}</ul>
        )}
      </div>

      {canSell && products && <FocSuggestions products={products} />}
      <CartBar onOpen={() => setOpen({ kind: 'cart' })} onCharge={() => void charge()} />
      {overlays}
    </section>
  );
}

function SaleTile(props: {
  product: ProductRow;
  line: CartLine | undefined;
  disabled: boolean;
  wide: boolean;
  onTap: () => void;
}) {
  const { t, i18n } = useTranslation();
  const priceLabel = usePriceLabel();
  const qtyText = useQtyText();
  const { product, line } = props;
  const name = displayName(product, i18n.language);
  const other = otherName(product, i18n.language);
  const border = line?.is_foc
    ? 'border-dashed border-success'
    : line
      ? 'border-primary'
      : props.wide
        ? 'border-border hover:border-border-strong'
        : 'border-border';
  const badges = (
    <>
      {line?.is_foc && (
        <span className="absolute start-1 top-1 rounded-full bg-success px-2 text-xs font-bold text-surface">
          {t('foc.label')}
        </span>
      )}
      {line && (
        <span
          className="absolute end-1 top-1 rounded-full bg-primary px-2 text-xs font-semibold text-primary-fg"
          dir="ltr"
        >
          {qtyText(line.qty_milli, line.unit)}
        </span>
      )}
    </>
  );

  if (props.wide)
    // Equal height, centred, one line per name; "/pc" and "Set rate" keep the price on one line.
    return (
      <li>
        <button
          type="button"
          disabled={props.disabled}
          onClick={props.onTap}
          title={name}
          data-in-cart={line ? 'true' : undefined}
          className={`relative flex h-36 w-full flex-col items-center rounded-2xl border-2 bg-surface px-2 pt-6 pb-2 text-center disabled:opacity-60 ${border}`}
        >
          {badges}
          <ProductIcon icon={product.icon} />
          <span className="block w-full truncate font-semibold">{name}</span>
          {other && <span className="block w-full truncate text-sm text-muted">{other}</span>}
          <span
            className={`mt-auto block w-full truncate text-sm font-medium ${
              product.sale_price_paisa === 0 ? 'text-warning' : ''
            }`}
          >
            {product.sale_price_paisa === 0
              ? t('sale.setRate')
              : t('products.pricePerUnit', {
                  amount: rupeesText(product.sale_price_paisa),
                  unit: product.unit === 'piece' ? t('sale.pcShort') : t(`unit.${product.unit}`),
                })}
          </span>
        </button>
      </li>
    );

  return (
    <li>
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onTap}
        data-in-cart={line ? 'true' : undefined}
        className={`relative flex h-full min-h-28 w-full flex-col rounded-2xl border-2 bg-surface p-2 text-start disabled:opacity-60 ${border}`}
      >
        {badges}
        <ProductIcon icon={product.icon} />
        <span className="block font-semibold leading-tight">{name}</span>
        {other && <span className="block text-sm text-muted">{other}</span>}
        <span className="mt-auto block pt-1 text-sm font-medium">{priceLabel(product)}</span>
      </button>
    </li>
  );
}
