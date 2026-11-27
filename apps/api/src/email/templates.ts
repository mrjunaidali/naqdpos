// Email wording lives in files under apps/api/emails (docs/emails.md), so it can be changed
// without touching code. Per email and language: `<name>.<lang>.txt` (subject + plain text) and
// `<name>.<lang>.html` (HTML body); `layout.<lang>.html` wraps every HTML body. The files hold
// only text and {{placeholders}}; all logic is here.
//
// Everything is read and checked once when the API starts: a missing file, a missing subject, a
// misspelt or missing placeholder, or English and Urdu using different placeholders stops the
// start (and so the deploy) with a message naming the file, instead of mailing a broken email.
import { readFileSync } from 'node:fs';
import { EMAIL_LANGUAGES, type EmailLanguage } from '@naqdpos/core';

/** Every email and the placeholders it takes. Each body (text and HTML) must use all of them. */
export const TEMPLATE_PLACEHOLDERS = {
  'sign-in-code': ['code', 'expiresInMinutes'],
  'pin-reset-code': ['code', 'expiresInMinutes'],
  invite: ['shopName', 'inviteLink', 'email'],
} as const satisfies Record<string, readonly string[]>;

export type TemplateName = keyof typeof TEMPLATE_PLACEHOLDERS;
export const TEMPLATE_NAMES = Object.keys(TEMPLATE_PLACEHOLDERS) as TemplateName[];
export type TemplateValues<N extends TemplateName> = Record<
  (typeof TEMPLATE_PLACEHOLDERS)[N][number],
  string
>;

/** The layout's two slots: the subject (as the page title) and the email's HTML body. */
const LAYOUT_PLACEHOLDERS = ['subject', 'content'] as const;

export interface Template {
  subject: string;
  text: string;
  /** The HTML body, without the layout. */
  html: string;
}

export interface EmailTemplates {
  templates: Record<TemplateName, Record<EmailLanguage, Template>>;
  layouts: Record<EmailLanguage, string>;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export const TEMPLATE_DIR = new URL('../../emails/', import.meta.url);

const PLACEHOLDER = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

export const placeholdersIn = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!)),
];

/** A BOM and CRLF line ends are what Windows editors add; neither is part of the text. */
function normalise(source: string): string {
  return (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, '\n');
}

function checkPlaceholders(
  text: string,
  allowed: readonly string[],
  required: readonly string[],
  where: string,
  problems: string[],
) {
  const used = placeholdersIn(text);
  for (const key of used)
    if (!allowed.includes(key))
      problems.push(
        `unknown placeholder {{${key}}} in the ${where} (allowed: ${allowed.join(', ')})`,
      );
  for (const key of required)
    if (!used.includes(key)) problems.push(`the ${where} must contain {{${key}}}`);
}

/** `<name>.<lang>.txt`: "Subject: …", an empty line, then the plain-text body. */
export function parseTextTemplate(
  name: TemplateName,
  file: string,
  source: string,
): Pick<Template, 'subject' | 'text'> {
  const lines = normalise(source).split('\n');
  const match = /^Subject:(.*)$/i.exec(lines[0] ?? '');
  const problems: string[] = [];
  const subject = match?.[1]?.trim() ?? '';
  if (!match) problems.push('the first line must be "Subject: …"');
  else if (!subject) problems.push('the subject is empty');
  if (match && lines[1]?.trim()) problems.push('the second line must be empty');
  const text = lines.slice(2).join('\n').trim();
  if (!text) problems.push('the text is empty');
  const allowed = TEMPLATE_PLACEHOLDERS[name];
  checkPlaceholders(subject, allowed, [], 'subject', problems);
  checkPlaceholders(text, allowed, allowed, 'text', problems);
  if (problems.length) throw new Error(`Email template ${file}: ${problems.join('; ')}`);
  return { subject, text };
}

