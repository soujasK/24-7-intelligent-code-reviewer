/**
 * SQL template functions, one per PolicyRuleType. Every template returns a
 * SELECT (never a DML statement) shaped as:
 *
 *   node_id BIGINT, file_id INTEGER, start_row INT, end_row INT, evidence VARCHAR
 *
 * so csv-rule-compiler.ts / the scanner can attach rule_id + severity +
 * message uniformly regardless of which template produced the row.
 *
 * All free-text interpolated into SQL goes through sqlStringLiteral() —
 * rule descriptions originate from a CSV upload / Firestore document that
 * is not necessarily trusted input, and DuckDB-Wasm has no prepared-
 * statement parameter binding for dynamically-built predicate lists.
 */
import type { PolicyRule } from '../types/rules';

export const RESULT_COLUMNS = ['node_id', 'file_id', 'start_row', 'end_row', 'evidence'] as const;

export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Identifiers/dotted-call-paths only — used where a value is interpolated
 *  outside of a string literal context is never done; this is for values
 *  we embed as string literals but want to additionally validate look like
 *  callee names (defense in depth against pathological CSV rows). */
function sanitizeCalleeToken(token: string): string {
  return token.replace(/[^A-Za-z0-9_.]/g, '');
}

const DEFAULT_IO_KEYWORDS = [
  'open', 'read', 'write', 'execute', 'query', 'fetch', 'request',
  'socket', 'connect', 'commit', 'session', 'cursor', 'send', 'recv',
];

const DEFAULT_DESERIALIZATION_SINKS = [
  'pickle.loads', 'pickle.load', 'yaml.load', 'marshal.loads',
  'eval', 'exec', 'os.system', 'subprocess.call', 'subprocess.Popen',
];

function calleeIlikePredicate(column: string, keyword: string): string {
  return `${column} ILIKE ${sqlStringLiteral('%' + sanitizeCalleeToken(keyword) + '%')}`;
}

// ---------------------------------------------------------------------------
// IO_IN_LOOP — flags I/O / DB calls nested inside any loop.
// ---------------------------------------------------------------------------
export function compileIoInLoop(rule: PolicyRule): string {
  const keywords = (rule.params.keywords as string | undefined)?.split(',').map((s) => s.trim()) ??
    DEFAULT_IO_KEYWORDS;
  const predicate = keywords.map((k) => calleeIlikePredicate('ce.callee_name', k)).join(' OR ');

  return `
    SELECT
      ce.node_id  AS node_id,
      ce.file_id  AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('I/O-like call "' || ce.callee_name || '" at loop nesting depth ' ||
        ce.enclosing_loop_depth) AS evidence
    FROM call_expressions ce
    JOIN nodes n ON n.node_id = ce.node_id
    WHERE ce.enclosing_loop_depth >= 1
      AND (${predicate})
  `;
}

// ---------------------------------------------------------------------------
// NESTED_LOOP_COMPLEXITY — O(N^k) candidate blocks: a loop at depth >= min
// that structurally contains at least one call expression anywhere in its
// span (span containment via row/col, not just its direct loop id, so
// calls inside doubly-nested inner loops still count against the outer one).
// ---------------------------------------------------------------------------
export function compileNestedLoopComplexity(rule: PolicyRule): string {
  const minDepth = Number(rule.params.minDepth ?? 2);

  return `
    SELECT
      l.node_id   AS node_id,
      l.file_id   AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('nested loop at depth ' || l.nesting_depth || ' contains ' ||
        COUNT(ce.id) || ' call(s): ' || string_agg(DISTINCT ce.callee_name, ', ')) AS evidence
    FROM loops l
    JOIN nodes n ON n.node_id = l.node_id
    JOIN call_expressions ce
      ON ce.file_id = l.file_id
     AND EXISTS (
        SELECT 1 FROM nodes cn
        WHERE cn.node_id = ce.node_id
          AND (cn.start_row > n.start_row OR (cn.start_row = n.start_row AND cn.start_col >= n.start_col))
          AND (cn.end_row   < n.end_row   OR (cn.end_row   = n.end_row   AND cn.end_col   <= n.end_col))
     )
    WHERE l.nesting_depth >= ${minDepth}
    GROUP BY l.node_id, l.file_id, n.start_row, n.end_row, l.nesting_depth
  `;
}

