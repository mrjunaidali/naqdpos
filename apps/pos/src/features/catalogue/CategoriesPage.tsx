import { validateCategoryName, type CategoryRow } from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { useCategories } from './catalogueData.ts';
import { moveCategory, saveCategory } from './catalogueRepo.ts';

/** Owner screen (US021): create, rename (English and Urdu), reorder with up/down. */
export function CategoriesPage() {
  const { t } = useTranslation();
  const categories = useCategories();
  const actor = useActingOwnerId();
  const [editing, setEditing] = useState<CategoryRow | 'new' | null>(null);

  return (
    <section className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">{t('categories.title')}</h1>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {categories?.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="min-h-11 flex-1 text-start"
              onClick={() => setEditing(c)}
              aria-label={t('categories.renameLabel', { name: c.name })}
            >
              <span className="block font-medium">{c.name}</span>
              {c.name_ur && <span className="block text-sm text-muted">{c.name_ur}</span>}
            </button>
            <button
              type="button"
              disabled={i === 0}
              onClick={() => void moveCategory(c.id, -1, actor)}
              aria-label={t('categories.moveUp', { name: c.name })}
              className="min-h-11 min-w-11 rounded-md border border-border disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={i === categories.length - 1}
              onClick={() => void moveCategory(c.id, 1, actor)}
              aria-label={t('categories.moveDown', { name: c.name })}
              className="min-h-11 min-w-11 rounded-md border border-border disabled:opacity-40"
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
      {editing ? (
        <CategoryForm
          key={editing === 'new' ? 'new' : editing.id}
          existing={editing === 'new' ? null : editing}
          actor={actor}
          onDone={() => setEditing(null)}
        />
      ) : (
        <Button onClick={() => setEditing('new')}>{t('categories.add')}</Button>
      )}
    </section>
  );
}

function CategoryForm(props: { existing: CategoryRow | null; actor: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(props.existing?.name ?? '');
  const [nameUr, setNameUr] = useState(props.existing?.name_ur ?? '');
  const [errors, setErrors] = useState<ReturnType<typeof validateCategoryName>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validateCategoryName(name, nameUr);
    setErrors(found);
    if (Object.keys(found).length) return;
    await saveCategory(
      props.existing,
      { name: name.trim(), name_ur: nameUr.trim() || null },
      props.actor,
    );
    props.onDone();
  }

  const err = (code?: string) =>
    code === 'required'
      ? t('products.errors.required')
      : code
        ? t('products.errors.tooLong')
        : undefined;

  return (
    <form
      className="space-y-3 rounded-2xl border border-border bg-surface p-4"
      onSubmit={(e) => void submit(e)}
      noValidate
    >
      <h2 className="text-lg font-semibold">
        {props.existing ? t('categories.renameTitle') : t('categories.add')}
      </h2>
      <Field
        label={t('categories.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={err(errors.name)}
      />
      <Field
        label={t('categories.nameUr')}
        value={nameUr}
        onChange={(e) => setNameUr(e.target.value)}
        error={err(errors.nameUr)}
        dir="rtl"
        lang="ur"
      />
      <div className="flex gap-2">
        <Button type="submit">{t('categories.save')}</Button>
        <Button variant="secondary" onClick={props.onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
