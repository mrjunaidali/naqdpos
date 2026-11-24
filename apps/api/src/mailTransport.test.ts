// The Resend HTTPS transport, transport choice and send timeouts (deployment §2: Railway Hobby
// blocks SMTP ports, so email goes over HTTPS there).
import { EMAIL_SEND_FAILED } from '@naqdpos/core';
import { isAPIError } from 'better-auth/api';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authOptions } from './auth.ts';
import { loadEnv } from './env.ts';
import {
  codeEmail,
  createMailer,
  type FetchLike,
  maskEmail,
  RESEND_API_URL,
  resendTransport,
  SEND_TIMEOUT_MS,
  type Transport,
} from './mailer.ts';

const FROM = 'NaqdPOS <no-reply@naqd.pk>';
const RESEND = { kind: 'resend' as const, apiKey: 're_test_key_abc', from: FROM };
const SMTP = {
  kind: 'smtp' as const,
  host: 'smtp.test',
  port: 587,
  user: 'resend',
  pass: 'smtp-password-xyz',
  from: FROM,
};
const mail = { from: FROM, to: 'owner@example.com', subject: 'Hi', text: 'Code 123456' };

function captureLogs() {
  const lines: string[] = [];
  const logger = pino({ level: 'debug' }, { write: (line: string) => void lines.push(line) });
  return { logger, lines };
}

/** A fetch that answers like Resend, recording each call. */
function fakeFetch(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  };
  return { fetch, calls };
}

/** A fetch that never answers until aborted, like a blocked port. */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('Resend HTTPS transport', () => {
  it('POSTs the JSON Resend expects with the API key as a bearer token', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'email-1' }));
    await resendTransport(RESEND.apiKey, { fetch }).sendMail(mail);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer re_test_key_abc',
      'content-type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: FROM,
      to: 'owner@example.com',
      subject: 'Hi',
      text: 'Code 123456',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends html too when given', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'email-2' }));
    await resendTransport(RESEND.apiKey, { fetch }).sendMail({ ...mail, html: '<p>x</p>' });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ html: '<p>x</p>' });
  });

  it('an error answer rejects with the status and error name, not the message or key', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json(
        {
          name: 'validation_error',
          message: 'You can only send testing emails to your own address (owner@example.com)',
        },
        { status: 403 },
      ),
    );
    const error = await resendTransport(RESEND.apiKey, { fetch })
      .sendMail(mail)
      .catch((e: unknown) => e);
    expect(String(error)).toContain('HTTP 403 (validation_error)');
    expect(String(error)).not.toContain('owner@example.com');
    expect(String(error)).not.toContain(RESEND.apiKey);
  });

  it('a network failure rejects instead of hanging', async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    await expect(resendTransport(RESEND.apiKey, { fetch }).sendMail(mail)).rejects.toThrow(
      'Resend API: request failed',
    );
  });

  it('gives up after 10 s and aborts the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch: FetchLike = (url, init) => {
      signal = init.signal ?? undefined;
      return hangingFetch(url, init);
    };
    const outcome = expect(
      resendTransport(RESEND.apiKey, { fetch }).sendMail(mail),
    ).rejects.toThrow('no answer within 10 s');
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(signal?.aborted).toBe(true);
  });
});

describe('transport choice and timeouts', () => {
  it('Resend settings send through the HTTPS API; verify() is skipped with a log line', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'e' }));
    const { logger, lines } = captureLogs();
    const mailer = createMailer(RESEND, logger, { fetch });
    expect(await mailer.verify()).toBe(true);
    expect(calls).toHaveLength(0);
    expect(lines.join('\n')).toContain('no startup check');
    await mailer.send({ to: 'owner@example.com', ...codeEmail('sign-in', '909090') });
    expect(calls[0]!.url).toBe(RESEND_API_URL);
    expect(lines.join('\n')).not.toContain('909090');
    expect(lines.join('\n')).not.toContain(RESEND.apiKey);
  });

  it('any transport that hangs is cut off at the send timeout', async () => {
    vi.useFakeTimers();
    const transport: Transport = { sendMail: () => new Promise(() => {}) };
    const mailer = createMailer(SMTP, captureLogs().logger, { transport });
    const outcome = expect(mailer.send(mail)).rejects.toThrow('no answer within 10 s');
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    await outcome;
  });

  it('masks addresses for logs', () => {
    expect(maskEmail('owner@example.com')).toBe('o***@example.com');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('sign-in code send failure', () => {
  it('answers EMAIL_SEND_FAILED (503) and logs neither the code nor the full address', async () => {
    const { logger, lines } = captureLogs();
    const transport: Transport = {
      sendMail: () => Promise.reject(new Error('connect ETIMEDOUT')),
    };
    const options = authOptions(
      loadEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://a:b@localhost:5432/x',
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        BETTER_AUTH_URL: 'http://localhost:8787',
        APP_ORIGINS: 'http://localhost:5173',
      }),
      { pool: {} as never, logger, mailer: createMailer(SMTP, logger, { transport }) },
    );
    const plugin = options.plugins[0] as unknown as {
      options: {
        sendVerificationOTP: (a: { email: string; otp: string; type: string }) => Promise<void>;
      };
    };
    const error = await plugin.options
      .sendVerificationOTP({ email: 'owner@example.com', otp: '343434', type: 'sign-in' })
      .catch((e: unknown) => e);
    expect(isAPIError(error)).toBe(true);
    const apiError = error as { statusCode: number; body?: { code?: string; message?: string } };
    expect(apiError.statusCode).toBe(503);
    expect(apiError.body).toMatchObject({
      code: EMAIL_SEND_FAILED,
      message: "Couldn't send the code, try again",
    });
    const log = lines.join('\n');
    expect(log).toContain('email code not sent');
    expect(log).toContain('o***@example.com');
    expect(log).not.toContain('owner@example.com');
    expect(log).not.toContain('343434');
  });
});
