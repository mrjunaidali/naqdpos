import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EMAIL_LANGUAGES } from '@naqdpos/core';
import { afterEach, describe, expect, it } from 'vitest';
import { codeEmail, inviteEmail } from '../mailer.ts';
import {
  escapeHtml,
  fill,
  loadEmailTemplates,
  parseHtmlTemplate,
  parseTextTemplate,
  placeholdersIn,
  renderEmail,
  TEMPLATE_DIR,
  TEMPLATE_NAMES,
  TEMPLATE_PLACEHOLDERS,
  type TemplateName,
} from './templates.ts';

/** Sample values; each is distinct so the test can find every one in the output. */
const SAMPLES: { [N in TemplateName]: Record<(typeof TEMPLATE_PLACEHOLDERS)[N][number], string> } =
  {
    'sign-in-code': { code: '482913', expiresInMinutes: '5' },
    'pin-reset-code': { code: '123456', expiresInMinutes: '5' },
    invite: { shopName: 'Ali Fruit', inviteLink: 'https://pos.naqd.pk', email: 'ali@example.com' },
  };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the real templates folder, so one file can be broken. */
function copyOfTemplates(): { dir: URL; path: string } {
  const path = mkdtempSync(join(tmpdir(), 'naqdpos-emails-'));
  dirs.push(path);
  for (const file of readdirSync(TEMPLATE_DIR))
    if (/\.(txt|html)$/.test(file)) copyFileSync(new URL(file, TEMPLATE_DIR), join(path, file));
  return { dir: pathToFileURL(`${path}/`), path };
}

const real = loadEmailTemplates();

describe('every template in every language', () => {
  for (const name of TEMPLATE_NAMES)
    for (const lang of EMAIL_LANGUAGES)
      it(`${name}.${lang}: renders with every placeholder filled, in text and HTML`, () => {
        const template = real.templates[name][lang];
        const expected = [...TEMPLATE_PLACEHOLDERS[name]].sort();
        // Each body uses exactly the placeholders this email takes: none missing, none misspelt.
        expect(placeholdersIn(template.text).sort()).toEqual(expected);
        expect(placeholdersIn(template.html).sort()).toEqual(expected);
        for (const key of placeholdersIn(template.subject)) expect(expected).toContain(key);

        const values = SAMPLES[name] as Record<string, string>;
        const mail = renderEmail(real, name, lang, SAMPLES[name] as never);
        for (const part of [mail.subject, mail.text, mail.html])
          expect(part).not.toMatch(/\{\{|\}\}/);
        for (const value of Object.values(values)) {
          expect(mail.text).toContain(value);
          expect(mail.html).toContain(escapeHtml(value));
        }
        expect(mail.html).toContain(`<title>${escapeHtml(mail.subject)}</title>`);
      });

  for (const name of TEMPLATE_NAMES)
    it(`${name}: English and Urdu use the same placeholders in subject, text and HTML`, () => {
      for (const part of ['subject', 'text', 'html'] as const) {
        const [en, ur] = EMAIL_LANGUAGES.map((lang) =>
          placeholdersIn(real.templates[name][lang][part]).sort(),
        );
        expect(ur, `${name} ${part}`).toEqual(en);
      }
    });
});

