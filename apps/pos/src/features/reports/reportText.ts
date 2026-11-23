// Small display helpers shared by the report screens.
import type { TFunction } from 'i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema.ts';
import { getStoredDevice } from '../../db/session.ts';
import { categoryName } from '../expenses/expenseRepo.ts';
import { methodName } from '../settings/paymentMethods.ts';

/** Names for payment methods, expense categories and staff from this device's data. */
export function useReportNames() {
  return useLiveQuery(async () => {
    const device = await getStoredDevice();
    const [methods, categories, staff] = await Promise.all([
      db.payment_methods.toArray(),
      db.expense_categories.toArray(),
      db.staff.toArray(),
    ]);
    return {
      ownerDevice: device?.mode === 'owner',
      methods: methods.sort((a, b) => a.sort - b.sort),
      categories: categories.sort((a, b) => a.sort - b.sort),
      staff: staff.filter((s) => s.role !== 'rider').sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
export type ReportNames = NonNullable<ReturnType<typeof useReportNames>>;

export function methodLabel(names: ReportNames | undefined, code: string, t: TFunction) {
  const m = names?.methods.find((x) => x.code === code);
  return methodName(m ?? { code, label: code }, t);
}

export function categoryLabel(
  c: { name: string | null; name_ur: string | null; i18n_key: string | null },
  t: TFunction,
  lang: string,
) {
  return categoryName({ name: c.name ?? '—', name_ur: c.name_ur, i18n_key: c.i18n_key }, t, lang);
}
