import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

// Numbers in Latin digits in both languages (US009): shopkeepers read "Rs 1,250" and "1.5 kg"
// on scales, notes and receipts, so Urdu mode must not switch to ۱۲۵۰.

/** Intl locale for times: Urdu words, Latin digits. */
export function intlLocale(lang: string): string {
  return lang === 'ur' ? 'ur-PK-u-nu-latn' : 'en-PK';
}

/** "2026-11-23" → "23 Nov 2026" / "23 نومبر 2026" (month names from i18n, so they are reviewable). */
export function formatDate(iso: string, t: TFunction): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return t('date.day', { day: String(Number(day)), month: t(`date.month.m${month}`), year });
}

/** "2026-11" → "Nov 2026" / "نومبر 2026". */
export function formatMonth(yearMonth: string, t: TFunction): string {
  const [year, month] = yearMonth.split('-');
  if (!year || !month) return yearMonth;
  return t('date.monthYear', { month: t(`date.month.m${month}`), year });
}

/** Date and time formatters for the current UI language. */
export function useDates() {
  const { t, i18n } = useTranslation();
  const locale = intlLocale(i18n.language);
  return {
    date: (iso: string) => formatDate(iso, t),
    month: (yearMonth: string) => formatMonth(yearMonth, t),
    dateTime: (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone: 'Asia/Karachi',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(iso)),
    time: (iso: string) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Karachi', timeStyle: 'short' }).format(
        new Date(iso),
      ),
  };
}
