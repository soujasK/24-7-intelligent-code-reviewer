/**
 * Security Pod — isolates unsanitized-input / deserialization sinks.
 *
 * Taint tracing here is deliberately scope-local and name-based (does a
 * dangerous sink share an enclosing function with a known untrusted source,
 * or with any unvalidated parameter?) rather than a full dataflow solver.
 * That's a precision/cost tradeoff appropriate for a pre-LLM filtration
 * pass: false positives just mean a remediation candidate gets generated
 * (cheap, local); false negatives are backstopped by the fuzzer's RE/crash
 * telemetry and, ultimately, a human reviewer.
 */
import type {
  PodAnalyzeMessage,
  PodOutboundMessage,
  RemediationCandidate,
  SecurityFinding,
} from '../types/pods';
import { buildAnonymizedSkeleton } from './sanitizer';

declare const self: DedicatedWorkerGlobalScope;

const DANGEROUS_SINKS = new Set([
  'pickle.loads', 'pickle.load', 'yaml.load', 'marshal.loads',
  'eval', 'exec', 'os.system', 'subprocess.call', 'subprocess.Popen', 'subprocess.run',
]);

const UNTRUSTED_SOURCES = new Set([
  'input', 'sys.argv', 'os.environ', 'os.getenv',
  'request.args', 'request.form', 'request.json', 'request.data', 'flask.request',
]);

function post(message: PodOutboundMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<PodAnalyzeMessage>) => {
  const msg = event.data;
  if (msg.type !== 'ANALYZE') return;

  try {
    const nodeById = new Map(msg.nodes.map((n) => [n.node_id, n]));
    const callsByScope = new Map<number | null, typeof msg.callExpressions>();
    for (const call of msg.callExpressions) {
      const bucket = callsByScope.get(call.enclosing_function_id) ?? [];
      bucket.push(call);
      callsByScope.set(call.enclosing_function_id, bucket);
    }
    const paramsByScope = new Map<number | null, string[]>();
    for (const id of msg.identifiers) {
      if (id.kind !== 'parameter') continue;
      const bucket = paramsByScope.get(id.enclosing_function_id) ?? [];
      bucket.push(id.name);
      paramsByScope.set(id.enclosing_function_id, bucket);
    }

    const findings: SecurityFinding[] = [];
    const remediationCandidates: RemediationCandidate[] = [];

    for (const call of msg.callExpressions) {
      if (!DANGEROUS_SINKS.has(call.callee_name)) continue;
      const node = nodeById.get(call.node_id);
      if (!node) continue;

      const scopeCalls = callsByScope.get(call.enclosing_function_id) ?? [];
      const taintedBy = [...new Set(scopeCalls.filter((c) => UNTRUSTED_SOURCES.has(c.callee_name)).map((c) => c.callee_name))];
      const paramsInScope = paramsByScope.get(call.enclosing_function_id) ?? [];

      const severity = taintedBy.length > 0 ? 'error' : paramsInScope.length > 0 ? 'warn' : 'info';
      const requiresRemediation = severity !== 'info';

      findings.push({
        podId: 'security',
        nodeId: call.node_id,
        fileId: call.file_id,
        startRow: node.start_row,
        endRow: node.end_row,
        severity,
        title: `Unsanitized sink: ${call.callee_name}`,
        detail: taintedBy.length
          ? `Reachable from untrusted source(s) in the same function: ${taintedBy.join(', ')}`
          : paramsInScope.length
            ? `No traced untrusted call, but unvalidated parameter(s) in scope: ${paramsInScope.join(', ')}`
            : 'Sink call with no obvious local taint source — flagged for visibility only',
        requiresRemediation,
        sinkCallee: call.callee_name,
        taintedBy,
      });

      if (requiresRemediation) {
        const skeleton = buildAnonymizedSkeleton(msg.nodes, msg.identifiers, call.node_id);
        remediationCandidates.push({
          podId: 'security',
          nodeId: call.node_id,
          anonymizedSkeleton: skeleton.text,
          reason: `sink=${call.callee_name}; tainted_by=${taintedBy.join('|') || 'params'}`,
        });
      }
    }

    post({ type: 'RESULT', podId: 'security', submissionId: msg.submissionId, findings, remediationCandidates });
  } catch (err) {
    post({ type: 'ERROR', podId: 'security', submissionId: msg.submissionId, message: err instanceof Error ? err.message : String(err) });
  }
};
