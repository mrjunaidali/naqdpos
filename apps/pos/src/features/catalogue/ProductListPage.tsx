import {
  displayName,
  otherName,
  needsStockCheck,
  parseRupees,
  searchItems,
  type ProductRow,
} from '@naqdpos/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { useStockByProduct, useStockText } from '../stock/stockData.ts';
import {
  rupeesInput,
  useCategories,
  usePriceLabel,
  useShopPresets,
  useShopProducts,
} from './catalogueData.ts';
import { setSalePrice } from './catalogueRepo.ts';
import { CategoryTabs } from './CategoryTabs.tsx';
import { ProductTile } from './ProductTile.tsx';

const actionClass =
  'inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text';

/** Owner screen (US019): product grid, 3 columns on phones (docs/design-theme.md, Sale). */
export function ProductListPage() {
  const { t } = useTranslation();
  const products = useShopProducts();
  const categories = useCategories();
  const presets = useShopPresets();
  const stock = useStockByProduct();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const visible = searchItems(
    (products ?? []).filter(
      (p) =>
        (showHidden ? p.deleted_at !== null : p.deleted_at === null) &&
        (category === null || p.category_id === category),
    ),
    query,
  );

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('products.title')}</h1>
        <Link
          to="/products/new"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-primary-fg"
        >
          {t('products.add')}
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* Only shop types with a ready-made list (fruit & veg today). */}
        {presets && (
          <Link to="/products/presets" className={actionClass}>
            {t('presets.open')}
          </Link>
        )}
        <Link to="/products/rates" className={actionClass}>
          {t('rates.title')}
        </Link>
        <Link to="/products/categories" className={actionClass}>
          {t('categories.title')}
        </Link>
        <Link to="/stock" className={actionClass}>
          {t('stock.open')}
        </Link>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('products.searchPlaceholder')}
        aria-label={t('products.search')}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-lg"
      />
      {categories && categories.length > 0 && (
        <CategoryTabs categories={categories} value={category} onChange={setCategory} />
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
          className="size-5 accent-primary"
        />
        {t('products.showHidden')}
      </label>

      {products && visible.length === 0 ? (
        <p className="text-muted">{showHidden ? t('products.noHidden') : t('products.empty')}</p>
      ) : (
        <ul className="grid auto-rows-fr grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {visible.map((p) => (
            <ProductCard key={p.id} product={p} stock={stock?.get(p.id) ?? 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductCard({ product, stock }: { product: ProductRow; stock: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const priceLabel = usePriceLabel();
  const stockText = useStockText();
  const actor = useActingOwnerId();
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState('');
  const [error, setError] = useState(false);
  const other = otherName(product, i18n.language);

  async function save() {
    const parsed = parseRupees(price, true);
    if (parsed.error || parsed.paisa === null) {
      setError(true);
      return;
    }
    await setSalePrice(product, parsed.paisa, actor);
    setEditing(false);
  }

  return (
    <li className="flex flex-col rounded-2xl border border-border bg-surface p-2">
      <ProductTile
        onClick={() => void navigate(`/products/${product.id}`)}
        icon={product.icon}
        name={displayName(product, i18n.language)}
        otherName={other}
        padding="pb-1"
        className="min-h-11 flex-1"
      >
        {product.track_stock && (
          <span
            className={`block w-full text-sm ${needsStockCheck(stock) ? 'font-semibold text-warning' : 'text-muted'}`}
          >
            {needsStockCheck(stock)
              ? t('stock.cardCheck', { qty: stockText(stock, product.unit) })
              : t('stock.cardQty', { qty: stockText(stock, product.unit) })}
          </span>
        )}
        {product.deleted_at !== null && (
          <span className="mt-1 inline-block rounded-full bg-bg px-2 text-xs text-muted">
            {t('products.hidden')}
          </span>
        )}
      </ProductTile>
      {editing ? (
        <form
          className="mt-1 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            autoFocus
            inputMode="decimal"
            dir="ltr"
            value={price}
            aria-label={t('products.newPriceFor', { name: displayName(product, i18n.language) })}
            aria-invalid={error || undefined}
            onChange={(e) => {
              setPrice(e.target.value);
              setError(false);
            }}
            className={`min-h-11 w-full min-w-0 rounded-md border px-2 ${error ? 'border-danger' : 'border-border'}`}
          />
          <button
            type="submit"
            aria-label={t('products.savePrice')}
            className="min-h-11 min-w-11 rounded-md bg-primary text-primary-fg"
          >
            ✓
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setPrice(rupeesInput(product.sale_price_paisa));
            setEditing(true);
          }}
          aria-label={t('products.editPriceFor', { name: displayName(product, i18n.language) })}
          className="mt-1 min-h-11 w-full rounded-md bg-bg px-2 text-center text-sm font-medium"
        >
          {priceLabel(product)}
        </button>
      )}
    </li>
  );
}
