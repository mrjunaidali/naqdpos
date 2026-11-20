import { useTranslation } from 'react-i18next';
import { useToastStore } from './toastStore.ts';

/** Toasts above the cart bar; dismissible, never blocking. */
export function Toaster() {
  const { t } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-primary px-4 py-2 text-primary-fg"
        >
          <span className="flex-1">{toast.text}</span>
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-md"
            aria-label={t('common.close')}
            onClick={() => dismiss(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
