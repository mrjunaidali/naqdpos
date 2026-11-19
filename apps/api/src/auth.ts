// Better Auth (architecture §5): Google sign-in, email OTP (typed 6-digit code), TOTP two-factor,
// and bearer session tokens for the installed PWA. Users and sessions are rows in our Postgres.
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { bearer, emailOTP, twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import type { Env } from './env.ts';
import type { Logger } from './logger.ts';

export type SendOtp = (email: string, otp: string, type: string) => Promise<void>;

/** What the routes need from auth; lets unit tests use a stub instead of a database. */
export interface AuthService {
  handler(request: Request): Promise<Response>;
  /** The signed-in user's id from the session token, or null. */
  getUserId(headers: Headers): Promise<string | null>;
}

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

export function authOptions(
  env: Env,
  deps: { pool: pg.Pool; logger: Logger; sendOtp?: SendOtp },
): BetterAuthOptions {
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

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  return {
    appName: 'NaqdPOS',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.APP_ORIGINS,
    database: deps.pool,
    ...authSchemaOptions,
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
    ],
  };
}

export function createAuth(
  env: Env,
  deps: { pool: pg.Pool; logger: Logger; sendOtp?: SendOtp },
): AuthService {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    deps.logger.warn('Google sign-in is off: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
  }
  const auth = betterAuth(authOptions(env, deps));
  return {
    handler: (request) => auth.handler(request),
    async getUserId(headers) {
      const session = await auth.api.getSession({ headers });
      return session?.user.id ?? null;
    },
  };
}
