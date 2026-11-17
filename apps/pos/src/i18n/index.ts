import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ur from './ur.json';

export const SUPPORTED_LANGUAGES = ['en', 'ur'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const i18n = i18next.createInstance();

/** Keep <html lang/dir> in sync with the active language so Urdu renders right-to-left. */
function applyDocumentLanguage(lng: string): void {
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

i18n.on('languageChanged', applyDocumentLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ur: { translation: ur },
  },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  // Resources are bundled, so init synchronously and never render untranslated keys.
  initAsync: false,
  interpolation: { escapeValue: false }, // React already escapes
});

export function otherLanguage(current: string): Language {
  return current === 'ur' ? 'en' : 'ur';
}
