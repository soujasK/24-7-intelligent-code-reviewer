/**
 * Shared contract for the Wasm Agent Swarm pods (security / complexity /
 * architecture). Each pod is its own Web Worker running the SAME message
 * protocol, so the orchestrator (src/state/swarm-orchestrator.ts) can spawn
 * and address them uniformly.
 *
 * Pods do NOT hold their own DuckDB connection — the orchestrator queries
 * DuckDB once on the main thread and posts the relevant AST rows to every
 * pod in parallel. This avoids giving every worker its own wasm DuckDB
 * instance (expensive) just to re-read data the orchestrator already has.
 */
import type { AstNodeRow, CallExpressionRow, FunctionRow, IdentifierRow, LoopRow } from './ast';

export type PodId = 'security' | 'complexity' | 'architecture';
export type FindingSeverity = 'info' | 'warn' | 'error';

interface PodFindingBase {
  nodeId: number;
  fileId: number;
  startRow: number;
  endRow: number;
  severity: FindingSeverity;
  title: string;
  detail: string;
  /** True if this finding is significant enough to warrant an LLM-generated
   *  remediation — which in turn means the sanitizer must produce an
   *  anonymized skeleton before anything leaves the browser. */
  requiresRemediation: boolean;
}

export interface SecurityFinding extends PodFindingBase {
  podId: 'security';
  sinkCallee: string;
  taintedBy: string[];
}

export interface ComplexityFinding extends PodFindingBase {
  podId: 'complexity';
  nestingDepth: number;
  estimatedComplexityClass: string;
  callsInBody: string[];
}

export interface ArchitectureFinding extends PodFindingBase {
  podId: 'architecture';
  functionName: string;
  callerFileCount: number;
  callSiteCount: number;
}

export type PodFinding = SecurityFinding | ComplexityFinding | ArchitectureFinding;

export interface RemediationCandidate {
  podId: PodId;
  nodeId: number;
  /** Scrubbed source: identifiers -> role-based placeholders, literals ->
   *  type tags. Safe to transmit to an LLM. See src/workers/sanitizer.ts. */
  anonymizedSkeleton: string;
  reason: string;
}

export interface PodAnalyzeMessage {
  type: 'ANALYZE';
  submissionId: string;
  files: Array<{ fileId: number; path: string }>;
  nodes: AstNodeRow[];
  identifiers: IdentifierRow[];
  functions: FunctionRow[];
  loops: LoopRow[];
  callExpressions: CallExpressionRow[];
}

export interface PodResultMessage {
  type: 'RESULT';
  podId: PodId;
  submissionId: string;
  findings: PodFinding[];
  remediationCandidates: RemediationCandidate[];
}

export interface PodErrorMessage {
  type: 'ERROR';
  podId: PodId;
  submissionId: string;
  message: string;
}

export type PodInboundMessage = PodAnalyzeMessage;
export type PodOutboundMessage = PodResultMessage | PodErrorMessage;
