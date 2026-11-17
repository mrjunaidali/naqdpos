import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">{t('home.welcome')}</h1>
      <p className="text-gray-600">{t('app.tagline')}</p>
    </section>
  );
}
