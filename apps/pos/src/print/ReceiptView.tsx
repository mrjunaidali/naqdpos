import type { ReceiptDoc } from '@naqdpos/core';

/**
 * The receipt as HTML: the on-screen preview and the browser-print layout (58 / 80 mm). Black on
 * white on purpose: it is paper, not app UI (the print styles in index.css hide everything else).
 */
export function ReceiptView({ doc, logoUrl }: { doc: ReceiptDoc; logoUrl?: string | null }) {
  return (
    <div
      className="receipt"
      data-paper={doc.paperWidthMm}
      data-language={doc.language}
      dir={doc.dir}
      lang={doc.language === 'ur' ? 'ur' : 'en'}
    >
      {doc.lines.map((line, i) => {
        switch (line.kind) {
          case 'title':
            return (
              <p key={i} className="receipt-title">
                {line.text}
              </p>
            );
          case 'center':
            return (
              <p key={i} className="receipt-center">
                {line.text}
              </p>
            );
          case 'rule':
            return <hr key={i} className="receipt-rule" />;
          case 'item':
            return (
              <div key={i} className="receipt-item">
                <p>{line.name}</p>
                <p className="receipt-pair">
                  <span>{line.detail}</span>
                  <span>{line.amount}</span>
                </p>
              </div>
            );
          case 'logo':
            // Shop logo (US014), from the device cache.
            return logoUrl ? <img key={i} src={logoUrl} alt="" className="receipt-logo" /> : null;
          case 'pair':
            return (
              <p key={i} className={`receipt-pair${line.strong ? ' receipt-strong' : ''}`}>
                <span>{line.label}</span>
                <span>{line.value}</span>
              </p>
            );
        }
      })}
    </div>
  );
}
