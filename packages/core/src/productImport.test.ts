import { describe, expect, it } from 'vitest';
import { FRESH_PRODUCE } from './presets/freshProduce.ts';
import {
  decodeCsvText,
  inviteMessage,
  parseCsv,
  presetImportRows,
  previewImport,
  whatsAppLink,
} from './productImport.ts';

describe('CSV', () => {
  it('parses quotes, commas and line breaks inside quotes, "" and CRLF', () => {
    expect(parseCsv('name,search_terms\r\n"Tomato, red","tamatar;""desi"""\r\nLine\n\n')).toEqual([
      ['name', 'search_terms'],
      ['Tomato, red', 'tamatar;"desi"'],
      ['Line'],
    ]);
    expect(parseCsv('a,"b\nc"\n')).toEqual([['a', 'b\nc']]);
  });

  it('strips a UTF-8 BOM (Excel "CSV UTF-8")', () => {
    expect(decodeCsvText(String.fromCharCode(0xfeff) + 'name,name_ur\nTomato,ٹماٹر')).toEqual({
      text: 'name,name_ur\nTomato,ٹماٹر',
    });
  });

  it('refuses mis-encoded Urdu and replacement characters', () => {
    // UTF-8 bytes of Urdu read as Windows-1252 / Latin-1 (Excel's plain "CSV").
    const garbled = `name,name_ur\nTomato,${String.fromCharCode(...new TextEncoder().encode('ٹماٹر'))}`;
    expect(decodeCsvText(garbled)).toEqual({ error: 'bad_encoding' });
    expect(decodeCsvText('name\nTom�to')).toEqual({ error: 'bad_encoding' });
  });

  it('every Urdu letter read as Windows-1252 is caught (incl. bytes 0x80-0x9F)', () => {
    const cp1252 = new TextDecoder('windows-1252');
    for (const letter of 'ابپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنوہھءیےآںۓ') {
      const garbled = cp1252.decode(new TextEncoder().encode(`Item,${letter}`));
      expect(decodeCsvText(garbled), letter).toEqual({ error: 'bad_encoding' });
    }
    // Plain English and correct Urdu pass.
    expect(decodeCsvText('Crème,آلو')).toEqual({ text: 'Crème,آلو' });
  });
});

describe('import preview', () => {
  const header = [
    'name',
    'name_ur',
    'unit',
    'category',
    'sale_price',
    'cost_price',
    'search_terms',
  ];
  it('validates each row: missing name, bad unit, negative price, duplicates; flags existing names', () => {
    const p = previewImport(
      [
        header,
        ['Tomato', 'ٹماٹر', 'kg', 'Vegetables', '160', '120', 'tamatar; tomatar'],
        ['', '', 'kg', '', '10', '', ''],
        ['Onion', '', 'sack', '', '80', '', ''],
        ['Potato', '', 'kg', '', '-5', '', ''],
        ['tomato', '', 'kg', '', '150', '', ''],
        ['Mint', '', 'bundle', 'Greens', '', '', ''],
      ],
      ['Mint'],
    );
    expect(p.rows.map((r) => [r.line, r.errors])).toEqual([
      [2, []],
      [3, ['name_required']],
      [4, ['bad_unit']],
      [5, ['bad_sale_price']],
      [6, ['duplicate_in_file']],
      [7, []],
    ]);
    expect(p.valid.map((r) => r.name)).toEqual(['Tomato', 'Mint']);
    expect(p.valid[0]).toEqual({
      name: 'Tomato',
      name_ur: 'ٹماٹر',
      unit: 'kg',
      category: 'Vegetables',
      sale_price_paisa: 16000,
      cost_price_paisa: 12000,
      search_terms: ['tamatar', 'tomatar'],
    });
    expect(p.rows[5]!.exists).toBe(true);
    expect(p.existingCount).toBe(1);
    expect(p.errorCount).toBe(4);
  });

  it('a missing required column blocks the import', () => {
    const p = previewImport(
      [
        ['name', 'price'],
        ['Tomato', '10'],
      ],
      [],
    );
    expect(p.missingColumns).toEqual(['unit', 'sale_price']);
    expect(p.valid).toEqual([]);
  });
});

describe('presets and the invite message', () => {
  it('fresh produce picks become import rows with categories, Urdu and icons', () => {
    const tomato = FRESH_PRODUCE.find((x) => x.key === 'tomato')!;
    expect(presetImportRows([{ preset: tomato, rate: 16500 }])[0]).toMatchObject({
      name: 'Tomato',
      unit: 'kg',
      category: 'Vegetables',
      category_ur: 'سبزیاں',
      sale_price_paisa: 16500,
    });
  });

  it('WhatsApp text', () => {
    expect(inviteMessage('Ali Fruit', 'https://pos.naqdpos.pk', 'ali@example.test')).toBe(
      'Assalam o alaikum! Your shop Ali Fruit is ready on NaqdPOS. Open https://pos.naqdpos.pk and sign in with ali@example.test.',
    );
  });

  it('wa.me link to the owner mobile with the text encoded', () => {
    expect(whatsAppLink('+923001234567', 'Open https://x.pk & sign in')).toBe(
      'https://wa.me/923001234567?text=Open%20https%3A%2F%2Fx.pk%20%26%20sign%20in',
    );
  });
});
