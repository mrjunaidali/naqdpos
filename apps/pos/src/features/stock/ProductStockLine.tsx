import { needsStockCheck, type ProductRow } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useProductStock, useStockText } from './stockData.ts';

/** Current stock under "Track stock" in the product form (US024), with a link to the Stock screen. */
export function ProductStockLine({ product }: { product: Pick<ProductRow, 'id' | 'unit'> }) {
  const { t } = useTranslation();
  const stock = useProductStock(product.id);
  const stockText = useStockText();
  if (stock === undefined) return null;
  const check = needsStockCheck(stock);
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span className={check ? 'font-semibold text-warning' : 'text-muted'}>
        {t('stock.inStock', { qty: stockText(stock, product.unit) })}
        {check && ` · ${t('stock.check')}`}
      </span>
      <Link to="/stock" className="inline-flex min-h-11 items-center px-2 underline">
        {t('stock.open')}
      </Link>
    </p>
  );
}
