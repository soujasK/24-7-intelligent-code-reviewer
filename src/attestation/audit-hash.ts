/**
 * Cryptographic Audit Attestation Generator.
 *
 * Hashes (SHA-256, Web Crypto) the audited AST *structure* — never raw
 * source text or identifier names — together with the rule-compliance
 * results and CP-fuzz verdicts, then signs the combined digest with the
 * developer's client-side ECDSA P-256 key (see signing-keys.ts). The
 * resulting AuditReceipt proves "this code was vetted against these
 * policies and passed these tests" without the source ever crossing the
 * network, and is tamper-evident: mutate any input and the recomputed
 * digest chain no longer matches the signed one.
 */
import type { FlattenedAst } from '../types/ast';
import type { PolicyViolation } from '../types/rules';
import type { TestVerdict } from '../types/verdicts';
import type { AttestationSubject, AuditReceipt, VerificationResult } from '../types/attestation';
import { exportPublicKeyJwk, getOrCreateSigningKeyPair, importPublicKeyJwk } from './signing-keys';

const SIGN_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

// ---- byte/hex/base64 plumbing ---------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Pinned to the `ArrayBuffer`-backed generic (not the `ArrayBufferLike`
// default, which also covers SharedArrayBuffer) — TS 5.7+'s stricter
// `BufferSource` typing on crypto.subtle.sign/verify requires exactly this,
// since a SharedArrayBuffer-backed view isn't a valid signing input.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/** Deterministic JSON: object keys sorted recursively so semantically
 *  identical inputs always hash identically regardless of construction
 *  order (JS object key insertion order is NOT something we want to rely
 *  on for a cryptographic commitment). */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

// ---- digest computation ----------------------------------------------------

/** Structure-only hash: node kind, depth, sibling order, and parent linkage.
 *  Deliberately drops `text`/columns so the digest can't be reversed into
 *  source content, while still changing if a single node is added, removed,
 *  reordered, or reparented anywhere in the submission. */
export async function computeAstStructuralHash(asts: readonly FlattenedAst[]): Promise<string> {
  const structural = asts
    .flatMap((ast) => ast.nodes)
    .sort((a, b) => a.file_id - b.file_id || a.node_id - b.node_id)
    .map((n) => ({ f: n.file_id, t: n.node_type, d: n.depth, c: n.child_index, p: n.parent_id }));
  return sha256Hex(canonicalStringify(structural));
}

async function computeRuleComplianceHash(violations: readonly PolicyViolation[]): Promise<string> {
  const normalized = [...violations]
    .sort((a, b) => a.ruleId - b.ruleId || a.nodeId - b.nodeId)
    .map((v) => ({ r: v.ruleId, n: v.nodeId, f: v.fileId, sev: v.severity }));
  return sha256Hex(canonicalStringify(normalized));
}

async function computeCpVerdictHash(verdicts: readonly TestVerdict[]): Promise<string> {
  const normalized = [...verdicts]
    .sort((a, b) => a.testId.localeCompare(b.testId))
    .map((v) => ({ id: v.testId, status: v.status, ms: v.runtimeMs.toFixed(3) }));
  return sha256Hex(canonicalStringify(normalized));
}

export interface BuildAttestationSubjectParams {
  submissionId: string;
  fileShas: readonly string[];
  asts: readonly FlattenedAst[];
  ruleSetVersion: string;
  violations: readonly PolicyViolation[];
  cpVerdicts: readonly TestVerdict[];
}

export async function buildAttestationSubject(params: BuildAttestationSubjectParams): Promise<AttestationSubject> {
  return {
    submissionId: params.submissionId,
    fileShas: [...params.fileShas].sort(),
    astStructuralHash: await computeAstStructuralHash(params.asts),
    ruleSetVersion: params.ruleSetVersion,
    violations: [...params.violations],
    cpVerdicts: [...params.cpVerdicts],
    timestamp: new Date().toISOString(),
  };
}

