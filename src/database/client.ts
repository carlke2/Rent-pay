import "server-only";
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

function connect(): Connection {
  const environment = getEnvironment();
  const sql = postgres(environment.DATABASE_URL, {
    max: environment.DATABASE_POOL_SIZE,
    idle_timeout: 20,
    connect_timeout: 10,
    // Works behind transaction-mode poolers (PgBouncer, Supabase, Neon).
    prepare: false,
    onnotice: () => {},
  });
  return { sql, database: drizzle(sql, { schema }) };
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
