import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ProductIcon } from './ProductIcon.tsx';

interface ProductTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: string | null | undefined;
  name: string;
  /** The name in the other language, under the main one. */
  otherName?: string | null;
  /** Price line (or "Set rate"), last in the tile. */
  price?: ReactNode;
  /** Extra lines under the names (stock, "hidden"). */
  children?: ReactNode;
  /** Absolutely placed corner badges (FOC, quantity in cart). */
  badges?: ReactNode;
  /** Inner padding; the default leaves room for the corner badges. */
  padding?: string;
}

/**
 * One product tile for every product grid (New Sale, Products; bug 2026-11-26). Content is
 * centred at every width and in both directions: `items-center text-center` on the button itself,
 * never only from a breakpoint. The icon always takes its 40px (also when empty) and names wrap to
 * at most 2 lines, so tiles line up; the grid gives equal heights (`auto-rows-fr` + `h-full`).
 * The frame (border, background, radius) comes from the caller through `className`.
 */
export function ProductTile({
  icon,
  name,
  otherName,
  price,
  children,
  badges,
  padding = 'px-2 pt-6 pb-2',
  className = '',
  type = 'button',
  ...button
}: ProductTileProps) {
  return (
    <button
      type={type}
      data-testid="product-tile"
      className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-center ${padding} disabled:opacity-60 ${className}`}
      {...button}
    >
      {badges}
      <ProductIcon icon={icon} />
      <span
        data-part="name"
        className="line-clamp-2 w-full font-semibold leading-tight break-words"
      >
        {name}
      </span>
      {otherName && <span className="line-clamp-1 w-full text-sm text-muted">{otherName}</span>}
      {children}
      {price !== undefined && (
        <span data-part="price" className="w-full pt-1 text-sm font-medium">
          {price}
        </span>
      )}
    </button>
  );
}