describe('wording (unchanged from before the templates)', () => {
  it('sign-in code', () => {
    expect(codeEmail('sign-in', '482913', 'en')).toMatchObject({
      subject: 'NaqdPOS sign-in code',
      text: 'Your NaqdPOS sign-in code is 482913. It is valid for 5 minutes. If you did not ask for it, ignore this email.',
    });
    expect(codeEmail('sign-in', '482913', 'ur')).toMatchObject({
      subject: 'NaqdPOS لاگ ان کوڈ',
      text: 'آپ کا NaqdPOS لاگ ان کوڈ 482913 ہے۔ یہ 5 منٹ کے لیے درست ہے۔ اگر آپ نے یہ کوڈ نہیں مانگا تو اس ای میل کو نظر انداز کریں۔',
    });
  });

  it('PIN reset code (Better Auth type email-verification)', () => {
    expect(codeEmail('email-verification', '123456', 'en')).toMatchObject({
      subject: 'NaqdPOS PIN reset code',
      text: 'Your NaqdPOS PIN reset code is 123456. It is valid for 5 minutes. If you did not ask to reset your PIN, ignore this email.',
    });
    expect(codeEmail('email-verification', '123456', 'ur')).toMatchObject({
      subject: 'NaqdPOS PIN ری سیٹ کوڈ',
      text: 'آپ کا NaqdPOS PIN ری سیٹ کوڈ 123456 ہے۔ یہ 5 منٹ کے لیے درست ہے۔ اگر آپ نے PIN بدلنے کا نہیں کہا تو اس ای میل کو نظر انداز کریں۔',
    });
  });

  it('shop invite', () => {
    expect(inviteEmail('Ali Fruit', 'https://pos.naqd.pk', 'ali@example.com', 'en')).toMatchObject({
      subject: 'Your shop Ali Fruit is ready on NaqdPOS',
      text: 'Assalam o alaikum! Your shop Ali Fruit is ready on NaqdPOS. Open https://pos.naqd.pk and sign in with ali@example.com.',
    });
    expect(inviteEmail('Ali Fruit', 'https://pos.naqd.pk', 'ali@example.com', 'ur')).toMatchObject({
      subject: 'آپ کی دکان Ali Fruit NaqdPOS پر تیار ہے',
      text: 'السلام علیکم! آپ کی دکان Ali Fruit NaqdPOS پر تیار ہے۔ https://pos.naqd.pk کھولیں اور ali@example.com سے سائن ان کریں۔',
    });
  });

  it('without a language, English', () => {
    expect(codeEmail('sign-in', '1').subject).toBe('NaqdPOS sign-in code');
    expect(inviteEmail('S', 'https://x.pk', 'a@b.pk').subject).toBe(
      'Your shop S is ready on NaqdPOS',
    );
  });
});

