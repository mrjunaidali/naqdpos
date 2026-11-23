import type { ShopRow } from '@naqdpos/core';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/index.ts';
import { useOnline } from '../../app/useOnline.ts';
import { Alert, Button } from '../../ui/Button.tsx';
import { showToast } from '../../ui/toastStore.ts';
import { LogoNotUsable, removeLogo, uploadLogo, useShopLogo } from './logo.ts';

/** Is object storage configured on the server? Asked once per page; offline → unknown. */
function useFilesEnabled(online: boolean): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!online) return;
    let live = true;
    api.config().then(
      (c) => live && setEnabled(c.files),
      () => live && setEnabled(null),
    );
    return () => {
      live = false;
    };
  }, [online]);
  return enabled;
}

/**
 * Settings → Shop → Logo (US014, owner). Hidden when the server has no file storage (local dev).
 * Changing it needs the internet; showing it doesn't (the picture is kept on the device).
 */
export function LogoField({ shop, actorStaffId }: { shop: ShopRow; actorStaffId: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const enabled = useFilesEnabled(online);
  const logo = useShopLogo();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (enabled === false && !shop.logo_path) return null;
  if (enabled === null && !shop.logo_path) return null;

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      showToast(t('shopProfile.logoSaved'));
    } catch (e) {
      setError(t(`shopProfile.logoErrors.${e instanceof LogoNotUsable ? e.reason : 'failed'}`));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const canChange = online && enabled === true && !busy;
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">{t('shopProfile.logo')}</legend>
      <div className="flex items-center gap-3">
        <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface">
          {logo && (
            <img
              src={logo}
              alt={t('shopProfile.logoPreview')}
              className="size-full object-contain"
            />
          )}
        </span>
        <p className="text-sm text-muted">{t('shopProfile.logoHint')}</p>
      </div>
      {!online && <p className="text-sm text-muted">{t('shopProfile.logoOffline')}</p>}
      {error && <Alert>{error}</Alert>}
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        disabled={!canChange}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void act(() => uploadLogo(file, actorStaffId));
        }}
      />
      <div className="flex gap-2">
        <label
          htmlFor={inputId}
          aria-disabled={!canChange}
          className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-4 font-medium ${
            canChange ? 'text-text' : 'pointer-events-none text-muted'
          }`}
        >
          {busy
            ? t('shopProfile.logoUploading')
            : shop.logo_path
              ? t('shopProfile.logoChange')
              : t('shopProfile.logoChoose')}
        </label>
        {shop.logo_path && (
          <Button
            type="button"
            variant="secondary"
            disabled={!canChange}
            onClick={() => void act(() => removeLogo(actorStaffId))}
          >
            {t('shopProfile.logoRemove')}
          </Button>
        )}
      </div>
    </fieldset>
  );
}
