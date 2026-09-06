/**
 * The CSV-to-AST Policy Compiler.
 *
 * Ingests historical rules — `<id>, <type>, <description>` rows sourced from
 * a CSV upload or the Firestore `rules` collection — and compiles each into
 * an executable DuckDB SELECT (src/policy/rule-templates.ts) plus the
 * scanner that runs the compiled batch against the live AST tables.
 *
 * `type` in the source data is free text ("io-in-loop", "IO in Loop", "io_in_loop")
 * so normalization is deliberately permissive; anything unrecognized still
 * compiles, via GENERIC_KEYWORD_MATCH, rather than being dropped.
 */
import type { DuckDbConnection } from '../db/duckdb-client';
import type { CompiledPolicyQuery, PolicyRule, PolicyRuleType, PolicyViolation, RawPolicyRule, RuleSeverity } from '../types/rules';
import {
  compileBlastRadiusFanout,
  compileForbiddenCall,
  compileGenericKeywordMatch,
  compileIoInLoop,
  compileNamingConvention,
  compileNestedLoopComplexity,
  compileUnsanitizedDeserialization,
} from './rule-templates';

const TEMPLATES: Record<PolicyRuleType, (rule: PolicyRule) => string> = {
  IO_IN_LOOP: compileIoInLoop,
  NESTED_LOOP_COMPLEXITY: compileNestedLoopComplexity,
  UNSANITIZED_DESERIALIZATION: compileUnsanitizedDeserialization,
  FORBIDDEN_CALL: compileForbiddenCall,
  BLAST_RADIUS_FANOUT: compileBlastRadiusFanout,
  NAMING_CONVENTION: compileNamingConvention,
  GENERIC_KEYWORD_MATCH: compileGenericKeywordMatch,
};

const TYPE_ALIASES: Record<string, PolicyRuleType> = {
  'formatting': 'NAMING_CONVENTION',
  'style': 'NAMING_CONVENTION',
  'naming': 'NAMING_CONVENTION',
  'naming-convention': 'NAMING_CONVENTION',
  'performance': 'IO_IN_LOOP',
  'perf': 'IO_IN_LOOP',
  'io-in-loop': 'IO_IN_LOOP',
  'io_in_loop': 'IO_IN_LOOP',
  'iointloop': 'IO_IN_LOOP',
  'security': 'UNSANITIZED_DESERIALIZATION',
  'sec': 'UNSANITIZED_DESERIALIZATION',
  'deserialization': 'UNSANITIZED_DESERIALIZATION',
  'unsafe-deserialization': 'UNSANITIZED_DESERIALIZATION',
  'insecure-deserialization': 'UNSANITIZED_DESERIALIZATION',
  'nested-loop': 'NESTED_LOOP_COMPLEXITY',
  'nested-loop-complexity': 'NESTED_LOOP_COMPLEXITY',
  'complexity': 'NESTED_LOOP_COMPLEXITY',
  'forbidden-call': 'FORBIDDEN_CALL',
  'banned-api': 'FORBIDDEN_CALL',
  'blast-radius': 'BLAST_RADIUS_FANOUT',
  'fan-out': 'BLAST_RADIUS_FANOUT',
};

function normalizeType(rawType: string): PolicyRuleType {
  const key = rawType.trim().toLowerCase().replace(/\s+/g, '-');
  const upperSnake = key.replace(/-/g, '_').toUpperCase();
  if (upperSnake in TEMPLATES) return upperSnake as PolicyRuleType;
  const alias = TYPE_ALIASES[key];
  if (alias) return alias;
  return 'GENERIC_KEYWORD_MATCH';
}

const ERROR_SIGNAL_WORDS = ['must not', 'forbidden', 'never', 'critical', 'security', 'vulnerability'];
const WARN_SIGNAL_WORDS = ['should', 'avoid', 'prefer', 'discouraged'];

function inferSeverity(description: string): RuleSeverity {
  const lower = description.toLowerCase();
  if (ERROR_SIGNAL_WORDS.some((w) => lower.includes(w))) return 'error';
  if (WARN_SIGNAL_WORDS.some((w) => lower.includes(w))) return 'warn';
  return 'warn';
}

/** Pulls backtick/quoted tokens out of free text, e.g.
 *  "Use our internal `CacheWrapper` instead of `functools.lru_cache`". */
