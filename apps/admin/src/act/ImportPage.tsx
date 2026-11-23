import {
  decodeCsvText,
  IMPORT_COLUMNS,
  parseCsv,
  previewImport,
  type ImportPreview,
  type ImportRowError,
} from '@naqdpos/core';
import { useId, useState } from 'react';
import { api } from '../api/index.ts';
import { useFailure } from '../app/adminContext.ts';
import { Alert, Button, Card, Notice } from '../app/ui.tsx';
import { rupees, useAct } from './actContext.ts';

const ROW_ERROR_TEXT: Record<ImportRowError, string> = {
  name_required: 'name is missing',
  name_too_long: 'name is too long',
  bad_unit: 'unknown unit',
  bad_sale_price: 'bad sale price',
  bad_cost_price: 'bad cost price',
  duplicate_in_file: 'same name again in the file',
  too_many_terms: 'more than 20 search words',
};

/**
 * US013 CSV import: choose a file, see the preview with per-row errors, choose skip or update
 * for names that exist, then "Import N products". Nothing is written before that button.
 */
export function ImportPage() {
  const { shop, catalogue, reload } = useAct();
  const fail = useFailure();
  const inputId = useId();
  const [preview, setPreview] = useState<ImportPreview>();
  const [onExisting, setOnExisting] = useState<'skip' | 'update'>('skip');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function choose(file: File | undefined) {
    setPreview(undefined);
    setError(undefined);
    setDone(undefined);
    if (!file) return;
    // File.text() decodes as UTF-8; bytes that aren't UTF-8 become U+FFFD, which is refused.
    const decoded = decodeCsvText(await file.text());
    if ('error' in decoded) {
      setError("Save the file as 'CSV UTF-8' in Excel and try again.");
      return;
    }
    setPreview(
      previewImport(
        parseCsv(decoded.text),
        catalogue.products.map((p) => p.name),
      ),
    );
  }

  const rows = preview
    ? preview.rows.flatMap((r) =>
        r.row && !preview.missingColumns.length && !(r.exists && onExisting === 'skip')
          ? [r.row]
          : [],
      )
    : [];

  async function runImport() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.adminImportProducts(shop.id, { rows, on_existing: onExisting });
      setPreview(undefined);
      setDone(`Imported: ${r.created} new, ${r.updated} updated, ${r.skipped} skipped.`);
      await reload();
    } catch (e) {
      setError(fail(e, 'Could not import the products.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="CSV import">
      <p className="text-sm text-muted">
        Columns: {IMPORT_COLUMNS.join(', ')}. Units: kg, g, dozen, piece, bundle, litre. Prices in
        rupees. Search words separated by ; or |.
      </p>
      <div className="space-y-1">
        <label htmlFor={inputId} className="block font-medium">
          CSV file
        </label>
        <input
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void choose(e.target.files?.[0])}
          className="min-h-11"
        />
        <p className="text-sm text-muted">
          From Excel: File → Save As → <strong>CSV UTF-8 (Comma delimited)</strong>, so Urdu names
          stay readable.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {done && <Notice>{done}</Notice>}
      {preview && (
        <div className="space-y-3">
          {preview.missingColumns.length > 0 && (
            <Alert>Missing columns: {preview.missingColumns.join(', ')}.</Alert>
          )}
          <p>
            {preview.rows.length} rows · {preview.errorCount} with errors (not imported) ·{' '}
            {preview.existingCount} already exist
          </p>
          {preview.existingCount > 0 && (
            <fieldset className="space-y-1">
              <legend className="font-medium">
                Products that already exist (same English name)
              </legend>
              {(
                [
                  ['skip', 'Skip them (keep the shop’s products as they are)'],
                  ['update', 'Update them from the file'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="on-existing"
                    checked={onExisting === value}
                    onChange={() => setOnExisting(value)}
                    className="size-5"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-muted">
                  <th className="p-1 text-start">Line</th>
                  <th className="p-1 text-start">Name</th>
                  <th className="p-1 text-start">Unit</th>
                  <th className="p-1 text-start">Category</th>
                  <th className="p-1 text-start">Price</th>
                  <th className="p-1 text-start">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-border">
                    <td className="p-1">{r.line}</td>
                    <td className="p-1">
                      {r.row?.name ?? '—'}
                      {r.row?.name_ur && (
                        <span lang="ur" dir="rtl" className="ms-2">
                          {r.row.name_ur}
                        </span>
                      )}
                    </td>
                    <td className="p-1">{r.row?.unit ?? ''}</td>
                    <td className="p-1">{r.row?.category ?? ''}</td>
                    <td className="p-1">{r.row ? rupees(r.row.sale_price_paisa) : ''}</td>
                    <td className={`p-1 ${r.errors.length ? 'text-danger' : ''}`}>
                      {r.errors.length
                        ? r.errors.map((e) => ROW_ERROR_TEXT[e]).join(', ')
                        : r.exists
                          ? onExisting === 'skip'
                            ? 'exists: skip'
                            : 'exists: update'
                          : 'new'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button disabled={busy || rows.length === 0} onClick={() => void runImport()}>
            Import {rows.length} products
          </Button>
        </div>
      )}
    </Card>
  );
}
