import { useTranslation } from 'react-i18next';

/**
 * The brand mark (docs/design-theme.md): the one place the logo is drawn. Shop logos (by storage
 * key) come with branding; until then the first letter of the app name on the primary colour.
 */
export function BrandMark() {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-fg"
    >
      {t('app.name').charAt(0)}
    </span>
  );
}
