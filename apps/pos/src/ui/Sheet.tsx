import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet on phones, centred dialog on wider screens. Theme tokens only. */
export function Sheet({ title, onClose, children }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-text/40 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-2xl sm:pb-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" className="min-h-11 min-w-11 rounded-md" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
