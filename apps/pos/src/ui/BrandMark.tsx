import { useTranslation } from 'react-i18next';
import { useLogoUrl } from '../features/settings/logo.ts';

/**
 * The brand mark (docs/design-theme.md): the one place the logo is drawn. The shop's own logo
 * (US014, kept on the device so it shows offline) when it has one, else the first letter of the
 * app name on the primary colour.
 */
export function BrandMark({ logoPath = null }: { logoPath?: string | null }) {
  const { t } = useTranslation();
  const logo = useLogoUrl(logoPath);
  if (logo)
    return (
      <img
        src={logo}
        alt=""
        data-testid="shop-logo"
        className="size-10 shrink-0 rounded-xl border border-border bg-surface object-contain"
      />
    );
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-fg"
    >
      {t('app.name').charAt(0)}
    </span>
  );
}
