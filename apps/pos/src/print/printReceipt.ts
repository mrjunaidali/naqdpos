import type { ReceiptDoc } from '@naqdpos/core';

/** Browser print at the paper width: a page-size rule only while printing. */
export function printReceipt(doc: ReceiptDoc) {
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