/** `<name>.<lang>.html`: the HTML body (no <html> or <body>: the layout adds them). */
export function parseHtmlTemplate(name: TemplateName, file: string, source: string): string {
  const html = normalise(source).trim();
  const problems: string[] = [];
  if (!html) problems.push('the HTML is empty');
  const allowed = TEMPLATE_PLACEHOLDERS[name];
  checkPlaceholders(html, allowed, allowed, 'HTML', problems);
  if (problems.length) throw new Error(`Email template ${file}: ${problems.join('; ')}`);
  return html;
}

export function parseLayout(file: string, source: string): string {
  const html = normalise(source).trim();
  const problems: string[] = [];
  checkPlaceholders(html, LAYOUT_PLACEHOLDERS, LAYOUT_PLACEHOLDERS, 'layout', problems);
  if (problems.length) throw new Error(`Email template ${file}: ${problems.join('; ')}`);
  return html;
}

/** English and Urdu must take the same values in every part, or one would silently miss one. */
function sameAcrossLanguages(name: TemplateName, byLang: Record<EmailLanguage, Template>) {
  const problems: string[] = [];
  for (const part of ['subject', 'text', 'html'] as const) {
    const sets = EMAIL_LANGUAGES.map((lang) =>
      placeholdersIn(byLang[lang][part]).sort().join(', '),
    );
    if (new Set(sets).size > 1)
      problems.push(
        `Email template ${name}: English and Urdu use different placeholders in the ${part} (${EMAIL_LANGUAGES.map((lang, i) => `${lang}: ${sets[i] || 'none'}`).join('; ')})`,
      );
  }
  return problems;
}

/** Reads and checks every template in every language; throws one error listing every problem. */
export function loadEmailTemplates(dir: URL = TEMPLATE_DIR): EmailTemplates {
  const problems: string[] = [];
  const read = <T>(file: string, parse: (source: string) => T): T | undefined => {
    try {
      return parse(readFileSync(new URL(file, dir), 'utf8'));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      problems.push(
        code === 'ENOENT'
          ? `Email template ${file}: file missing`
          : error instanceof Error
            ? error.message
            : String(error),
      );
      return undefined;
    }
  };

  const layouts = {} as Record<EmailLanguage, string>;
  for (const lang of EMAIL_LANGUAGES) {
    const file = `layout.${lang}.html`;
    const layout = read(file, (s) => parseLayout(file, s));
    if (layout !== undefined) layouts[lang] = layout;
  }
  const templates = {} as Record<TemplateName, Record<EmailLanguage, Template>>;
  for (const name of TEMPLATE_NAMES) {
    const byLang = {} as Record<EmailLanguage, Template>;
    let complete = true;
    for (const lang of EMAIL_LANGUAGES) {
      const textFile = `${name}.${lang}.txt`;
      const htmlFile = `${name}.${lang}.html`;
      const text = read(textFile, (s) => parseTextTemplate(name, textFile, s));
      const html = read(htmlFile, (s) => parseHtmlTemplate(name, htmlFile, s));
      if (text && html !== undefined) byLang[lang] = { ...text, html };
      else complete = false;
    }
    if (complete) problems.push(...sameAcrossLanguages(name, byLang));
    templates[name] = byLang;
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return { templates, layouts };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fills the placeholders in one pass, so a value that itself contains "{{…}}" or "$&" stays as
 * typed. A placeholder without a value is an error, never an email with "{{code}}" in it.
 */
export function fill(
  text: string,
  values: Record<string, string>,
  encode: (value: string) => string = (v) => v,
): string {
  return text.replace(PLACEHOLDER, (_, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`Email: no value for {{${key}}}`);
    return encode(value);
  });
}

/** One email in one language: plain text, and HTML with every value escaped. */
export function renderEmail<N extends TemplateName>(
  set: EmailTemplates,
  name: N,
  language: EmailLanguage,
  values: TemplateValues<N>,
): RenderedEmail {
  const template = set.templates[name][language];
  const subject = fill(template.subject, values);
  const content = fill(template.html, values, escapeHtml);
  return {
    subject,
    text: fill(template.text, values),
    // The layout gets the finished body as is: it is already escaped.
    html: fill(set.layouts[language], { subject: escapeHtml(subject), content }),
  };
}
