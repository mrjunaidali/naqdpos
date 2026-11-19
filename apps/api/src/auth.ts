// Better Auth (architecture §5): Google sign-in, email OTP (typed 6-digit code), TOTP two-factor,
// bearer session tokens for the installed PWA, and single-use tokens to hand a Google sign-in
// back to the app. Users and sessions are rows in our Postgres.
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { bearer, emailOTP, oneTimeToken, twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';

export type SendOtp = (email: string, otp: string, type: string) => Promise<void>;

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
  /** Mints a single-use, short-lived token for a session (server side only). */
  createOneTimeToken(sessionToken: string): Promise<string>;
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
    ((email, otp, type) => {
      if (env.NODE_ENV === 'development') {
        // Development only: there is no SMTP yet (architecture §8), so the code goes to the console.
        deps.logger.info({ email, otp, type }, 'email OTP (development only)');
        return Promise.resolve();
      }
      return Promise.reject(new Error('Email OTP: SMTP is not configured yet'));
    });
  const google = googleKeys(env);

  return {
    appName: 'NaqdPOS',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.APP_ORIGINS,
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
        sendVerificationOTP: ({ email, otp, type }) => sendOtp(email, otp, type),
      }),
      twoFactor({ issuer: 'NaqdPOS', schema: twoFactorSchema }),
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
    handler: (request) => auth.handler(request),
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
    createOneTimeToken,
  };
}