function extractQuotedTokens(description: string): string[] {
  const tokens: string[] = [];
  const patterns = [/`([^`]+)`/g, /"([^"]+)"/g, /'([^']+)'/g];
  for (const pattern of patterns) {
    for (const match of description.matchAll(pattern)) {
      const captured = match[1];
      if (captured) tokens.push(captured);
    }
  }
  return tokens;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'of', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just',
  'should', 'now', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'avoid', 'never',
  'hurt', 'must', 'always', 'make', 'sure', 'shouldn'
]);

function extractKeywords(description: string): string[] {
  const quoted = extractQuotedTokens(description);
  if (quoted.length > 0) return quoted;

  return description
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function extractFirstNumber(description: string, fallback: number): number {
  const match = description.match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

/** Extracts type-specific params from the free-text description so the
 *  compiled SQL is grounded in the rule's actual intent. */
function extractParams(type: PolicyRuleType, description: string): PolicyRule['params'] {
  const quoted = extractQuotedTokens(description);
  const keywords = extractKeywords(description);

  switch (type) {
    case 'IO_IN_LOOP':
    case 'UNSANITIZED_DESERIALIZATION':
    case 'GENERIC_KEYWORD_MATCH':
      return { keywords: keywords.join(',') };
    case 'NESTED_LOOP_COMPLEXITY':
      return { minDepth: extractFirstNumber(description, 2) };
    case 'FORBIDDEN_CALL': {
      const dotted = description.match(/\b[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+\b/);
      return { target: quoted[0] ?? dotted?.[0] ?? keywords[0] ?? 'abs' };
    }
    case 'BLAST_RADIUS_FANOUT':
      return { minFiles: extractFirstNumber(description, 3) };
    case 'NAMING_CONVENTION': {
      if (description.toLowerCase().includes('single-character') || description.toLowerCase().includes('single character')) {
        return { pattern: '^[a-zA-Z_][a-zA-Z0-9_]{1,}$' };
      }
      const pattern = quoted[0];
      return pattern ? { pattern } : { pattern: '^[a-z_][a-z0-9_]*$' };
    }
    default:
      return { keywords: keywords.join(',') };
  }
}

export function normalizeRule(raw: RawPolicyRule): PolicyRule {
  const type = normalizeType(raw.type);
  return {
    id: raw.id,
    type,
    description: raw.description,
    severity: inferSeverity(raw.description),
    params: extractParams(type, raw.description),
  };
}

/** Public entry point: CSV/Firestore rows -> executable SQL, ready to hand
 *  to runCompiledPolicyQueries() or to persist into policy_rules for audit
 *  replay (see ast-schema.sql). */
export function compileRulesToSql(rawRules: readonly RawPolicyRule[]): CompiledPolicyQuery[] {
  return rawRules.map((raw) => {
    const rule = normalizeRule(raw);
    const compile = TEMPLATES[rule.type];
    return {
      ruleId: rule.id,
      ruleType: rule.type,
      description: rule.description,
      severity: rule.severity,
      sql: compile(rule).trim(),
    };
  });
}

interface RawViolationRow {
  node_id: bigint | number;
  file_id: number;
  start_row: number;
  end_row: number;
  evidence: string;
}

/** The Deterministic Query Scanner: executes every compiled query against
 *  the live DuckDB-Wasm connection and flattens results into PolicyViolation
 *  rows. Independent SELECTs run concurrently — DuckDB-Wasm connections
 *  serialize internally, but issuing them via Promise.all avoids a
 *  round-trip stall per rule waiting on the worker message queue. */
export async function runCompiledPolicyQueries(
  conn: DuckDbConnection,
  queries: readonly CompiledPolicyQuery[],
): Promise<PolicyViolation[]> {
  const results = await Promise.all(
    queries.map(async (q): Promise<PolicyViolation[]> => {
      const result = await conn.query(q.sql);
      const rows = result.toArray() as unknown as RawViolationRow[];
      return rows
        .filter((row) => row.node_id !== null && row.node_id !== undefined)
        .map((row) => ({
          ruleId: q.ruleId,
          ruleType: q.ruleType,
          severity: q.severity,
          fileId: row.file_id,
          nodeId: Number(row.node_id),
          startRow: row.start_row,
          endRow: row.end_row,
          message: q.description,
          evidence: row.evidence,
        }));
    }),
  );
  return results.flat();
}

/** Persists the compiled rule set into policy_rules so a scan run is fully
 *  replayable/auditable from the DuckDB instance alone (paired with the
 *  attestation digest — see src/attestation/audit-hash.ts). */
export async function persistCompiledRules(
  conn: DuckDbConnection,
  queries: readonly CompiledPolicyQuery[],
): Promise<void> {
  await conn.query('DELETE FROM policy_rules;');
  for (const q of queries) {
    const escapedSql = q.sql.replace(/'/g, "''");
    const escapedDesc = q.description.replace(/'/g, "''");
    await conn.query(
      `INSERT INTO policy_rules (rule_id, rule_type, description, severity, sql_text)
       VALUES (${q.ruleId}, '${q.ruleType}', '${escapedDesc}', '${q.severity}', '${escapedSql}');`,
    );
  }
}
