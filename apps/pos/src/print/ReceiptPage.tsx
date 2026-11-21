import { receiptText, type ReceiptDoc } from '@naqdpos/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { useViewer, visibleTo } from '../features/sale/saleVisibility.ts';
import { Alert, Button } from '../ui/Button.tsx';
import { showToast } from '../ui/toastStore.ts';
import {
  bluetoothSupported,
  forgetPrinter,
  printBytes,
  PrinterError,
  savedPrinter,
  type SavedPrinter,
} from './bluetooth.ts';
import { receiptToEscpos } from './canvasReceipt.ts';
import { useSaleReceipt } from './receiptData.ts';
import { ReceiptView } from './ReceiptView.tsx';
import { shareReceipt } from './share.ts';

/** Browser print at the paper width: a page-size rule only while printing. */
function printReceipt(doc: ReceiptDoc) {
  const style = document.createElement('style');
  style.textContent = `@page { size: ${doc.paperWidthMm}mm auto; margin: 0; }`;
  document.head.append(style);
  const done = () => {
    style.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/**
 * Receipt (US036): preview in the shop's receipt language, WhatsApp share, browser print (58 / 80
 * mm; Android via RawBT) and direct Bluetooth printing where Web Bluetooth exists. Offline.
 */
export function ReceiptPage() {
  const { saleId } = useParams();
  const { t } = useTranslation();
  const location = useLocation();
  const change = (location.state as { change?: number } | null)?.change;
  const receipt = useSaleReceipt(saleId, change);
  const viewer = useViewer();
  const [printer, setPrinter] = useState<SavedPrinter | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const canBluetooth = bluetoothSupported();

  useEffect(() => {
    void savedPrinter().then(setPrinter);
  }, []);

  if (receipt === undefined || !viewer.ready) return null;
  if (
    receipt === null ||
    !visibleTo({ staff_id: receipt.saleStaffId }, viewer.staffId, viewer.isOwner)
  ) {
    return <p className="text-muted">{t('receipt.notFound')}</p>;
  }
  const { doc } = receipt;

  async function share() {
    const outcome = await shareReceipt(receiptText(doc), receipt!.customerMobile);
    if (outcome === 'copied') showToast(t('receipt.copied'));
    if (outcome === 'failed') setError(t('receipt.shareFailed'));
  }

  async function bluetooth() {
    setBusy(true);
    setError(undefined);
    try {
      await printBytes(await receiptToEscpos(doc));
      setPrinter(await savedPrinter());
      showToast(t('receipt.printed'));
    } catch (e) {
      setError(t(`receipt.errors.${e instanceof PrinterError ? e.reason : 'failed'}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md space-y-4 pb-8">
      <h1 className="text-2xl font-bold">{t('receipt.title')}</h1>
      <div className="receipt-print overflow-x-auto rounded-2xl border border-border bg-surface p-3">
        <ReceiptView doc={doc} />
      </div>
      {error && <Alert>{error}</Alert>}
      <Button onClick={() => void share()}>{t('receipt.shareWhatsapp')}</Button>
      <Button variant="secondary" onClick={() => printReceipt(doc)}>
        {t('receipt.print')}
      </Button>
      {canBluetooth && (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => void bluetooth()}>
            {busy ? t('receipt.printing') : t('receipt.bluetooth')}
          </Button>
          {printer && (
            <button
              type="button"
              className="min-h-11 w-full text-sm text-muted underline"
              onClick={() => void forgetPrinter().then(() => setPrinter(null))}
            >
              {t('receipt.forgetPrinter', { name: printer.name ?? '' })}
            </button>
          )}
        </>
      )}
      <Link
        to="/sale"
        replace
        className="flex min-h-12 items-center justify-center rounded-md text-text underline"
      >
        {t('receipt.done')}
      </Link>
    </section>
  );
}