describe('HTML', () => {
  it('escapes every value in the HTML; the plain text keeps it as typed', () => {
    const name = `<b>Ali & "Sons"</b> 'Fruit'`;
    const mail = inviteEmail(name, 'https://pos.naqd.pk/?a=1&b=2', 'ali@example.com', 'en');
    expect(mail.html).toContain('&lt;b&gt;Ali &amp; &quot;Sons&quot;&lt;/b&gt; &#39;Fruit&#39;');
    expect(mail.html).not.toContain('<b>Ali');
    expect(mail.html).toContain('href="https://pos.naqd.pk/?a=1&amp;b=2"');
    expect(mail.text).toContain(name);
    // The page title is the subject, escaped too.
    expect(mail.html).toContain('<title>Your shop &lt;b&gt;Ali');
  });

  it('a value with $ signs or braces goes in literally', () => {
    const mail = inviteEmail('Rs $& {{inviteLink}}', 'https://pos.naqd.pk', 'a@b.pk', 'en');
    expect(mail.subject).toBe('Your shop Rs $& {{inviteLink}} is ready on NaqdPOS');
  });

  it('English is left to right; Urdu is rtl, lang ur, right aligned, Urdu fonts first', () => {
    const en = codeEmail('sign-in', '482913', 'en').html;
    expect(en).toContain('<html lang="en" dir="ltr">');
    const ur = codeEmail('sign-in', '482913', 'ur').html;
    expect(ur).toContain('<html lang="ur" dir="rtl">');
    expect(ur).toContain('text-align: right');
    expect(ur).toMatch(/font-family: 'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq'/);
  });

  it('in Urdu, codes, links and email addresses stay left to right', () => {
    expect(codeEmail('sign-in', '482913', 'ur').html).toMatch(
      /<strong dir="ltr"[^>]*>482913<\/strong>/,
    );
    expect(codeEmail('email-verification', '123456', 'ur').html).toMatch(
      /<strong dir="ltr"[^>]*>123456<\/strong>/,
    );
    const invite = inviteEmail('Ali Fruit', 'https://pos.naqd.pk', 'ali@example.com', 'ur').html;
    expect(invite).toMatch(
      /<a href="https:\/\/pos\.naqd\.pk" dir="ltr"[^>]*>https:\/\/pos\.naqd\.pk<\/a>/,
    );
    expect(invite).toMatch(/<strong dir="ltr"[^>]*>ali@example\.com<\/strong>/);
  });

  it('every email has the NaqdPOS name and a footer in its language', () => {
    for (const name of TEMPLATE_NAMES) {
      const en = renderEmail(real, name, 'en', SAMPLES[name] as never).html;
      const ur = renderEmail(real, name, 'ur', SAMPLES[name] as never).html;
      expect(en).toContain('>NaqdPOS</td>');
      expect(en).toContain('You received this because');
      expect(ur).toContain('<span dir="ltr">NaqdPOS</span>');
      expect(ur).toContain('آپ کو یہ ای میل اس لیے ملی');
    }
  });

  it('inline styles only: no <style>, stylesheet links, scripts or external images', () => {
    for (const file of readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(new URL(file, TEMPLATE_DIR), 'utf8');
      expect(html, file).not.toMatch(/<style|<link|<script|<img|class="/i);
    }
  });
});

describe('broken template files are refused, naming the file', () => {
  it.each([
    [
      'no subject line',
      'Hello {{code}} {{expiresInMinutes}}',
      'the first line must be "Subject: …"',
    ],
    [
      'an empty subject',
      'Subject:  \n\nHello {{code}} {{expiresInMinutes}}',
      'the subject is empty',
    ],
    [
      'no empty second line',
      'Subject: C\nHello {{code}} {{expiresInMinutes}}',
      'the second line must be empty',
    ],
    ['an empty text', 'Subject: C\n\n  \n', 'the text is empty'],
    [
      'a misspelt placeholder',
      'Subject: C\n\n{{code}} {{expiresInMinutes}} {{expiresInMinuts}}',
      'unknown placeholder {{expiresInMinuts}} in the text',
    ],
    [
      'the code missing',
      'Subject: C\n\nValid {{expiresInMinutes}} minutes.',
      'the text must contain {{code}}',
    ],
    [
      'a misspelt placeholder in the subject',
      'Subject: {{cod}}\n\n{{code}} {{expiresInMinutes}}',
      'unknown placeholder {{cod}} in the subject',
    ],
  ])('text with %s', (_, source, problem) => {
    expect(() => parseTextTemplate('sign-in-code', 'sign-in-code.en.txt', source)).toThrow(
      `Email template sign-in-code.en.txt: ${problem}`,
    );
  });

  it('HTML with a missing or misspelt placeholder', () => {
    expect(() =>
      parseHtmlTemplate('invite', 'invite.ur.html', '<p>{{shopName}} {{inviteLnk}} {{email}}</p>'),
    ).toThrow(
      'invite.ur.html: unknown placeholder {{inviteLnk}} in the HTML (allowed: shopName, inviteLink, email); the HTML must contain {{inviteLink}}',
    );
  });

  it('a value left unfilled is an error, never an email with {{…}} in it', () => {
    expect(() => fill('Code {{code}}', {})).toThrow('Email: no value for {{code}}');
  });

  it('accepts what Windows editors save: a BOM, CRLF line ends, trailing blank lines', () => {
    const bom = String.fromCharCode(0xfeff);
    const t = parseTextTemplate(
      'sign-in-code',
      'x.txt',
      `${bom}Subject: Code\r\n\r\nLine one {{code}}.\r\n\r\nValid {{expiresInMinutes}}.\r\n\r\n`,
    );
    expect(t).toEqual({
      subject: 'Code',
      text: 'Line one {{code}}.\n\nValid {{expiresInMinutes}}.',
    });
  });

  it('English and Urdu with different placeholders in the subject', () => {
    const { dir, path } = copyOfTemplates();
    writeFileSync(
      join(path, 'invite.ur.txt'),
      'Subject: دکان تیار ہے\n\n{{shopName}} {{inviteLink}} {{email}}',
    );
    expect(() => loadEmailTemplates(dir)).toThrow(
      'Email template invite: English and Urdu use different placeholders in the subject (en: shopName; ur: none)',
    );
  });

  it('lists every broken or missing file at once, layouts included', () => {
    const { dir, path } = copyOfTemplates();
    unlinkSync(join(path, 'invite.ur.html'));
    writeFileSync(
      join(path, 'sign-in-code.en.txt'),
      'Subject: Code\n\nNo code {{expiresInMinutes}}.',
    );
    writeFileSync(join(path, 'layout.ur.html'), '<html><title>{{subject}}</title></html>');
    expect(() => loadEmailTemplates(dir)).toThrow(
      [
        'Email template layout.ur.html: the layout must contain {{content}}',
        'Email template sign-in-code.en.txt: the text must contain {{code}}',
        'Email template invite.ur.html: file missing',
      ].join('\n'),
    );
  });

  it('a changed file changes the email without code changes', () => {
    const { dir, path } = copyOfTemplates();
    writeFileSync(
      join(path, 'sign-in-code.en.txt'),
      'Subject: Your code\n\nCode: {{code}} ({{expiresInMinutes}} min)',
    );
    const mail = renderEmail(loadEmailTemplates(dir), 'sign-in-code', 'en', {
      code: '111222',
      expiresInMinutes: '5',
    });
    expect(mail).toMatchObject({ subject: 'Your code', text: 'Code: 111222 (5 min)' });
  });
});