// ---------------------------------------------------------------------------
// UNSANITIZED_DESERIALIZATION — dangerous sinks (eval/exec/pickle/yaml/...).
// ---------------------------------------------------------------------------
export function compileUnsanitizedDeserialization(rule: PolicyRule): string {
  const sinks = (rule.params.sinks as string | undefined)?.split(',').map((s) => s.trim()) ??
    DEFAULT_DESERIALIZATION_SINKS;
  const predicate = sinks
    .map((sink) => `ce.callee_name = ${sqlStringLiteral(sanitizeCalleeToken(sink))}`)
    .join(' OR ');

  return `
    SELECT
      ce.node_id  AS node_id,
      ce.file_id  AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('unsanitized deserialization / injection sink: ' || ce.callee_name || '(' || ce.arg_count || ' args)') AS evidence
    FROM call_expressions ce
    JOIN nodes n ON n.node_id = ce.node_id
    WHERE ${predicate}
  `;
}

// ---------------------------------------------------------------------------
// FORBIDDEN_CALL — a specific banned callee extracted from free text, e.g.
// "Do not call `requests.get` directly, use our internal HttpClient".
// ---------------------------------------------------------------------------
export function compileForbiddenCall(rule: PolicyRule): string {
  const target = sanitizeCalleeToken(String(rule.params.target ?? ''));
  if (!target) {
    // No resolvable target — degrade to a query that matches nothing rather
    // than silently matching everything.
    return `SELECT NULL::BIGINT AS node_id, NULL::INTEGER AS file_id, NULL::INTEGER AS start_row, NULL::INTEGER AS end_row, NULL::VARCHAR AS evidence WHERE FALSE`;
  }
  return `
    SELECT
      ce.node_id  AS node_id,
      ce.file_id  AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('forbidden call: ' || ce.callee_name) AS evidence
    FROM call_expressions ce
    JOIN nodes n ON n.node_id = ce.node_id
    WHERE ce.callee_name = ${sqlStringLiteral(target)}
       OR ce.callee_name ILIKE ${sqlStringLiteral('%.' + target)}
  `;
}

// ---------------------------------------------------------------------------
// BLAST_RADIUS_FANOUT — function called from >= N distinct files: editing
// it is a cross-file breaking-change risk. Backed by v_function_fanout.
// ---------------------------------------------------------------------------
export function compileBlastRadiusFanout(rule: PolicyRule): string {
  const minFiles = Number(rule.params.minFiles ?? 3);

  return `
    SELECT
      f.node_id   AS node_id,
      f.file_id   AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('function "' || f.name || '" has ' || v.caller_file_count ||
        ' distinct caller file(s) across ' || v.call_site_count || ' call site(s)') AS evidence
    FROM v_function_fanout v
    JOIN functions f ON f.id = v.function_id
    JOIN nodes n ON n.node_id = f.node_id
    WHERE v.caller_file_count >= ${minFiles}
  `;
}

// ---------------------------------------------------------------------------
// NAMING_CONVENTION — identifier name must match an extracted regex.
// ---------------------------------------------------------------------------
export function compileNamingConvention(rule: PolicyRule): string {
  const pattern = String(rule.params.pattern ?? '^[a-z_][a-z0-9_]*$');
  return `
    SELECT
      i.node_id   AS node_id,
      i.file_id   AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('identifier "' || i.name || '" (' || i.kind || ') violates naming convention ' ||
        ${sqlStringLiteral(pattern)}) AS evidence
    FROM identifiers i
    JOIN nodes n ON n.node_id = i.node_id
    WHERE i.kind IN ('variable', 'parameter')
      AND NOT regexp_matches(i.name, ${sqlStringLiteral(pattern)})
  `;
}

// ---------------------------------------------------------------------------
// GENERIC_KEYWORD_MATCH — fallback for free-text rules the type parser
// couldn't classify with confidence. Scans raw node text for keywords.
// ---------------------------------------------------------------------------
export function compileGenericKeywordMatch(rule: PolicyRule): string {
  const keywords = (rule.params.keywords as string | undefined)?.split(',').map((s) => s.trim()) ?? [];
  if (keywords.length === 0) {
    return `SELECT NULL::BIGINT AS node_id, NULL::INTEGER AS file_id, NULL::INTEGER AS start_row, NULL::INTEGER AS end_row, NULL::VARCHAR AS evidence WHERE FALSE`;
  }
  const predicate = keywords.map((k) => `n.text ILIKE ${sqlStringLiteral('%' + k + '%')}`).join(' OR ');

  return `
    SELECT
      n.node_id   AS node_id,
      n.file_id   AS file_id,
      n.start_row AS start_row,
      n.end_row   AS end_row,
      ('matched policy keyword in: ' || substr(n.text, 1, 80)) AS evidence
    FROM nodes n
    WHERE n.is_named AND (${predicate})
    LIMIT 500
  `;
}
