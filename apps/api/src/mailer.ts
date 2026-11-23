// Email over SMTP (deployment §2; provider: Resend's SMTP). Plain text, one email in English then
// Urdu: sign-in happens before the server knows the reader's language. Codes are never logged.
import { inviteMessage } from '@naqdpos/core';
import nodemailer from 'nodemailer';
import type { Logger } from './logger.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** What the API needs from email; tests pass a fake. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Checks the SMTP login (startup); resolves false instead of throwing. */
  verify(): Promise<boolean>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** nodemailer's SMTP transport, or any object with the same sendMail / verify (tests). */
export interface Transport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  verify(): Promise<unknown>;
}

export function createMailer(
  settings: SmtpSettings,
  logger: Logger,
  transport: Transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is TLS from the start; 587 / 2587 upgrade with STARTTLS (required, never plain).
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.pass },
  }),
): Mailer {
  return {
    async send(mail) {
      await transport.sendMail({ from: settings.from, ...mail });
      // Only who and what kind: the text holds codes.
      logger.info({ to: mail.to, subject: mail.subject }, 'email sent');
    },
    async verify() {
      try {
        await transport.verify();
        return true;
      } catch (error) {
        logger.error(
          { err: error, host: settings.host },
          'SMTP check failed: emails will not send',
        );
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