// ---- sign / verify ----------------------------------------------------------

/** Produces the tamper-evident, signed AuditReceipt for a submission. */
export async function signAttestation(subject: AttestationSubject, issuer: string): Promise<AuditReceipt> {
  const subjectDigestHex = await sha256Hex(
    canonicalStringify({
      submissionId: subject.submissionId,
      fileShas: subject.fileShas,
      astStructuralHash: subject.astStructuralHash,
      ruleSetVersion: subject.ruleSetVersion,
      timestamp: subject.timestamp,
    }),
  );
  const ruleComplianceDigestHex = await computeRuleComplianceHash(subject.violations);
  const cpVerdictDigestHex = await computeCpVerdictHash(subject.cpVerdicts);
  const combinedDigestHex = await sha256Hex(subjectDigestHex + ruleComplianceDigestHex + cpVerdictDigestHex);

  const keyPair = await getOrCreateSigningKeyPair();
  const signatureBytes = await crypto.subtle.sign(SIGN_PARAMS, keyPair.privateKey, hexToBytes(combinedDigestHex));

  return {
    version: 1,
    issuer,
    subjectDigestHex,
    ruleComplianceDigestHex,
    cpVerdictDigestHex,
    combinedDigestHex,
    signatureB64: bytesToBase64(new Uint8Array(signatureBytes)),
    publicKeyJwk: await exportPublicKeyJwk(keyPair.publicKey),
    algorithm: 'ECDSA-P256-SHA256',
    issuedAt: new Date().toISOString(),
  };
}

/** Recomputes every digest from `subject` and checks it against what's
 *  embedded in `receipt`, then verifies the ECDSA signature over the
 *  combined digest using the receipt's own embedded public key. Callers
 *  that need real identity assurance (not just internal consistency) must
 *  additionally check `receipt.publicKeyJwk` against the issuer's key on
 *  file in Firestore — see rules-repository.ts — since anyone can regenerate
 *  a fresh keypair and sign a fabricated receipt with it. */
export async function verifyAttestation(receipt: AuditReceipt, subject: AttestationSubject): Promise<VerificationResult> {
  const reasons: string[] = [];

  const recomputedSubjectDigest = await sha256Hex(
    canonicalStringify({
      submissionId: subject.submissionId,
      fileShas: subject.fileShas,
      astStructuralHash: subject.astStructuralHash,
      ruleSetVersion: subject.ruleSetVersion,
      timestamp: subject.timestamp,
    }),
  );
  if (recomputedSubjectDigest !== receipt.subjectDigestHex) reasons.push('subject digest mismatch (AST/metadata tampered)');

  const recomputedRuleHash = await computeRuleComplianceHash(subject.violations);
  if (recomputedRuleHash !== receipt.ruleComplianceDigestHex) reasons.push('rule compliance digest mismatch (violations tampered)');

  const recomputedVerdictHash = await computeCpVerdictHash(subject.cpVerdicts);
  if (recomputedVerdictHash !== receipt.cpVerdictDigestHex) reasons.push('CP verdict digest mismatch (test results tampered)');

  const recomputedCombined = await sha256Hex(
    recomputedSubjectDigest + recomputedRuleHash + recomputedVerdictHash,
  );
  if (recomputedCombined !== receipt.combinedDigestHex) reasons.push('combined digest mismatch');

  let signatureValid = false;
  try {
    const publicKey = await importPublicKeyJwk(receipt.publicKeyJwk);
    signatureValid = await crypto.subtle.verify(
      SIGN_PARAMS,
      publicKey,
      base64ToBytes(receipt.signatureB64),
      hexToBytes(receipt.combinedDigestHex),
    );
    if (!signatureValid) reasons.push('signature does not verify against embedded public key');
  } catch (err) {
    reasons.push(`signature verification error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { valid: reasons.length === 0 && signatureValid, reasons };
}
