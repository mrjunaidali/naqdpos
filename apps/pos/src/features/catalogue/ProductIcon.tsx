/**
 * Product picture (US078): the emoji at about 32px. Always takes the same space, so tiles with
 * and without a picture line up. Decorative: the name next to it is what screen readers read.
 * The emoji is the only colour on these screens; everything else uses theme tokens. `keep-leading`:
 * its fixed 40px line must not take the taller Urdu line height (index.css).
 */
export function ProductIcon({ icon }: { icon: string | null | undefined }) {
  return (
    <span
      aria-hidden="true"
      data-testid="product-icon"
      data-part="icon"
      className="keep-leading block h-10 text-[32px] leading-10"
    >
      {icon ?? ''}
    </span>
  );
}
