import { businessDate } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';
import { useDates } from '../../i18n/format.ts';
import { useCurrentBusinessDate } from './closedDates.ts';

/** "Day closed — new sales count for <date>" once today is closed (selling never blocks). */
export function DayClosedBanner() {
  const { t } = useTranslation();
  const dates = useDates();
  const current = useCurrentBusinessDate();
  if (!current || current === businessDate(new Date())) return null;
  return (
    <p
      role="status"
      className="rounded-xl border border-warning bg-warning-soft p-3 text-warning-fg"
    >
      {t('closing.banner', { date: dates.date(current) })}
    </p>
  );
}
