import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center rounded-md bg-green-700 px-4 text-white"
      >
        {t('notFound.goHome')}
      </Link>
    </section>
  );
}
