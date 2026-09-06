/**
 * useSwarmOrchestrator — the glue hook wiring every engine built in this
 * project into one pipeline a component can call:
 *
 *   submit(files, rules)        AST-ground + deterministic scan + swarm analysis
 *   runFuzz(code, testCases)    CP-style verification gate
 *   attest(...)                 sign the audit receipt over everything above
 *
 * Each stage's output is exactly the typed shape its engine already
 * produces — this file does no transformation, only sequencing, worker
 * lifecycle management, and React state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ingestSubmission, type SourceFileInput } from '../db/ast-loader';
import { getDuckDbConnection } from '../db/duckdb-client';
import { compileRulesToSql, persistCompiledRules, runCompiledPolicyQueries } from '../policy/csv-rule-compiler';
import { buildAttestationSubject, signAttestation } from '../attestation/audit-hash';
import { requestRemediationSuggestion } from '../firebase/llm-remediation';
import { buildAnonymizedSkeleton } from '../workers/sanitizer';
import { FuzzerClient } from '../workers/fuzzer-client';
import type { FlattenedAst } from '../types/ast';
import type { RawPolicyRule, PolicyViolation } from '../types/rules';
import type { PodAnalyzeMessage, PodFinding, PodId, PodOutboundMessage, RemediationCandidate } from '../types/pods';
import type { FuzzTestCase, RunSummary, TestVerdict } from '../types/verdicts';
import type { AuditReceipt } from '../types/attestation';

export type SwarmPhase = 'idle' | 'ingesting' | 'scanning' | 'analyzing' | 'fuzzing' | 'attesting' | 'done' | 'error';

export interface SwarmState {
  phase: SwarmPhase;
  asts: FlattenedAst[];
  violations: PolicyViolation[];
  findings: PodFinding[];
  remediationCandidates: RemediationCandidate[];
  fuzzSummary: RunSummary | null;
  receipt: AuditReceipt | null;
  error: string | null;
}

const INITIAL_STATE: SwarmState = {
  phase: 'idle', asts: [], violations: [], findings: [], remediationCandidates: [],
  fuzzSummary: null, receipt: null, error: null,
};

const POD_IDS: PodId[] = ['security', 'complexity', 'architecture'];

/**
 * Vite's worker-asset analysis only reliably recognizes the
 * `new Worker(new URL('./literal.ts', import.meta.url))` shape written
 * inline — routing the same literal through an object-literal lookup table
 * of URL-factories (tried first here) makes Rollup's static scan miss two
 * of the three pods silently at build time. Keep each constructor call
 * textually literal, one per branch.
 */
function createPodWorker(id: PodId): Worker {
  switch (id) {
    case 'security':
      return new Worker(new URL('../workers/security-pod.worker.ts', import.meta.url), { type: 'module' });
    case 'complexity':
      return new Worker(new URL('../workers/complexity-pod.worker.ts', import.meta.url), { type: 'module' });
    case 'architecture':
      return new Worker(new URL('../workers/architecture-pod.worker.ts', import.meta.url), { type: 'module' });
  }
}

export interface AttestParams {
  submissionId: string;
  fileShas: string[];
  ruleSetVersion: string;
  issuer: string;
}

