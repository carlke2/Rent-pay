import "server-only";
import { after } from "next/server";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import type postgres from "postgres";

/**
 * Per-request query counter and timer, on when DB_TRACE=1 (off by default, also on Vercel). After each request it
 * logs one line: route, number of queries, summed query time, and time from the request's first query until the
 * response finished. With DB_TRACE_SLOW=<ms>, statements slower than that are logged with their SQL text
 * (placeholders only; parameter values are never logged).
 */
export const traceEnabled = process.env.DB_TRACE === "1";
const slowMs = Number(process.env.DB_TRACE_SLOW ?? 0) || 0;

type Trace = { route: string; queries: number; dbMs: number; started: number };
// One trace per Next work store (one per request render, route handler or server action).
const traces = new WeakMap<object, Trace>();

function currentTrace(): Trace | null {
  const store = workAsyncStorage.getStore();
  if (!store) return null;
  let trace = traces.get(store);
  if (!trace) {
    trace = { route: store.route, queries: 0, dbMs: 0, started: performance.now() };
    traces.set(store, trace);
    const finished = trace;
    try {
      after(() => {
        const total = performance.now() - finished.started;
        console.log(`[db] ${finished.route} queries=${finished.queries} db=${Math.round(finished.dbMs)}ms total=${Math.round(total)}ms`);
      });
    } catch {
      // Outside a request scope that allows after(): count without the summary line.
    }
  }
  return trace;
}

type PendingQuery = Promise<unknown> & { then: Promise<unknown>["then"] };

function timeQuery(query: PendingQuery, text: string): PendingQuery {
  const trace = currentTrace();
  if (!trace) return query;
  trace.queries += 1;
  const run = query.then.bind(query);
  let started = 0;
  // postgres.js runs a query when it is first awaited; time it from then until it settles.
  query.then = ((resolve, reject) => {
    if (!started) {
      started = performance.now();
      const done = () => {
        const ms = performance.now() - started;
        trace.dbMs += ms;
        if (slowMs && ms >= slowMs) console.log(`[db-slow] ${trace.route} ${Math.round(ms)}ms ${text.replace(/\s+/g, " ").slice(0, 400)}`);
      };
      run(done, done);
    }
    return run(resolve, reject);
  }) as PendingQuery["then"];
  return query;
}

/** Wraps a postgres.js client (and the clients it hands to transactions) so every statement is counted. */
export function traceClient(sql: postgres.Sql): void {
  if (!traceEnabled) return;
  wrapUnsafe(sql);
  const begin = sql.begin.bind(sql) as (...args: unknown[]) => Promise<unknown>;
  (sql as unknown as { begin: unknown }).begin = (...args: unknown[]) => {
    const work = args[args.length - 1] as (transaction: postgres.TransactionSql) => unknown;
    const wrapped = (transaction: postgres.TransactionSql) => {
      wrapUnsafe(transaction as unknown as postgres.Sql);
      return work(transaction);
    };
    return begin(...args.slice(0, -1), wrapped);
  };
}

function wrapUnsafe(sql: postgres.Sql) {
  const unsafe = sql.unsafe.bind(sql) as (...args: unknown[]) => PendingQuery;
  (sql as unknown as { unsafe: unknown }).unsafe = (...args: unknown[]) => timeQuery(unsafe(...args), String(args[0]));
}
