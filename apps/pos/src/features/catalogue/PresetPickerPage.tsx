import {
  parseRupees,
  presetsForPicker,
  PRESET_CATEGORIES,
  searchItems,
  type PresetCategory,
  type ProducePreset,
} from '@naqdpos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Button } from '../../ui/Button.tsx';
import { useActingOwnerId } from '../pin/actingOwner.ts';
import { ProductIcon } from './ProductIcon.tsx';
import {
  createFromPresets,
  presetStatus,
  productsByName,
  type PresetChoice,
} from './catalogueRepo.ts';

const PICKER = presetsForPicker();
const CATEGORY_ORDER: PresetCategory[] = ['vegetables', 'greens', 'fruits'];

/**
 * "Add from list" (US072, docs/features/produce-presets.md): tick what the shop sells, optionally
 * type today's rate, save once. Existing products show "Added"; hidden ones show "Hidden" and are
 * restored when ticked. Also the onboarding step for fruit & veg shops (?from=onboarding).
 */
export function PresetPickerPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromOnboarding = params.get('from') === 'onboarding';
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
        PICKER.map((p) => ({ ...p, name: p.en, name_ur: p.ur, search_terms: p.roman })),
        query,
      ),
    [query],
  );
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
    for (const preset of PICKER) {
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
    <section className="mx-auto max-w-xl space-y-4 pb-24">
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

      <div className="fixed inset-x-0 bottom-0 flex gap-2 border-t border-border bg-surface p-3">
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
