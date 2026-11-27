// `pnpm email:preview <template> <en|ur>` (docs/emails.md): renders one email with sample values
// into .email-preview/ (gitignored) so the wording and layout can be checked in a browser. It
// loads the templates exactly as the API does, so a broken file fails here with the same message.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMAIL_LANGUAGES, type EmailLanguage } from '@naqdpos/core';
import {
  loadEmailTemplates,
  renderEmail,
  TEMPLATE_NAMES,
  type TemplateName,
  type TemplateValues,
} from '../src/email/templates.ts';

const SAMPLES: { [N in TemplateName]: TemplateValues<N> } = {
  'sign-in-code': { code: '482913', expiresInMinutes: '5' },
  'pin-reset-code': { code: '730215', expiresInMinutes: '5' },
  invite: {
    shopName: 'Ali Fruit & Sabzi',
    inviteLink: 'https://pos.naqd.pk',
    email: 'ali@example.com',
  },
};

const [name, language] = process.argv.slice(2);
const usage = `Usage: pnpm email:preview <${TEMPLATE_NAMES.join('|')}> <${EMAIL_LANGUAGES.join('|')}>`;
if (!TEMPLATE_NAMES.includes(name as TemplateName)) {
  console.error(name ? `email:preview: unknown template "${name}"\n${usage}` : usage);
  process.exit(1);
}
if (!EMAIL_LANGUAGES.includes(language as EmailLanguage)) {
  console.error(language ? `email:preview: unknown language "${language}"\n${usage}` : usage);
  process.exit(1);
}

let templates;
try {
  templates = loadEmailTemplates();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const template = name as TemplateName;
const lang = language as EmailLanguage;
const mail = renderEmail(templates, template, lang, SAMPLES[template] as never);

// The repo root, wherever the command is started from (pnpm runs root scripts there anyway).
const dir = new URL('../../../.email-preview/', import.meta.url);
mkdirSync(dir, { recursive: true });
const html = new URL(`${template}.${lang}.html`, dir);
const text = new URL(`${template}.${lang}.txt`, dir);
writeFileSync(html, mail.html);
writeFileSync(text, `Subject: ${mail.subject}\n\n${mail.text}\n`);

console.log(`Subject: ${mail.subject}`);
console.log(`HTML: ${fileURLToPath(html)}`);
console.log(`Text: ${fileURLToPath(text)}`);
console.log(`Open in the browser: ${html.href}`);
