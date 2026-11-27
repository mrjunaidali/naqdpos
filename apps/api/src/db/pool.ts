// Postgres pools for the API (app role and auth). Staging, 27 Nov 2026: a request failed with
// "read ECONNRESET" from pg-pool (Better Auth findSession) after the network dropped a pooled
// connection. Three defences:
// 1. keep-alive and a short idle timeout, so dead connections are found and closed early;
// 2. an 'error' handler on the pool: without one, a connection dropped while idle in the pool
//    is an unhandled 'error' event and crashes the API;
// 3. one retry of a READ on a fresh connection when the connection itself failed (never a
//    write: a write may have been applied before the connection dropped).
import pg from 'pg';
import type { Logger } from '../logger.ts';

/** Below any idle cut-off of the host's network or proxy; pg-pool's default too, set on purpose. */
export const IDLE_TIMEOUT_MS = 10_000;
/** A database that doesn't answer fails the request quickly instead of hanging it. */
export const CONNECT_TIMEOUT_MS = 5_000;
/** First TCP keep-alive probe after this much silence (finds half-open connections). */
export const KEEP_ALIVE_DELAY_MS = 10_000;

const CONNECTION_MESSAGES = [
  'connection terminated',
  'client has encountered a connection error',
  'connection ended',
];
const CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT']);

/**
 * True when the database connection failed (not the query): ECONNRESET, EPIPE, "Connection
 * terminated (unexpectedly)", the server shutting down (57P01-57P03) or SQLSTATE class 08.
 */
export function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string') {
    if (CONNECTION_CODES.has(code)) return true;
    if (code === '57P01' || code === '57P02' || code === '57P03' || code.startsWith('08'))
      return true;
  }
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  return CONNECTION_MESSAGES.some((m) => text.includes(m));
}

export interface PoolSettings {
  max: number;
  /** libpq-style startup options, e.g. '-c app.context=auth'. */
  options?: string;
  /** Names the pool in log lines ('app' or 'auth'). */
  name: string;
}

/** A pg pool with keep-alive, timeouts and an error handler that logs instead of crashing. */
export function createPool(connectionString: string, settings: PoolSettings, logger?: Logger) {
  const pool = new pg.Pool({
    connectionString,
    max: settings.max,
    ...(settings.options && { options: settings.options }),
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEP_ALIVE_DELAY_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  pool.on('error', (error) => {
    // An idle connection was closed by the server or the network. pg-pool has already removed
    // it; the next request gets a new one.
    logger?.warn({ err: error, pool: settings.name }, 'idle database connection dropped');
  });
  return pool;
}

type QueryResult = pg.QueryResult;

interface ClientEvents {
  onRetry: (error: unknown) => void;
  onDropWhileHeld: (error: unknown) => void;
}

/** A plain SELECT (not a data-modifying CTE, not a locking read): safe to run twice. */
const isPlainSelect = (text: string) =>
  /^\s*select\b/i.test(text) &&
  !/\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/i.test(text);
const startsTransaction = (text: string) => /^\s*(begin|start\s+transaction)\b/i.test(text);
const endsTransaction = (text: string) => /^\s*(commit|rollback|end|abort)\b/i.test(text);

/**
 * A pooled client that runs a SELECT outside a transaction once more on a fresh connection when
 * the connection failed. Inside a transaction nothing is retried (the transaction is gone with
 * the connection); `withUserTx({ readOnly: true })` retries a whole read transaction instead.
 */
class ReadRetryClient {
  #client: pg.PoolClient;
  #inTransaction = false;
  readonly #pool: pg.Pool;
  readonly #events: ClientEvents;

  constructor(client: pg.PoolClient, pool: pg.Pool, events: ClientEvents) {
    this.#pool = pool;
    this.#events = events;
    this.#client = this.#hold(client);
  }

  /**
   * pg-pool listens for 'error' only while a client is idle in the pool. A connection that drops
   * while a request holds it between two queries would be an unhandled 'error' event and crash
   * the API; it is logged instead (the next query on it fails and the request answers 500).
   */
  #hold(client: pg.PoolClient): pg.PoolClient {
    client.on('error', this.#events.onDropWhileHeld);
    return client;
  }

  #let(client: pg.PoolClient, destroy?: boolean | Error): void {
    client.off('error', this.#events.onDropWhileHeld);
    client.release(destroy);
  }

  /** Kysely reads it to cancel queries. */
  get processID(): number | undefined {
    return (this.#client as unknown as { processID?: number }).processID;
  }

  query(text: unknown, values?: unknown): Promise<QueryResult> {
    // Cursors (streaming) and query configs go straight through.
    if (typeof text !== 'string') {
      return (this.#client.query as (t: unknown, v?: unknown) => Promise<QueryResult>)(
        text,
        values,
      );
    }
    return this.#run(text, values as unknown[] | undefined);
  }

  async #run(text: string, values: unknown[] | undefined): Promise<QueryResult> {
    if (startsTransaction(text)) this.#inTransaction = true;
    else if (endsTransaction(text)) this.#inTransaction = false;
    const retryable = !this.#inTransaction && isPlainSelect(text);
    try {
      return await this.#client.query(text, values);
    } catch (error) {
      if (!retryable || !isConnectionError(error)) throw error;
      this.#events.onRetry(error);
      // The broken connection is destroyed, not returned to the pool.
      this.#let(this.#client, error as Error);
      this.#client = this.#hold(await this.#pool.connect());
      return this.#client.query(text, values);
    }
  }

  release(destroy?: boolean | Error): void {
    this.#let(this.#client, destroy);
  }
}

/**
 * The pool as Kysely sees it (connect / end / options / Client), with read retries on every
 * client. Kysely (and Better Auth through it) only uses this subset of pg.Pool.
 */
export function readRetryPool(pool: pg.Pool, name: string, logger?: Logger) {
  const events: ClientEvents = {
    onRetry: (error) =>
      logger?.warn(
        { err: error, pool: name },
        'database connection dropped during a read: retrying once on a new connection',
      ),
    onDropWhileHeld: (error) =>
      logger?.warn({ err: error, pool: name }, 'database connection dropped while in use'),
  };
  return {
    Client: pg.Client,
    get options() {
      return pool.options;
    },
    async connect() {
      return new ReadRetryClient(await pool.connect(), pool, events) as unknown as pg.PoolClient;
    },
    end: () => pool.end(),
  };
}
