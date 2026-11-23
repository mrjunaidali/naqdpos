import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ur from './ur.json';

export const SUPPORTED_LANGUAGES = ['en', 'ur'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The app language is a device setting (US009). It lives in localStorage rather than Dexie because
 * it must be read synchronously before the first render, so Urdu users never see an English flash.
 */
export const LANGUAGE_STORAGE_KEY = 'naqdpos.language';

export function storedLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'ur' ? 'ur' : 'en';
  } catch {
    // Storage blocked (private mode, site data off): English, and the toggle still works per run.
    return 'en';
  }
}

function saveLanguage(lng: string): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // Not saved; the language still applies until the app is closed.
  }
}

export const i18n = i18next.createInstance();

/** Keep <html lang/dir> in sync with the active language so Urdu renders right-to-left. */
function applyDocumentLanguage(lng: string): void {
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

i18n.on('languageChanged', (lng) => {
  applyDocumentLanguage(lng);
  // Only a language the user picked is saved (init applies the stored one and saves it again).
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lng)) saveLanguage(lng);
});

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ur: { translation: ur },
  },
  lng: storedLanguage(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  // Resources are bundled, so init synchronously and never render untranslated keys.
  initAsync: false,
  interpolation: { escapeValue: false }, // React already escapes
});

export function otherLanguage(current: string): Language {
  return current === 'ur' ? 'en' : 'ur';
}
