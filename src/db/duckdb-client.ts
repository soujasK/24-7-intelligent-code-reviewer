/**
 * Singleton DuckDB-Wasm instance for the whole tab. One AsyncDuckDB + one
 * connection are created lazily on first use and reused for every scan —
 * spinning up a fresh wasm instance per submission would blow the "$0
 * compute, sub-10ms" budget on instantiation alone (~150-300ms cold).
 *
 * Submissions are isolated by TRUNCATE, not by re-instantiation (see
 * resetForNewSubmission()).
 */
import * as duckdb from '@duckdb/duckdb-wasm';

// Vite-native asset URLs — see https://duckdb.org/docs/api/wasm/instantiation
import duckdbWasmMvp from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbWorkerMvp from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

// Raw-text import of the schema so it ships as a single source of truth
// instead of being duplicated as a template string.
import astSchemaSql from './ast-schema.sql?raw';

export type DuckDbConnection = duckdb.AsyncDuckDBConnection;

let dbSingleton: duckdb.AsyncDuckDB | null = null;
let connSingleton: DuckDbConnection | null = null;
let initPromise: Promise<DuckDbConnection> | null = null;

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbWasmMvp,
    mainWorker: duckdbWorkerMvp,
  },
  eh: {
    mainModule: duckdbWasmEh,
    mainWorker: duckdbWorkerEh,
  },
};

/** Splits a .sql file into individually-executable statements.
 *  DuckDB-Wasm's conn.query() expects one statement per call; ast-schema.sql
 *  intentionally contains many (tables, indexes, a view).
 *
 *  Every statement preceded by a doc comment (nearly all of them) starts,
 *  after splitting + trimming, with that comment line — an earlier version
 *  of this function rejected any chunk starting with `--`, which silently
 *  discarded the CREATE TABLE/INDEX/VIEW itself along with its comment,
 *  not just the comment. Caught at runtime (`Table with name nodes does
 *  not exist`), not at compile time: strip full-line comments line-by-line
 *  instead of rejecting the whole chunk. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((stmt) =>
      stmt
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);
}

async function bootstrap(): Promise<DuckDbConnection> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker = new Worker(bundle.mainWorker!, { type: 'module' });
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);

  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  const conn = await db.connect();
  for (const statement of splitStatements(astSchemaSql)) {
    await conn.query(statement);
  }

  dbSingleton = db;
  connSingleton = conn;
  return conn;
}

/** Returns the shared connection, instantiating DuckDB-Wasm on first call. */
export function getDuckDbConnection(): Promise<DuckDbConnection> {
  if (connSingleton) return Promise.resolve(connSingleton);
  if (!initPromise) initPromise = bootstrap();
  return initPromise;
}

/** Wipes all rows without tearing down the wasm instance — this is what
 *  runs between two submissions/scans, keeping the hot path fast. */
export async function resetForNewSubmission(): Promise<void> {
  const conn = await getDuckDbConnection();
  const tables = [
    'violations',
    'policy_rules',
    'edges',
    'call_expressions',
    'loops',
    'functions',
    'identifiers',
    'nodes',
    'source_files',
  ];
  for (const table of tables) {
    await conn.query(`DELETE FROM ${table};`);
  }
}

export async function terminateDuckDb(): Promise<void> {
  await connSingleton?.close();
  await dbSingleton?.terminate();
  connSingleton = null;
  dbSingleton = null;
  initPromise = null;
}
