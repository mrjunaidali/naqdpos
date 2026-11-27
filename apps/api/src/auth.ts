// Better Auth (architecture §5): Google sign-in, email OTP (typed 6-digit code), TOTP two-factor,
// bearer session tokens for the installed PWA, and single-use tokens to hand a Google sign-in
// back to the app. Users and sessions are rows in our Postgres.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  APP_LANGUAGE_HEADER,
  EMAIL_SEND_FAILED,
  emailLanguage,
  type EmailLanguage,
} from '@naqdpos/core';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, isAPIError } from 'better-auth/api';
import { bearer, emailOTP, oneTimeToken, twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';
import { CODE_MINUTES, codeEmail, maskEmail, type Mailer } from './mailer.ts';

const SEND_FAILED_MESSAGE = "Couldn't send the code, try again";

/**
 * Per request (never shared between requests, so the API stays stateless): set when a code
 * email failed, because Better Auth swallows errors from sendVerificationOTP.
 */
const sendFailures = new AsyncLocalStorage<{ failed: boolean }>();

const sendFailedError = () =>
  new APIError('SERVICE_UNAVAILABLE', { code: EMAIL_SEND_FAILED, message: SEND_FAILED_MESSAGE });

/** Runs `fn` with a fresh send-failure mark; reports whether a code email failed. */
async function trackSend<T>(fn: () => Promise<T>): Promise<{ value: T; sendFailed: boolean }> {
  const mark = { failed: false };
  const value = await sendFailures.run(mark, fn);
  return { value, sendFailed: mark.failed };
}

/** `language`: the email's language, from the app's X-App-Language header (default English). */
export type SendOtp = (
  email: string,
  otp: string,
  type: string,
  language: EmailLanguage,
) => Promise<void>;

/** The app's language on the request behind a code: HTTP requests and server-side calls alike. */
function requestLanguage(ctx: unknown): EmailLanguage {
  const c = ctx as { headers?: Headers; request?: Request } | undefined;
  const header =
    c?.headers?.get?.(APP_LANGUAGE_HEADER) ?? c?.request?.headers.get(APP_LANGUAGE_HEADER);
  return emailLanguage(header);
}

export type PinResetCodeCheck = 'ok' | 'invalid' | 'expired' | 'too_many';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** What the routes need from auth; lets unit tests use a stub instead of a database. */
export interface AuthService {
  /** Google sign-in is offered only when both Google keys are set. */
  googleEnabled: boolean;
  handler(request: Request): Promise<Response>;
  /** Google's return to the API: Better Auth, then the single-use token for the app. */
  handleOAuthCallback(request: Request): Promise<Response>;
  /** The signed-in user from the session token, or null. */
  getUser(headers: Headers): Promise<AuthUser | null>;
  /** The session behind the token (admin checks: which session, when it started). */
  getSessionInfo(headers: Headers): Promise<{ user: AuthUser; sessionId: string } | null>;
  /** Starts TOTP enrolment for the signed-in user (passwordless): link, secret, backup codes. */
  enrollTwoFactor(headers: Headers): Promise<{ totpURI: string; backupCodes: string[] }>;
  /**
   * Checks a TOTP code for the current session. The first good code turns 2FA on, and Better
   * Auth then replaces the session: `newToken` is the replacement.
   */
  verifyTotp(headers: Headers, code: string): Promise<{ ok: boolean; newToken?: string }>;
  /** Checks (and uses up) a backup code for the current session. */
  verifyBackupCode(headers: Headers, code: string): Promise<boolean>;
  /** Mints a single-use, short-lived token for a session (server side only). */
  createOneTimeToken(sessionToken: string): Promise<string>;
  /** Emails a fresh PIN reset code (email-verification OTP) to this address, in this language. */
  sendPinResetCode(email: string, language: EmailLanguage): Promise<void>;
  /**
   * Checks and USES UP a PIN reset code (single use, 3 wrong tries, 5 minutes): verifyEmailOTP
   * consumes it and creates no session.
   */
  verifyPinResetCode(email: string, code: string): Promise<PinResetCodeCheck>;
}

const DAY = 60 * 60 * 24;
/** Long-lived so owners rarely sign in again (§5); extended once a day while in use. */
const SESSION_EXPIRES_IN = 90 * DAY;
const SESSION_UPDATE_AGE = DAY;
/** The Google redirect token only has to survive one page load. */
const ONE_TIME_TOKEN_MINUTES = 1;

const ts = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

/** Table and column names (snake_case, plural) of migration 20261119120000_foundation. */
export const authSchemaOptions = {
  user: {
    modelName: 'users',
    fields: { emailVerified: 'email_verified', ...ts },
  },
  session: {
    modelName: 'sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      ...ts,
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      ...ts,
    },
  },
  verification: {
    modelName: 'verifications',
    fields: { expiresAt: 'expires_at', ...ts },
  },
} satisfies Partial<BetterAuthOptions>;

