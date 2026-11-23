import "server-only";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { waitUntil } from "@vercel/functions";
import postgres from "postgres";
import { getEnvironment } from "@/configuration/environment";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either the shared connection or an open transaction. */
export type Executor = Database | Transaction;

type Connection = { sql: postgres.Sql; database: Database };

// Kept on globalThis so dev hot reloads reuse one connection pool instead of opening new ones.
const globalStore = globalThis as typeof globalThis & { rentalDatabaseConnection?: Connection };

/** A transaction statement running longer than this is cancelled, so a stuck lock fails fast instead of hanging. */
const TRANSACTION_STATEMENT_TIMEOUT = "15s";

/**
 * Seconds an unused connection stays open. On Vercel it is kept short, and every query keeps the function running
 * until that time has passed (see keepRunningUntilIdle), so the pool is empty before Vercel pauses the instance.
 */
const IDLE_TIMEOUT_SECONDS = process.env.VERCEL ? 5 : 20;

/**
 * Vercel pauses a function instance between requests and resumes it for the next one, sometimes many minutes
 * later. postgres.js's idle timer does not run while paused, so connections used to stay in the pool across the
 * pause, and the network between Vercel and Supabase's pooler drops TCP connections that sit idle for minutes
 * without telling either side. The first query after such a pause went to a dead socket: it failed ("database
 * unreachable") or waited for TCP to give up, which is the intermittent lag. Keeping the instance alive (waitUntil,
 * as Vercel's attachDatabasePool does for other drivers) until the idle connections have closed means a resumed
 * instance always opens a fresh connection, which takes milliseconds from fra1.
 */
let idleWait: { timer: ReturnType<typeof setTimeout>; release: () => void } | null = null;
function keepRunningUntilIdle(): void {
  if (!process.env.VERCEL) return;
  // The previous request's wait ends now; this query's wait takes over and keeps the instance up.
  if (idleWait) {
    clearTimeout(idleWait.timer);
    idleWait.release();
  }
  let release = () => {};
  const done = new Promise<void>((resolve) => (release = resolve));
  // Idle timeout plus a margin for the query itself to finish and the connection to close.
  const timer = setTimeout(() => {
    idleWait = null;
    release();
  }, (IDLE_TIMEOUT_SECONDS + 2) * 1000);
  idleWait = { timer, release };
  try {
    waitUntil(done);
  } catch {
    // No request context (e.g. module evaluation during a build): nothing to keep alive.
  }
}

function connect(): Connection {
  const environment = getEnvironment();
  const sql = postgres(environment.DATABASE_URL, {
    max: environment.DATABASE_POOL_SIZE,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    // Seconds: give up connecting after 10 s.
    connect_timeout: 10,
    // Works behind transaction-mode poolers (PgBouncer, Supabase, Neon).
    prepare: false,
    // One query at a time per connection. postgres.js pipelines concurrent queries on a busy connection by
    // default, and Supabase's transaction pooler (port 6543) never answers a pipelined query: once a page ran
    // more parallel queries than the pool had connections, the pool hung for good (every admin page stuck
    // loading, at once with DATABASE_POOL_SIZE=1). Extra queries now wait for a free connection instead.
    max_pipeline: 1,
    onnotice: () => {},
  });
  // Drizzle calls logQuery before every statement, including those inside transactions.
  const database = drizzle(sql, { schema, logger: { logQuery: keepRunningUntilIdle } });

  // Supabase's poolers ignore statement_timeout sent as a connection setting, so set it inside each
  // transaction instead (SET LOCAL lasts until commit or rollback and is safe behind a transaction pooler).
  const runTransaction = database.transaction.bind(database);
  database.transaction = ((work, config) =>
    runTransaction(async (transaction) => {
      await transaction.execute(drizzleSql.raw(`set local statement_timeout = '${TRANSACTION_STATEMENT_TIMEOUT}'`));
      return work(transaction);
    }, config)) as Database["transaction"];

  return { sql, database };
}

/** The one shared database connection, opened on first use. */
export function getDatabase(): Database {
  globalStore.rentalDatabaseConnection ??= connect();
  return globalStore.rentalDatabaseConnection.database;
}

/** Closes the shared connection (scripts only). */
export async function closeDatabase(): Promise<void> {
  const connection = globalStore.rentalDatabaseConnection;
  globalStore.rentalDatabaseConnection = undefined;
  await connection?.sql.end({ timeout: 5 });
}

export { schema };
