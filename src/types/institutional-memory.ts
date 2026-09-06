/**
 * Message contract for institutional-memory.worker.ts, kept in src/types
 * (not the worker file) so main-thread modules like
 * src/firebase/rules-repository.ts can import these types without pulling
 * the worker's WebWorker-lib-only globals into the DOM-lib program (see
 * tsconfig.json vs tsconfig.worker.json).
 */
import type { PolicyRuleType } from './rules';

export interface DistillRequest {
  type: 'DISTILL';
  requestId: string;
  originalFindingSkeleton: string;
  rejectedRemediationText: string;
  developerReplacementText: string;
  originatingPodHint?: PolicyRuleType;
}

export interface DistilledRule {
  type: PolicyRuleType;
  description: string;
}

export interface DistillResult {
  type: 'RESULT';
  requestId: string;
  rule: DistilledRule;
}

export interface DistillError {
  type: 'ERROR';
  requestId: string;
  message: string;
}
