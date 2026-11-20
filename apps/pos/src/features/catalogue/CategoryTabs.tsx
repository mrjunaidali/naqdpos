import { displayName, type CategoryRow } from '@naqdpos/core';
import { useTranslation } from 'react-i18next';

interface Props {
  categories: readonly CategoryRow[];
  /** null = All. */
  value: string | null;
  onChange: (categoryId: string | null) => void;
}

/**
 * Category chips (US021; reused by the sale screen). Scrolls sideways on phones; the selected
 * chip is near-black (docs/design-theme.md, Sale screen).
 */
export function CategoryTabs({ categories, value, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? 'all'}
      type="button"
      aria-pressed={value === id}
      onClick={() => onChange(id)}
      className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${
        value === id
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-border bg-surface text-text'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={t('categories.tabsLabel')}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
    >
      {chip(null, t('categories.all'))}
      {categories.map((c) => chip(c.id, displayName(c, i18n.language)))}
    </div>
  );
}
