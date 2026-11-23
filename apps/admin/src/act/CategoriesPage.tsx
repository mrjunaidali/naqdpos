import { validateCategoryName, type AdminCatalogue } from '@naqdpos/core';
import { useState, type FormEvent } from 'react';
import { api } from '../api/index.ts';
import { useFailure } from '../app/adminContext.ts';
import { Alert, Button, Card, Field } from '../app/ui.tsx';
import { useAct } from './actContext.ts';

type Category = AdminCatalogue['categories'][number];

/** US013: add, rename and reorder the shop's categories. */
export function CategoriesPage() {
  const { shop, catalogue, reload } = useAct();
  const fail = useFailure();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [nameUr, setNameUr] = useState('');
  const [nameError, setNameError] = useState<string>();
  const list = catalogue.categories;

  async function write(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(fail(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setEditing(null);
    setName('');
    setNameUr('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errors = validateCategoryName(name, nameUr);
    setNameError(errors.name === 'required' ? 'Required.' : errors.name ? 'Too long.' : undefined);
    if (errors.name || errors.nameUr) return;
    const duplicate = list.some(
      (c) => c.id !== editing?.id && c.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (duplicate) return setNameError('A category with this name exists.');
    const ok = await write(
      () =>
        api.adminSaveCategory(shop.id, {
          // A rename sends the current sort, or the server would move it to the end.
          ...(editing && { id: editing.id, sort: editing.sort }),
          name: name.trim(),
          name_ur: nameUr.trim() || null,
        }),
      'Could not save the category.',
    );
    if (ok) clear();
  }

  /** Moves one place up or down; renumbers 1..n so equal sort values can't block a move. */
  function move(index: number, by: -1 | 1) {
    const order = [...list];
    const [item] = order.splice(index, 1);
    order.splice(index + by, 0, item!);
    void write(
      () =>
        Promise.all(
          order.flatMap((c, i) =>
            c.sort === i + 1
              ? []
              : [
                  api.adminSaveCategory(shop.id, {
                    id: c.id,
                    name: c.name,
                    name_ur: c.name_ur,
                    sort: i + 1,
                  }),
                ],
          ),
        ),
      'Could not reorder.',
    );
  }

  return (
    <Card title={`Categories (${list.length})`}>
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-border text-sm">
        {list.map((c, i) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">
              {c.name}
              {c.name_ur && (
                <span lang="ur" dir="rtl" className="ms-2 text-muted">
                  {c.name_ur}
                </span>
              )}
            </span>
            <Button
              variant="secondary"
              aria-label={`Move ${c.name} up`}
              disabled={busy || i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              variant="secondary"
              aria-label={`Move ${c.name} down`}
              disabled={busy || i === list.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(c);
                setName(c.name);
                setNameUr(c.name_ur ?? '');
                setNameError(undefined);
              }}
            >
              Rename
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void submit(e)} className="grid gap-2 sm:grid-cols-3" noValidate>
        <Field
          label={editing ? `New name for ${editing.name}` : 'New category'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={nameError}
        />
        <Field
          label="Urdu name (optional)"
          lang="ur"
          dir="rtl"
          value={nameUr}
          onChange={(e) => setNameUr(e.target.value)}
        />
        <div className="flex items-end gap-2">
          {editing && (
            <Button variant="secondary" onClick={clear}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {editing ? 'Save name' : 'Add category'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
