// Draws a receipt on a canvas at the printer's dot width (384 for 58 mm, 576 for 80 mm), with the
// app's Urdu font, so Bluetooth printers print Urdu as an image. Kept small: the byte conversion
// (toMonoRaster / escposRaster in core) is what the tests cover.
import { escposRaster, PRINTER_DOTS, toMonoRaster, type ReceiptDoc } from '@naqdpos/core';

const FONT = "'Noto Naskh Arabic', sans-serif";

export async function receiptToEscpos(doc: ReceiptDoc): Promise<Uint8Array> {
  const width = PRINTER_DOTS[doc.paperWidthMm];
  const base = doc.paperWidthMm === 58 ? 22 : 26;
  const pad = 4;
  // Make sure the Urdu font is loaded before drawing (it is precached, so this works offline).
  await document.fonts?.load(`${base}px ${FONT}`).catch(() => undefined);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  const rtl = doc.dir === 'rtl';
  const lineHeight = (size: number) => Math.round(size * 1.6);

  // First pass measures the height; the second draws.
  const draw = (paint: boolean): number => {
    let y = pad;
    const text = (s: string, size: number, align: 'start' | 'end' | 'center', bold = false) => {
      ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textAlign = align === 'center' ? 'center' : align;
      const x = align === 'center' ? width / 2 : (align === 'start') !== rtl ? pad : width - pad;
      if (paint) ctx.fillText(s, x, y + size);
    };
    for (const line of doc.lines) {
      switch (line.kind) {
        case 'title':
          text(line.text, base + 8, 'center', true);
          y += lineHeight(base + 8);
          break;
        case 'center':
          text(line.text, base, 'center');
          y += lineHeight(base);
          break;
        case 'rule':
          if (paint) ctx.fillRect(pad, y + base / 2, width - pad * 2, 2);
          y += lineHeight(base) / 1.5;
          break;
        case 'item':
          text(line.name, base, 'start', true);
          y += lineHeight(base);
          text(line.detail, base - 2, 'start');
          text(line.amount, base, 'end');
          y += lineHeight(base);
          break;
        case 'pair':
          text(line.label, base, 'start', line.strong);
          text(line.value, base, 'end', line.strong);
          y += lineHeight(base);
          break;
      }
    }
    return Math.ceil(y + pad);
  };

  canvas.width = width;
  canvas.height = draw(false);
  ctx.fillStyle = '#fff'; // paper
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000'; // ink
  draw(true);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return escposRaster(toMonoRaster(image));
}