const twoFactorSchema = {
  user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
  twoFactor: {
    modelName: 'two_factors',
    fields: {
      userId: 'user_id',
      backupCodes: 'backup_codes',
      failedVerificationCount: 'failed_verification_count',
      lockedUntil: 'locked_until',
    },
  },
};

/**
 * Better Auth's own pool. Every connection starts with app.context = 'auth', which the RLS
 * policies on the auth tables require. The request pool never sets it, so tenant queries
 * cannot read sessions or tokens even though both pools use the same naqdpos_app role.
 */
export function createAuthPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5, options: '-c app.context=auth' });
}

export interface AuthDeps {
  pool: pg.Pool;
  logger: Logger;
  /** Mailer (Resend HTTPS or SMTP); null when email is not configured (development only). */
  mailer?: Mailer | null;
  /** Tests: capture codes instead of emailing them. */
  sendOtp?: SendOtp;
  /** Tests only: a shorter one-time-token lifetime. */
  oneTimeTokenMinutes?: number;
}

function googleKeys(env: Env) {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : undefined;
}

export function authOptions(env: Env, deps: AuthDeps) {
  const sendOtp: SendOtp =
    deps.sendOtp ??
    (async (email, otp, type, language) => {
      const mail = codeEmail(type, otp, language);
      if (deps.mailer) {
        try {
          await deps.mailer.send({ to: email, ...mail });
          return;
        } catch (error) {
          // The mailer gives up within its timeout, so the screen gets an answer quickly.
          // The error never holds the code; the recipient is masked.
          deps.logger.warn({ err: error, to: maskEmail(email), type }, 'email code not sent');
          // Better Auth catches errors from this hook and still answers 200, so the request
          // is marked here and createAuth turns it into the error the apps show.
          const request = sendFailures.getStore();
          if (request) request.failed = true;
          throw sendFailedError();
        }
      }
      if (env.NODE_ENV === 'development') {
        // Development without email only: the code goes to the console. Production refuses to
        // start without email settings (env.ts), so codes are never logged there.
        // In the message, not a field: otp fields are redacted (logger.ts).
        deps.logger.info({ email, type }, `email code (development only): ${otp}`);
        return;
      }
      throw new Error('Email OTP: email is not configured');
    });
  const google = googleKeys(env);

  return {
    appName: 'NaqdPOS',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.APP_ORIGINS,
    // In memory: correct for ONE API instance only. More copies need storage: 'database'
    // (deployment §5). Code sending has Better Auth's stricter built-in rule on top.
    rateLimit: { enabled: env.NODE_ENV !== 'test', storage: 'memory', window: 60, max: 100 },
    database: deps.pool,
    ...authSchemaOptions,
    session: {
      ...authSchemaOptions.session,
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: SESSION_UPDATE_AGE,
    },
    // Google and email OTP with the same verified email resolve to one user (§5).
    account: {
      ...authSchemaOptions.account,
      accountLinking: { enabled: true, trustedProviders: ['google', 'email-otp'] },
    },
    advanced: { database: { generateId: 'uuid' } },
    ...(google && { socialProviders: { google } }),
    plugins: [
      emailOTP({
        otpLength: 6,
        // Set here, not left to the library default, because the emails state it (mailer.ts).
        expiresIn: CODE_MINUTES * 60,
        sendVerificationOTP: ({ email, otp, type }, ctx) =>
          sendOtp(email, otp, type, requestLanguage(ctx)),
      }),
      // Admins sign in with Google or an email code (no password): enrolment is passwordless.
      // The plugin's own sign-in step only covers password sign-in, so /admin/* also checks
      // admin_session_2fa (architecture §5).
      twoFactor({ issuer: 'NaqdPOS', schema: twoFactorSchema, allowPasswordless: true }),
      bearer(),
      oneTimeToken({
        expiresIn: deps.oneTimeTokenMinutes ?? ONE_TIME_TOKEN_MINUTES,
        // Stored as a hash, so a database read does not reveal usable tokens.
        storeToken: 'hashed',
        // Only the server mints tokens (in the Google callback); clients can only redeem them.
        disableClientRequest: true,
        // The app uses the bearer token from the response body, not a cookie.
        disableSetSessionCookie: true,
      }),
    ],
  } satisfies BetterAuthOptions;
}

