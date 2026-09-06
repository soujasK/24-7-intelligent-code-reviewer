/**
 * Orchestrates: source -> tree-sitter parse -> relational flatten -> bulk
 * Arrow insert into DuckDB-Wasm. This is the "zero-cost filtration" hot
 * path — everything here runs on the main thread (DuckDB-Wasm itself is
 * backed by its own worker; tree-sitter parse is <5ms for typical
 * submission sizes) so the UI can call it synchronously on every debounce
 * tick without user-visible jank.
 */
import { tableFromArrays, type Table } from 'apache-arrow';
import type { FlattenedAst, SupportedLanguage } from '../types/ast';
import { flattenFile, linkCallGraphEdges, SurrogateIdAllocator } from '../parser/ast-flattener';
import { parseSource } from '../parser/tree-sitter-loader';
import { getDuckDbConnection, resetForNewSubmission } from './duckdb-client';

export interface SourceFileInput {
  path: string;
  language: SupportedLanguage;
  content: string;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parses + flattens every file in a submission into one merged relational
 *  graph (shared surrogate-key space -> cross-file CALLS edges resolve). */
export async function buildSubmissionAst(files: readonly SourceFileInput[]): Promise<FlattenedAst[]> {
  const allocator = new SurrogateIdAllocator();
  const flattened: FlattenedAst[] = [];

  for (const file of files) {
    try {
      const tree = await parseSource(file.content, file.language);
      const sourceSha256 = await sha256Hex(file.content);
      flattened.push(
        flattenFile(
          {
            tree,
            path: file.path,
            language: file.language,
            sourceSha256,
            loc: file.content.split('\n').length,
          },
          allocator,
        ),
      );
    } catch (err) {
      console.warn(`[AST Loader] Skipped unparseable file "${file.path}":`, err);
    }
  }

  if (flattened.length === 0) {
    return [];
  }

  // Cross-file call graph resolution needs the full function set up front.
  const allFunctions = flattened.flatMap((f) => f.functions);
  const allCalls = flattened.flatMap((f) => f.callExpressions);
  const callGraphEdges = linkCallGraphEdges(allFunctions, allCalls, allocator);
  const lastFile = flattened[flattened.length - 1];
  if (lastFile) lastFile.edges.push(...callGraphEdges);

  return flattened;
}

// Column order per table, matching ast-schema.sql exactly. Required because
// DuckDB-Wasm's Arrow insert binds columns POSITIONALLY (effectively
// `INSERT INTO t SELECT * FROM arrow_scan(...)`), and tableFromJSON's
// row-wise type inference reorders any column whose *first row* is null to
// the end of the schema (it can't infer a type from that row, so it defers
// it) — parent_id, being null on every file's root node, was routinely
// row[0]'s null column and got pushed last, silently shifting every column
// after it out of alignment with the real table and throwing a cast error
// on whatever ended up sharing node_type's position. Caught only by
// actually running an ingest end-to-end, not by the type checker or a
// build. Building column-major with an explicit key order sidesteps the
// inference entirely.
const TABLE_COLUMNS = {
  source_files: ['file_id', 'path', 'language', 'sha256', 'loc'],
  nodes: [
    'node_id', 'file_id', 'parent_id', 'node_type', 'depth', 'child_index',
    'start_row', 'start_col', 'end_row', 'end_col', 'text', 'is_named',
  ],
  identifiers: ['id', 'node_id', 'file_id', 'name', 'kind', 'enclosing_function_id'],
  functions: ['id', 'node_id', 'file_id', 'name', 'start_row', 'end_row', 'param_count', 'parent_function_id'],
  loops: ['id', 'node_id', 'file_id', 'loop_type', 'nesting_depth', 'parent_loop_id', 'enclosing_function_id'],
  call_expressions: [
    'id', 'node_id', 'file_id', 'callee_name', 'arg_count',
    'enclosing_function_id', 'enclosing_loop_id', 'enclosing_loop_depth',
  ],
  edges: ['id', 'src_node_id', 'dst_node_id', 'edge_type'],
} as const satisfies Record<string, readonly string[]>;

type LoadableTable = keyof typeof TABLE_COLUMNS;

function rowsToColumns(rows: readonly Record<string, unknown>[], columnOrder: readonly string[]): Record<string, unknown[]> {
  const columns: Record<string, unknown[]> = {};
  for (const key of columnOrder) columns[key] = rows.map((row) => row[key] ?? null);
  return columns;
}

/**
 * Bulk-loads flattened ASTs into DuckDB-Wasm via Arrow IPC — orders of
 * magnitude faster than row-by-row INSERTs for the node counts a real
 * submission produces (a 500-line file is routinely 3-6k nodes).
 */
export async function loadAstIntoDuckDb(asts: readonly FlattenedAst[]): Promise<void> {
  await resetForNewSubmission();
  if (asts.length === 0) return;

  const conn = await getDuckDbConnection();

  const asRecords = <T extends object>(rows: T[]) => rows as unknown as Record<string, unknown>[];
  const inserts: Array<[LoadableTable, Record<string, unknown>[]]> = [
    ['source_files', asRecords(asts.map((a) => a.sourceFile))],
    ['nodes', asRecords(asts.flatMap((a) => a.nodes))],
    ['identifiers', asRecords(asts.flatMap((a) => a.identifiers))],
    ['functions', asRecords(asts.flatMap((a) => a.functions))],
    ['loops', asRecords(asts.flatMap((a) => a.loops))],
    ['call_expressions', asRecords(asts.flatMap((a) => a.callExpressions))],
    ['edges', asRecords(asts.flatMap((a) => a.edges))],
  ];

  for (const [tableName, rows] of inserts) {
    if (rows.length === 0) continue;
    const columns = rowsToColumns(rows, TABLE_COLUMNS[tableName]);
    const arrowTable: Table = tableFromArrays(columns);
    await conn.insertArrowTable(arrowTable, { name: tableName, create: false });
  }
}

/** Convenience one-shot: parse, flatten, and load — what the UI calls on
 *  every submission edit. */
export async function ingestSubmission(files: readonly SourceFileInput[]): Promise<FlattenedAst[]> {
  const asts = await buildSubmissionAst(files);
  await loadAstIntoDuckDb(asts);
  return asts;
}
