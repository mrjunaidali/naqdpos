import {
  parseRupees,
  PRESET_CATEGORIES,
  searchItems,
  type PresetCategory,
  type PresetList,
  type ProducePreset,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Alert, Button } from '../../ui/Button.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { useShopPresets } from './catalogueData.ts';
import { ProductIcon } from './ProductIcon.tsx';
import {
  createFromPresets,
  presetStatus,
  productsByName,
  type PresetChoice,
} from './catalogueRepo.ts';
import { selectAllState, toggleAll } from './presetSelection.ts';

const CATEGORY_ORDER: PresetCategory[] = ['vegetables', 'greens', 'fruits'];

/**
 * "Add from list" (US072, docs/features/produce-presets.md): tick what the shop sells, optionally
 * type today's rate, save once. Existing products show "Added"; hidden ones show "Hidden" and are
 * restored when ticked. Also the onboarding step for fruit & veg shops (?from=onboarding).
 * The list follows the shop's type (getPresetsForShopType): a type without one gets a notice
 * here (and onboarding skips the step), never another type's list.
 */
export function PresetPickerPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const fromOnboarding = params.get('from') === 'onboarding';
  const presets = useShopPresets();
  if (presets === undefined) return null;
  if (presets) return <PresetPicker presets={presets} fromOnboarding={fromOnboarding} />;
  // No list for this type: onboarding goes straight home; opened directly, say so.
  if (fromOnboarding) return <Navigate to="/" replace />;
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('presets.title')}</h1>
      <p className="rounded-2xl border border-border bg-surface p-4">{t('presets.noneForType')}</p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/products/new"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-primary-fg"
        >
          {t('products.add')}
        </Link>
        <Link
          to="/products"
          className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 font-medium text-text"
        >
          {t('products.title')}
        </Link>
      </div>
      <p className="text-sm text-muted">{t('presets.csvHint')}</p>
    </section>
  );
}

function PresetPicker({
  presets,
  fromOnboarding,
}: {
  presets: PresetList;
  fromOnboarding: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const actor = useActingOwnerId();
  const byName = useLiveQuery(productsByName);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  /** focDefault presets the owner wants to give free with purchases (off by default). */
  const [focFree, setFocFree] = useState<Set<string>>(new Set());
  const [rateErrors, setRateErrors] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const shown = useMemo(
    () =>
      searchItems(
        presets.map((p) => ({ ...p, name: p.en, name_ur: p.ur, search_terms: p.roman })),
        query,
      ),
    [presets, query],
  );
  /** Keys "Select all" acts on: what the search shows, minus rows already added. */
  const selectable = useMemo(
    () =>
      byName ? shown.filter((p) => presetStatus(p, byName) !== 'added').map((p) => p.key) : [],
    [shown, byName],
  );
  const allState = selectAllState(selectable, picked);
  const allRef = useRef<HTMLInputElement>(null);
  // "indeterminate" is a DOM property only; React has no attribute for it.
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = allState === 'some';
  });
  const done = () => void navigate(fromOnboarding ? '/' : '/products', { replace: fromOnboarding });

  function toggle(preset: ProducePreset) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(preset.key)) next.delete(preset.key);
      else next.set(preset.key, '');
      return next;
    });
  }

  async function save() {
    const choices: PresetChoice[] = [];
    const bad = new Set<string>();
    for (const preset of presets) {
      const rate = picked.get(preset.key);
      if (rate === undefined) continue;
      const parsed = parseRupees(rate, false);
      if (parsed.error) bad.add(preset.key);
      else choices.push({ preset, rate: parsed.paisa, focFree: focFree.has(preset.key) });
    }
    setRateErrors(bad);
    if (bad.size || choices.length === 0) return;
    setBusy(true);
    try {
      await createFromPresets(choices, actor);
      done();
    } finally {
      setBusy(false);
    }
  }

  if (!byName) return null;
  const ur = i18n.language === 'ur';

  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('presets.title')}</h1>
      <p className="text-muted">{t('presets.intro')}</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('presets.searchPlaceholder')}
        aria-label={t('presets.search')}
        className="min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-lg"
      />
      {rateErrors.size > 0 && <Alert>{t('presets.rateError')}</Alert>}
      <label className="flex min-h-11 items-center gap-3 px-3 font-medium">
        <input
          ref={allRef}
          type="checkbox"
          checked={allState === 'all'}
          disabled={selectable.length === 0}
          onChange={() => setPicked((prev) => toggleAll(selectable, prev))}
          className="size-5 accent-primary"
        />
        {t('presets.selectAll')}
      </label>

      {CATEGORY_ORDER.map((category) => {
        const items = shown.filter((p) => p.category === category);
        if (items.length === 0) return null;
        const names = PRESET_CATEGORIES[category];
        return (
          <div key={category} className="space-y-2">
            <h2 className="text-lg font-semibold">{ur ? names.ur : names.en}</h2>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {items.map((preset) => {
                const status = presetStatus(preset, byName);
                const checked = picked.has(preset.key);
                return (
                  <li key={preset.key} className="space-y-2 px-3 py-2">
                    <label className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={status === 'added' || checked}
                        disabled={status === 'added'}
                        onChange={() => toggle(preset)}
                        className="size-5 accent-primary"
                      />
                      <span className="w-10 shrink-0 text-center">
                        <ProductIcon icon={preset.icon} />
                      </span>
                      <span className="flex-1">
                        <span className="block font-medium">{ur ? preset.ur : preset.en}</span>
                        <span className="block text-sm text-muted">
                          {ur ? preset.en : preset.ur} · {t(`unit.${preset.unit}`)}
                          {preset.focDefault ? ` · ${t('presets.focHint')}` : ''}
                        </span>
                      </span>
                      {status !== 'new' && (
                        <span className="rounded-full bg-bg px-2 py-1 text-xs text-muted">
                          {status === 'added' ? t('presets.added') : t('presets.hidden')}
                        </span>
                      )}
                    </label>
                    {checked && (
                      <input
                        inputMode="decimal"
                        dir="ltr"
                        value={picked.get(preset.key)}
                        onChange={(e) =>
                          setPicked((prev) => new Map(prev).set(preset.key, e.target.value))
                        }
                        aria-label={t('presets.rateFor', { name: preset.en })}
                        aria-invalid={rateErrors.has(preset.key) || undefined}
                        placeholder={t('presets.ratePlaceholder', {
                          unit: t(`unit.${preset.unit}`),
                        })}
                        className={`min-h-11 w-full rounded-md border px-3 ${
                          rateErrors.has(preset.key) ? 'border-danger' : 'border-border'
                        }`}
                      />
                    )}
                    {checked && preset.focDefault && (
                      <label className="flex min-h-11 items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={focFree.has(preset.key)}
                          onChange={(e) =>
                            setFocFree((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(preset.key);
                              else next.delete(preset.key);
                              return next;
                            })
                          }
                          aria-label={t('presets.focFreeFor', { name: preset.en })}
                          className="size-5 accent-primary"
                        />
                        {t('presets.focFree')}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* Sticky right above the nav, so the add button never hides behind it. */}
      <div className="sticky bottom-nav z-10 -mx-4 flex gap-2 border-t border-border bg-surface p-3">
        {fromOnboarding && (
          <Button variant="secondary" onClick={done}>
            {t('presets.skip')}
          </Button>
        )}
        <Button disabled={busy || picked.size === 0} onClick={() => void save()}>
          {t('presets.save', { count: picked.size })}
        </Button>
      </div>
    </section>
  );
}
