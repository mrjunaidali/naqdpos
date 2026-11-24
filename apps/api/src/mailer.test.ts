import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { authOptions } from './auth.ts';
import { loadEnv } from './env.ts';
import { codeEmail, createMailer, inviteEmail, type Transport } from './mailer.ts';

const SMTP = {
  kind: 'smtp' as const,
  host: 'smtp.test',
  port: 587,
  user: 'resend',
  pass: 'smtp-password-xyz',
  from: 'NaqdPOS <no-reply@naqd.pk>',
};

/** Captures log lines so tests can check that codes never reach them. */
function captureLogs() {
  const lines: string[] = [];
  const logger = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
  return { logger, lines };
}

function fakeTransport() {
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  const transport: Transport = {
    sendMail: vi.fn((m: (typeof sent)[number]) => {
      sent.push(m);
      return Promise.resolve({});
    }),
    verify: vi.fn(() => Promise.resolve(true)),
  };
  return { transport, sent };
}

describe('email templates', () => {
  it('sign-in code: English then Urdu, subject in both', () => {
    const mail = codeEmail('sign-in', '482913');
    expect(mail.subject).toBe('NaqdPOS sign-in code / NaqdPOS لاگ ان کوڈ');
    const [en, ur] = mail.text.split('— — —');
    expect(en).toContain('Your NaqdPOS sign-in code is 482913.');
    expect(ur).toContain('482913');
    expect(ur).toMatch(/[؀-ۿ]/);
  });

  it('PIN reset codes say "PIN reset code" (email-verification type, architecture §5)', () => {
    const mail = codeEmail('email-verification', '123456');
    expect(mail.subject).toBe('NaqdPOS PIN reset code / NaqdPOS PIN ری سیٹ کوڈ');
    expect(mail.text).toContain('PIN reset code is 123456');
  });

  it('owner invite uses the WhatsApp words, the app address and the email in both languages', () => {
    const mail = inviteEmail('Ali Fruit', 'https://pos.naqd.pk', 'ali@example.com');
    expect(mail.subject).toContain('Ali Fruit');
    expect(mail.text).toContain(
      'Assalam o alaikum! Your shop Ali Fruit is ready on NaqdPOS. Open https://pos.naqd.pk and sign in with ali@example.com.',
    );
    const ur = mail.text.split('— — —')[1]!;
    expect(ur).toContain('https://pos.naqd.pk');
    expect(ur).toContain('ali@example.com');
  });
});

describe('mailer', () => {
  it('sends from MAIL_FROM and logs who (masked) and what, never the text', async () => {
    const { transport, sent } = fakeTransport();
    const { logger, lines } = captureLogs();
    const mailer = createMailer(SMTP, logger, { transport });
    await mailer.send({ to: 'owner@example.com', ...codeEmail('sign-in', '771100') });
    expect(sent).toEqual([expect.objectContaining({ from: SMTP.from, to: 'owner@example.com' })]);
    expect(lines.join('\n')).toContain('o***@example.com');
    expect(lines.join('\n')).not.toContain('owner@example.com');
    expect(lines.join('\n')).not.toContain('771100');
  });

  it('verify() reports a bad SMTP login instead of throwing', async () => {
    const { transport } = fakeTransport();
    transport.verify = () => Promise.reject(new Error('535 auth failed'));
    const { logger, lines } = captureLogs();
    expect(await createMailer(SMTP, logger, { transport }).verify()).toBe(false);
    expect(lines.join('\n')).toContain('email check failed');
    expect(lines.join('\n')).not.toContain(SMTP.pass);
  });

  it('Better Auth sends codes through the mailer; production never logs them', async () => {
    const { transport, sent } = fakeTransport();
    const { logger, lines } = captureLogs();
    const env = loadEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://a:b@localhost:5432/x',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:8787',
      APP_ORIGINS: 'http://localhost:5173',
    });
    const options = authOptions(env, {
      pool: {} as never,
      logger,
      mailer: createMailer(SMTP, logger, { transport }),
    });
    const plugin = options.plugins[0] as unknown as {
      options: {
        sendVerificationOTP: (a: { email: string; otp: string; type: string }) => Promise<void>;
      };
    };
    await plugin.options.sendVerificationOTP({
      email: 'o@example.com',
      otp: '654321',
      type: 'sign-in',
    });
    expect(sent[0]!.text).toContain('654321');
    expect(lines.join('\n')).not.toContain('654321');
  });

  it('without email settings: development prints the code, anything else refuses to send', async () => {
    const base = {
      DATABASE_URL: 'postgres://a:b@localhost:5432/x',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:8787',
      APP_ORIGINS: 'http://localhost:5173',
    };
    const send = (nodeEnv: 'development' | 'test') => {
      const { logger, lines } = captureLogs();
      const options = authOptions(loadEnv({ ...base, NODE_ENV: nodeEnv }), {
        pool: {} as never,
        logger,
        mailer: null,
      });
      const plugin = options.plugins[0] as unknown as {
        options: {
          sendVerificationOTP: (a: { email: string; otp: string; type: string }) => Promise<void>;
        };
      };
      return {
        lines,
        run: plugin.options.sendVerificationOTP({
          email: 'o@x.pk',
          otp: '111222',
          type: 'sign-in',
        }),
      };
    };
    const dev = send('development');
    await dev.run;
    expect(dev.lines.join('\n')).toContain('111222');
    const other = send('test');
    await expect(other.run).rejects.toThrow(/email is not configured/);
    expect(other.lines.join('\n')).not.toContain('111222');
  });
});
