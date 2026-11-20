import { PRODUCT_ICON_CHOICES } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string | null;
  onChange: (icon: string | null) => void;
}

/** The product form's "Picture" field (US078): a grid of food emoji plus None, 44px targets. */
export function IconPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const choice = (icon: string | null, label: string, content: string) => (
    <button
      key={icon ?? 'none'}
      type="button"
      aria-pressed={value === icon}
      aria-label={label}
      onClick={() => onChange(icon)}
      className={`grid min-h-11 min-w-11 place-items-center rounded-md border text-2xl ${
        value === icon ? 'border-primary bg-bg' : 'border-border bg-surface'
      }`}
    >
      {content}
    </button>
  );
  // A picture picked before (or from a preset) that is not in the grid stays selectable.
  const extra =
    value && !(PRODUCT_ICON_CHOICES as readonly string[]).includes(value) ? [value] : [];
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t('products.picture')}</legend>
      <p className="text-sm text-muted">{t('products.pictureHint')}</p>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {choice(null, t('products.pictureNone'), '–')}
        {[...extra, ...PRODUCT_ICON_CHOICES].map((icon) =>
          choice(icon, t('products.pictureOption', { icon }), icon),
        )}
      </div>
    </fieldset>
  );
}
