/**
 * Policy rule domain types shared between the Firestore rule store,
 * the CSV-to-SQL compiler, and the closed-loop institutional-memory worker.
 */

/** Canonical rule taxonomy. New types added by the correction-distiller worker
 *  must register a template in src/policy/rule-templates.ts or fall back to
 *  GENERIC_KEYWORD_MATCH. */
export type PolicyRuleType =
  | 'IO_IN_LOOP'
  | 'NESTED_LOOP_COMPLEXITY'
  | 'UNSANITIZED_DESERIALIZATION'
  | 'FORBIDDEN_CALL'
  | 'BLAST_RADIUS_FANOUT'
  | 'NAMING_CONVENTION'
  | 'GENERIC_KEYWORD_MATCH';

export type RuleSeverity = 'info' | 'warn' | 'error';

/** Raw row as ingested from the historical CSV / Firestore `rules` collection. */
export interface RawPolicyRule {
  id: number;
  type: string;
  description: string;
}

/** Normalized rule after type coercion + severity inference. */
export interface PolicyRule {
  id: number;
  type: PolicyRuleType;
  description: string;
  severity: RuleSeverity;
  /** Params extracted from free-text `description` by the template parser. */
  params: Record<string, string | number>;
}

export interface CompiledPolicyQuery {
  ruleId: number;
  ruleType: PolicyRuleType;
  description: string;
  severity: RuleSeverity;
  sql: string;
}

export interface PolicyViolation {
  ruleId: number;
  ruleType: PolicyRuleType;
  severity: RuleSeverity;
  fileId: number;
  nodeId: number;
  startRow: number;
  endRow: number;
  message: string;
  evidence: string;
}
