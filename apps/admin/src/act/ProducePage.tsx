import {
  getPresetsForShopType,
  parseRupees,
  PRESET_CATEGORIES,
  presetImportRows,
  type PresetList,
} from '@naqdpos/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/index.ts';
import { useFailure } from '../app/adminContext.ts';
import { Alert, Button, Card, Notice } from '../app/ui.tsx';
import { useAct } from './actContext.ts';

/**
 * US013 + US072: the same fresh produce list as the shop app. Products that already exist are
 * shown as "Added"; categories are created on demand and rates are optional. Written through
 * admin_import_products with "skip", so the server never makes duplicates either. Only for shop
 * types with a ready-made list; others get a notice with the CSV import and Products tabs.
 */
export function ProducePage() {
  const { shop } = useAct();
  const presets = getPresetsForShopType(shop.type);
  if (presets) return <ProduceList presets={presets} />;
  return (
    <Card title="Ready-made list">
      <p>No ready-made list for this shop type yet.</p>
      <p className="flex flex-wrap gap-4">
        <Link to="../import" relative="path" className="underline">
          CSV import
        </Link>
        <Link to=".." relative="path" className="underline">
          Products
        </Link>
      </p>
    </Card>
  );
}

function ProduceList({ presets }: { presets: PresetList }) {
  const { shop, catalogue, reload } = useAct();
  const fail = useFailure();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [busy, setBusy] = useState(false);
  const existing = new Set(catalogue.products.map((p) => p.name.trim().toLowerCase()));
  const keys = Object.keys(picked);
  const badRate = keys.some((k) => parseRupees(picked[k] ?? '', false).error);

  function toggle(key: string) {
    setPicked((p) => {
      const next = { ...p };
      if (key in next) delete next[key];
      else next[key] = '';
      return next;
    });
  }

  async function add() {
    const choices = presets
      .filter((p) => p.key in picked)
      .map((preset) => ({
        preset,
        rate: parseRupees(picked[preset.key] ?? '', false).paisa,
      }));
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.adminImportProducts(shop.id, {
        rows: presetImportRows(choices),
        on_existing: 'skip',
      });
      setPicked({});
      setDone(`Added ${r.created} products.`);
      await reload();
    } catch (e) {
      setError(fail(e, 'Could not add the products.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fresh produce list">
      {error && <Alert>{error}</Alert>}
      {done && <Notice>{done}</Notice>}
      <p className="text-sm text-muted">
        Tick the items this shop sells. A rate is optional (the owner sets today&apos;s rates).
      </p>
      {(['vegetables', 'greens', 'fruits'] as const).map((category) => (
        <div key={category} className="space-y-1">
          <h3 className="font-semibold">{PRESET_CATEGORIES[category].en}</h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {presets
              .filter((p) => p.category === category)
              .map((p) => {
                const added = existing.has(p.en.toLowerCase());
                const on = p.key in picked;
                return (
                  <li key={p.key} className="flex min-h-11 items-center gap-2">
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={added}
                        onChange={() => toggle(p.key)}
                        className="size-5"
                      />
                      <span>{p.icon ?? ''}</span>
                      <span>{p.en}</span>
                      <span lang="ur" dir="rtl" className="text-muted">
                        {p.ur}
                      </span>
                      <span className="text-muted">/ {p.unit}</span>
                    </label>
                    {added && <span className="text-sm text-muted">Added</span>}
                    {on && (
                      <input
                        aria-label={`Rate for ${p.en} (Rs)`}
                        inputMode="decimal"
                        placeholder="Rate"
                        value={picked[p.key]}
                        onChange={(e) => setPicked((x) => ({ ...x, [p.key]: e.target.value }))}
                        className="min-h-11 w-24 rounded-md border border-border bg-surface px-2"
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      {badRate && <Alert>Check the rates: numbers only, e.g. 120 or 120.50.</Alert>}
      <Button disabled={busy || keys.length === 0 || badRate} onClick={() => void add()}>
        Add {keys.length} products
      </Button>
    </Card>
  );
}
