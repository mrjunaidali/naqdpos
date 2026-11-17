import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { otherLanguage } from '../i18n/index.ts';

export function RootLayout() {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 bg-green-700 px-4 py-2 text-white">
        <span className="text-lg font-semibold">{t('app.name')}</span>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-md px-3 hover:bg-green-800"
          aria-label={t('language.switchLabel')}
          onClick={() => void i18n.changeLanguage(otherLanguage(i18n.language))}
        >
          {t('language.other')}
        </button>
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
