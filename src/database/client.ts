import "server-only";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
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

function connect(): Connection {
  const environment = getEnvironment();
  const sql = postgres(environment.DATABASE_URL, {
    max: environment.DATABASE_POOL_SIZE,
    // Seconds: close idle connections after 20 s; give up connecting after 10 s.
    idle_timeout: 20,
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
  const database = drizzle(sql, { schema });

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