export function useSwarmOrchestrator() {
  const [state, setState] = useState<SwarmState>(INITIAL_STATE);
  const podWorkers = useRef<Partial<Record<PodId, Worker>>>({});
  const fuzzerClient = useRef<FuzzerClient | null>(null);

  const ensurePod = useCallback((id: PodId): Worker => {
    let worker = podWorkers.current[id];
    if (!worker) {
      worker = createPodWorker(id);
      podWorkers.current[id] = worker;
    }
    return worker;
  }, []);

  const runPod = useCallback((id: PodId, message: PodAnalyzeMessage): Promise<{ findings: PodFinding[]; remediationCandidates: RemediationCandidate[] }> => {
    return new Promise((resolve, reject) => {
      const worker = ensurePod(id);
      const handleMessage = (event: MessageEvent<PodOutboundMessage>) => {
        if (event.data.submissionId !== message.submissionId) return;
        worker.removeEventListener('message', handleMessage);
        if (event.data.type === 'RESULT') resolve({ findings: event.data.findings, remediationCandidates: event.data.remediationCandidates });
        else reject(new Error(`[${id} pod] ${event.data.message}`));
      };
      worker.addEventListener('message', handleMessage);
      worker.postMessage(message);
    });
  }, [ensurePod]);

  /** Stage 1-3: AST grounding -> deterministic policy scan -> swarm analysis. */
  const submit = useCallback(async (
    files: SourceFileInput[],
    rawRules: readonly RawPolicyRule[],
  ): Promise<{ submissionId: string; asts: FlattenedAst[]; violations: PolicyViolation[]; findings: PodFinding[]; remediationCandidates: RemediationCandidate[] }> => {
    setState((s) => ({ ...s, phase: 'ingesting', error: null }));
    try {
      const asts = await ingestSubmission(files);

      setState((s) => ({ ...s, phase: 'scanning', asts }));
      const conn = await getDuckDbConnection();
      const compiled = compileRulesToSql(rawRules);
      await persistCompiledRules(conn, compiled);
      const violations = await runCompiledPolicyQueries(conn, compiled);

      setState((s) => ({ ...s, phase: 'analyzing', violations }));
      const submissionId = crypto.randomUUID();
      const podMessage: PodAnalyzeMessage = {
        type: 'ANALYZE',
        submissionId,
        files: asts.map((a) => ({ fileId: a.sourceFile.file_id, path: a.sourceFile.path })),
        nodes: asts.flatMap((a) => a.nodes),
        identifiers: asts.flatMap((a) => a.identifiers),
        functions: asts.flatMap((a) => a.functions),
        loops: asts.flatMap((a) => a.loops),
        callExpressions: asts.flatMap((a) => a.callExpressions),
      };
      const resultsByPod = await Promise.all(POD_IDS.map((id) => runPod(id, podMessage)));
      const findings = resultsByPod.flatMap((r) => r.findings);
      const remediationCandidates = resultsByPod.flatMap((r) => r.remediationCandidates);

      setState((s) => ({ ...s, phase: 'done', findings, remediationCandidates }));
      return { submissionId, asts, violations, findings, remediationCandidates };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: 'error', error: message }));
      throw err;
    }
  }, [runPod]);

  /** Stage 4: local CP-fuzzing verification gate. */
  const runFuzz = useCallback(async (
    code: string,
    testCases: FuzzTestCase[],
    onVerdict?: (verdict: TestVerdict) => void,
  ): Promise<RunSummary> => {
    if (!fuzzerClient.current) fuzzerClient.current = new FuzzerClient();
    setState((s) => ({ ...s, phase: 'fuzzing', error: null }));
    try {
      const summary = await fuzzerClient.current.run({ code, testCases }, onVerdict);
      setState((s) => ({ ...s, phase: 'done', fuzzSummary: summary }));
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: 'error', error: message }));
      throw err;
    }
  }, []);

  /** Stage 5: sign the audit receipt over whatever's accumulated so far. */
  const attest = useCallback(async (params: AttestParams): Promise<AuditReceipt> => {
    setState((s) => ({ ...s, phase: 'attesting', error: null }));
    try {
      const subject = await buildAttestationSubject({
        submissionId: params.submissionId,
        fileShas: params.fileShas,
        asts: state.asts,
        ruleSetVersion: params.ruleSetVersion,
        violations: state.violations,
        cpVerdicts: state.fuzzSummary?.verdicts ?? [],
      });
      const receipt = await signAttestation(subject, params.issuer);
      setState((s) => ({ ...s, phase: 'done', receipt }));
      return receipt;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: 'error', error: message }));
      throw err;
    }
  }, [state.asts, state.violations, state.fuzzSummary]);

  /** LLM remediation on demand — never automatic, so a suggestion only ever
   *  fetches (and costs money) when a human asks for one on one specific
   *  finding. Looks up the matching candidate by (podId, nodeId) already
   *  sitting in state from the last submit(). */
  const requestRemediation = useCallback(async (finding: PodFinding): Promise<string> => {
    let candidate = state.remediationCandidates.find(
      (c) => c.nodeId === finding.nodeId || (c.podId === finding.podId && c.nodeId === finding.nodeId),
    );
    if (!candidate) {
      const allNodes = state.asts.flatMap((a) => a.nodes);
      const allIdentifiers = state.asts.flatMap((a) => a.identifiers);
      const skeleton = buildAnonymizedSkeleton(allNodes, allIdentifiers, finding.nodeId);
      candidate = {
        podId: finding.podId,
        nodeId: finding.nodeId,
        anonymizedSkeleton: skeleton.text,
        reason: finding.detail || finding.title,
      };
    }
    return requestRemediationSuggestion(candidate, finding.title);
  }, [state.remediationCandidates, state.asts]);

  const reset = useCallback(() => setState(INITIAL_STATE), []);

  useEffect(() => {
    const workers = podWorkers.current;
    return () => {
      Object.values(workers).forEach((w) => w?.terminate());
      fuzzerClient.current?.dispose();
    };
  }, []);

  return { state, submit, runFuzz, attest, requestRemediation, reset };
}
