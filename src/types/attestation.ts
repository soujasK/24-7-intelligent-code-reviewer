import type { PolicyViolation } from './rules';
import type { TestVerdict } from './verdicts';

/** Canonicalized inputs that get hashed into the audit digest. Only
 *  structural/derived data — never raw source text or identifier names. */
export interface AttestationSubject {
  submissionId: string;
  fileShas: string[];
  /** Hash of the flattened AST node stream (structure only, see astStructuralHash). */
  astStructuralHash: string;
  ruleSetVersion: string;
  violations: PolicyViolation[];
  cpVerdicts: TestVerdict[];
  timestamp: string; // ISO-8601, UTC
}

export interface AuditReceipt {
  version: 1;
  issuer: string; // developer/org identifier (e.g. Firebase UID)
  subjectDigestHex: string;
  ruleComplianceDigestHex: string;
  cpVerdictDigestHex: string;
  combinedDigestHex: string;
  signatureB64: string;
  publicKeyJwk: JsonWebKey;
  algorithm: 'ECDSA-P256-SHA256';
  issuedAt: string;
}

export interface VerificationResult {
  valid: boolean;
  reasons: string[];
}
