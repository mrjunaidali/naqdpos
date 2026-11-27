// The language an email goes out in (docs/emails.md). The POS app sends its UI language as
// X-App-Language on every request; invites carry the language the admin picked.
import { z } from 'zod';

export const EMAIL_LANGUAGES = ['en', 'ur'] as const;
export const EmailLanguageSchema = z.enum(EMAIL_LANGUAGES);
export type EmailLanguage = z.infer<typeof EmailLanguageSchema>;

/** Request header with the app's UI language (lower case: fetch headers are case-insensitive). */
export const APP_LANGUAGE_HEADER = 'x-app-language';

/** Urdu for "ur" and its regional forms ("ur-PK"); English for anything else or nothing. */
export function emailLanguage(value: string | null | undefined): EmailLanguage {
  return value?.trim().toLowerCase().split(/[-_]/)[0] === 'ur' ? 'ur' : 'en';
}
