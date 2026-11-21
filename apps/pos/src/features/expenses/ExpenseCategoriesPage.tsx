import type { ExpenseCategoryRow } from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import {
  addCategory,
  categoryName,
  moveCategory,
  renameCategory,
  setCategoryArchived,
  useExpenseCategories,
} from './expenseRepo.ts';

const small = 'min-h-11 min-w-11 rounded-md border border-border px-2 text-sm disabled:opacity-40';

/** Settings → Expense categories (US065, owner): add, rename (en / ur), reorder, archive. */
export function ExpenseCategoriesPage() {
  const { t, i18n } = useTranslation();
  const actor = useActingOwnerId();
  const all = useExpenseCategories();
  const [name, setName] = useState('');
  const [nameUr, setNameUr] = useState('');
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<ExpenseCategoryRow | null>(null);
  if (!all) return null;
  const active = all.filter((c) => c.archived_at === null);
  const archived = all.filter((c) => c.archived_at !== null);

  function check(n: string) {
    if (!n.trim() || [...n.trim()].length > 40) {
      setError(t('expenseCategories.errors.name'));
      return false;
    }
    setError(undefined);
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!check(name)) return;
    if (editing) await renameCategory(editing, name, nameUr, actor);
    else await addCategory(name, nameUr, actor);
    setName('');
    setNameUr('');
    setEditing(null);
  }

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('expenseCategories.title')}</h1>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {active.map((c, i) => {
          const label = categoryName(c, t, i18n.language);
          return (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1">{label}</span>
              <button
                type="button"
                className={small}
                disabled={i === 0}
                aria-label={t('expenseCategories.up', { name: label })}
                onClick={() => void moveCategory(active, i, -1, actor)}
              >
                ↑
              </button>
              <button
                type="button"
                className={small}
                disabled={i === active.length - 1}
                aria-label={t('expenseCategories.down', { name: label })}
                onClick={() => void moveCategory(active, i, 1, actor)}
              >
                ↓
              </button>
              <button
                type="button"
                className={small}
                aria-label={t('expenseCategories.renameFor', { name: label })}
                onClick={() => {
                  setEditing(c);
                  setName(c.i18n_key ? label : c.name);
                  setNameUr(c.name_ur ?? '');
                }}
              >
                {t('expenseCategories.rename')}
              </button>
              <button
                type="button"
                className={small}
                aria-label={t('expenseCategories.archiveFor', { name: label })}
                onClick={() => void setCategoryArchived(c, true, actor)}
              >
                {t('expenseCategories.archive')}
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="space-y-3 rounded-2xl border border-border bg-surface p-3"
        onSubmit={(e) => void submit(e)}
      >
        <h2 className="font-semibold">
          {editing ? t('expenseCategories.renameTitle') : t('expenseCategories.addTitle')}
        </h2>
        <Field
          label={t('expenseCategories.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          maxLength={40}
        />
        <Field
          label={t('expenseCategories.nameUr')}
          value={nameUr}
          onChange={(e) => setNameUr(e.target.value)}
          maxLength={40}
          dir="rtl"
        />
        <Button type="submit">
          {editing ? t('expenseCategories.saveRename') : t('expenseCategories.add')}
        </Button>
        {editing && (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(null);
              setName('');
              setNameUr('');
            }}
          >
            {t('common.cancel')}
          </Button>
        )}
      </form>

      {archived.length > 0 && (
        <>
          <h2 className="font-semibold">{t('expenseCategories.archived')}</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {archived.map((c) => {
              const label = categoryName(c, t, i18n.language);
              return (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-muted">
                  <span className="flex-1">{label}</span>
                  <button
                    type="button"
                    className={small}
                    aria-label={t('expenseCategories.unarchiveFor', { name: label })}
                    onClick={() => void setCategoryArchived(c, false, actor)}
                  >
                    {t('expenseCategories.unarchive')}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
