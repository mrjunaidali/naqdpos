// Email (deployment §2): Resend's HTTPS API, or any SMTP server. Plain text, one email in English
// then Urdu: sign-in happens before the server knows the reader's language. Codes are never
// logged, and recipients only masked (o***@example.com).
//
// Two transports because some hosts (Railway Hobby) block outbound SMTP ports and allow only
// HTTPS. Both sit behind the same Mailer, so callers don't know which one is in use.
import { inviteMessage } from '@naqdpos/core';
import nodemailer from 'nodemailer';
import type { Logger } from './logger.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** What the API needs from email; tests pass a fake. */
export interface Mailer {
  /** Rejects within the send timeout (10 s) when the provider is slow or unreachable. */
  send(mail: Mail): Promise<void>;
  /** Startup check of the login; resolves false instead of throwing. */
  verify(): Promise<boolean>;
}

export interface SmtpSettings {
  kind: 'smtp';
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface ResendSettings {
  kind: 'resend';
  apiKey: string;
  from: string;
}

export type MailSettings = SmtpSettings | ResendSettings;

export type OutgoingMail = Mail & { from: string };

/** nodemailer's SMTP transport, the Resend transport, or any object with the same shape (tests). */
export interface Transport {
  sendMail(message: OutgoingMail): Promise<unknown>;
  /** Absent: the transport has no cheap login check. */
  verify?(): Promise<unknown>;
}

/** Every send gives up after this long, so the sign-in screen answers instead of spinning. */
export const SEND_TIMEOUT_MS = 10_000;

export const RESEND_API_URL = 'https://api.resend.com/emails';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** "owner@example.com" → "o***@example.com": enough to tell recipients apart in logs. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Resend's HTTPS API (POST /emails) with plain fetch, no SDK. Errors carry the HTTP status and
 * Resend's error name only: Resend's message can quote the recipient.
 */
export function resendTransport(
  apiKey: string,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Transport {
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  return {
    async sendMail(message) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchFn(RESEND_API_URL, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              from: message.from,
              to: message.to,
              subject: message.subject,
              text: message.text,
              ...(message.html !== undefined && { html: message.html }),
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted)
            throw new Error(`Resend API: no answer within ${timeoutMs / 1000} s`, { cause: error });
          throw new Error('Resend API: request failed', { cause: error });
        }
        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            { name?: unknown } | undefined;
          const name = typeof body?.name === 'string' ? ` (${body.name})` : '';
          throw new Error(`Resend API: HTTP ${response.status}${name}`);
        }
        return await response.json().catch(() => ({}));
      } finally {
        clearTimeout(timer);
      }
    },
    // No verify: Resend's sending-only keys can't call any read endpoint, so there is no cheap
    // check. A bad key shows on the first send (logged as HTTP 401/403).
  };
}

/** nodemailer over SMTP, with every wait bounded so a blocked port fails fast. */
export function smtpTransport(settings: SmtpSettings, timeoutMs = SEND_TIMEOUT_MS): Transport {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is TLS from the start; 587 / 2587 upgrade with STARTTLS (required, never plain).
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
}

/** Rejects after `ms` unless the promise settles first: the backstop for any transport. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`email: no answer within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export interface MailerOptions {
  /** Tests: a fake instead of the real SMTP / Resend transport. */
  transport?: Transport;
  /** Tests: a fake fetch for the Resend transport. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createMailer(
  settings: MailSettings,
  logger: Logger,
  options: MailerOptions = {},
): Mailer {
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  const transport =
    options.transport ??
    (settings.kind === 'resend'
      ? resendTransport(settings.apiKey, {
          ...(options.fetch && { fetch: options.fetch }),
          timeoutMs,
        })
      : smtpTransport(settings, timeoutMs));
  const via = settings.kind === 'resend' ? 'resend-https' : `smtp ${settings.host}`;
  return {
    async send(mail) {
      await withTimeout(transport.sendMail({ from: settings.from, ...mail }), timeoutMs);
      // Only who (masked) and what kind: the text holds codes.
      logger.info({ to: maskEmail(mail.to), subject: mail.subject, via }, 'email sent');
    },
    async verify() {
      if (!transport.verify) {
        logger.info({ via }, 'email: no startup check for this transport, the first send shows');
        return true;
      }
      try {
        await withTimeout(transport.verify(), timeoutMs);
        return true;
      } catch (error) {
        logger.error({ err: error, via }, 'email check failed: emails will not send');
        return false;
      }
    },
  };
}

const SEP = '\n\n— — —\n\n';
const bilingual = (en: string, ur: string) => `${en}${SEP}${ur}`;

/**
 * Sign-in and PIN reset codes. This app uses Better Auth's 'email-verification' OTP type only
 * for owner PIN resets (architecture §5), so those mails say "PIN reset code".
 */
export function codeEmail(type: string, otp: string): { subject: string; text: string } {
  if (type === 'email-verification') {
    return {
      subject: 'NaqdPOS PIN reset code / NaqdPOS PIN ری سیٹ کوڈ',
      text: bilingual(
        `Your NaqdPOS PIN reset code is ${otp}. It is valid for 5 minutes. If you did not ask to reset your PIN, ignore this email.`,
        `آپ کا NaqdPOS PIN ری سیٹ کوڈ ${otp} ہے۔ یہ 5 منٹ کے لیے درست ہے۔ اگر آپ نے PIN بدلنے کا نہیں کہا تو اس ای میل کو نظر انداز کریں۔`,
      ),
    };
  }
  return {
    subject: 'NaqdPOS sign-in code / NaqdPOS لاگ ان کوڈ',
    text: bilingual(
      `Your NaqdPOS sign-in code is ${otp}. It is valid for 5 minutes. If you did not ask for it, ignore this email.`,
      `آپ کا NaqdPOS لاگ ان کوڈ ${otp} ہے۔ یہ 5 منٹ کے لیے درست ہے۔ اگر آپ نے یہ کوڈ نہیں مانگا تو اس ای میل کو نظر انداز کریں۔`,
    ),
  };
}

/** Owner invite (US012): the same words as the WhatsApp text the admin portal shows. */
export function inviteEmail(shopName: string, posUrl: string, email: string) {
  return {
    subject: `Your shop ${shopName} is ready on NaqdPOS / آپ کی دکان ${shopName} NaqdPOS پر تیار ہے`,
    text: bilingual(
      inviteMessage(shopName, posUrl, email),
      `السلام علیکم! آپ کی دکان ${shopName} NaqdPOS پر تیار ہے۔ ${posUrl} کھولیں اور ${email} سے سائن ان کریں۔`,
    ),
  };
}