/**
 * After Google, Better Auth redirects to the app's callback URL with the session in a cookie
 * on the API's domain, which the installed PWA cannot use. When the redirect goes to one of
 * our app origins and carries a new session, add a single-use token as `#ott=…`: the fragment
 * is never sent to the static host, and the app trades it for the bearer token and then
 * removes it from the address bar. The bearer token itself never appears in a URL.
 */
export async function addOneTimeTokenToRedirect(
  response: Response,
  appOrigins: readonly string[],
  mint: (sessionToken: string) => Promise<string>,
): Promise<Response> {
  const location = response.headers.get('location');
  const sessionToken = response.headers.get('set-auth-token');
  if (response.status < 300 || response.status >= 400 || !location || !sessionToken) {
    return response;
  }
  let target: URL;
  try {
    target = new URL(location);
  } catch {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('set-auth-token');
  if (appOrigins.includes(target.origin)) {
    target.hash = `ott=${encodeURIComponent(await mint(sessionToken))}`;
    headers.set('location', target.toString());
  }
  return new Response(null, { status: response.status, headers });
}

export function createAuth(env: Env, deps: AuthDeps): AuthService {
  const google = googleKeys(env);
  if (!google) {
    deps.logger.warn('Google sign-in is off: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
  }
  const auth = betterAuth(authOptions(env, deps));

  async function createOneTimeToken(sessionToken: string): Promise<string> {
    const { token } = await auth.api.generateOneTimeToken({
      headers: new Headers({ authorization: `Bearer ${sessionToken}` }),
    });
    return token;
  }

  return {
    googleEnabled: google !== undefined,
    async handler(request) {
      const { value: response, sendFailed } = await trackSend(() => auth.handler(request));
      if (!sendFailed) return response;
      // Same body shape as Better Auth's own errors ({ code, message }).
      return Response.json(
        { code: EMAIL_SEND_FAILED, message: SEND_FAILED_MESSAGE },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    },
    async handleOAuthCallback(request) {
      return addOneTimeTokenToRedirect(
        await auth.handler(request),
        env.APP_ORIGINS,
        createOneTimeToken,
      );
    },
    async getUser(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const { id, email, name } = session.user;
      return { id, email, name };
    },
    async getSessionInfo(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      const { id, email, name } = session.user;
      return { user: { id, email, name }, sessionId: session.session.id };
    },
    async enrollTwoFactor(headers) {
      const result = await auth.api.enableTwoFactor({ headers, body: {} });
      if (!('totpURI' in result)) throw new Error('TOTP enrolment did not return a secret');
      return { totpURI: result.totpURI, backupCodes: result.backupCodes };
    },
    async verifyTotp(headers, code) {
      try {
        const result = await auth.api.verifyTOTP({ headers, body: { code }, returnHeaders: true });
        const newToken = result.headers.get('set-auth-token');
        return newToken ? { ok: true, newToken } : { ok: true };
      } catch (error) {
        if (isAPIError(error)) return { ok: false };
        throw error;
      }
    },
    async verifyBackupCode(headers, code) {
      try {
        await auth.api.verifyBackupCode({ headers, body: { code } });
        return true;
      } catch (error) {
        if (isAPIError(error)) return false;
        throw error;
      }
    },
    createOneTimeToken,
    async sendPinResetCode(email, language) {
      const { sendFailed } = await trackSend(() =>
        auth.api.sendVerificationOTP({
          body: { email, type: 'email-verification' },
          headers: new Headers({ [APP_LANGUAGE_HEADER]: language }),
        }),
      );
      if (sendFailed) throw sendFailedError();
    },
    async verifyPinResetCode(email, code) {
      try {
        await auth.api.verifyEmailOTP({ body: { email, otp: code } });
        return 'ok';
      } catch (error) {
        if (!isAPIError(error)) throw error;
        const reason = (error.body as { code?: string } | undefined)?.code;
        if (reason === 'OTP_EXPIRED') return 'expired';
        if (reason === 'TOO_MANY_ATTEMPTS') return 'too_many';
        if (reason === 'INVALID_OTP') return 'invalid';
        throw error;
      }
    },
  };
}
