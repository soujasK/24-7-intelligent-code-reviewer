/**
 * Complexity Pod — loop-nesting depth and O(N^k) candidate detection.
 *
 * Containment is span-based (row/col ranges from the `nodes` table), not
 * loop-id equality, so a call two levels of nesting deeper than the loop
 * being evaluated still counts against it — mirrors the SQL technique in
 * src/policy/rule-templates.ts's compileNestedLoopComplexity, reimplemented
 * in plain JS here since this pod doesn't hold a DuckDB connection.
 */
import type { AstNodeRow } from '../types/ast';
import type {
  PodAnalyzeMessage,
  PodOutboundMessage,
  ComplexityFinding,
  RemediationCandidate,
} from '../types/pods';
import { buildAnonymizedSkeleton } from './sanitizer';

declare const self: DedicatedWorkerGlobalScope;

function post(message: PodOutboundMessage): void {
  self.postMessage(message);
}

function isContained(inner: AstNodeRow, outer: AstNodeRow): boolean {
  const startsAfterOrAt = inner.start_row > outer.start_row || (inner.start_row === outer.start_row && inner.start_col >= outer.start_col);
  const endsBeforeOrAt = inner.end_row < outer.end_row || (inner.end_row === outer.end_row && inner.end_col <= outer.end_col);
  return startsAfterOrAt && endsBeforeOrAt;
}

self.onmessage = (event: MessageEvent<PodAnalyzeMessage>) => {
  const msg = event.data;
  if (msg.type !== 'ANALYZE') return;

  try {
    const nodeById = new Map(msg.nodes.map((n) => [n.node_id, n]));
    const findings: ComplexityFinding[] = [];
    const remediationCandidates: RemediationCandidate[] = [];

    for (const loop of msg.loops) {
      if (loop.nesting_depth < 2) continue; // a single loop is O(N) — not a candidate on its own
      const loopNode = nodeById.get(loop.node_id);
      if (!loopNode) continue;

      const containedCalls = msg.callExpressions.filter((c) => {
        if (c.file_id !== loop.file_id) return false;
        const callNode = nodeById.get(c.node_id);
        return callNode ? isContained(callNode, loopNode) : false;
      });
      if (containedCalls.length === 0) continue;

      const calleeNames = [...new Set(containedCalls.map((c) => c.callee_name))];
      const severity = loop.nesting_depth >= 3 ? 'error' : 'warn';
      const requiresRemediation = severity === 'error';

      findings.push({
        podId: 'complexity',
        nodeId: loop.node_id,
        fileId: loop.file_id,
        startRow: loopNode.start_row,
        endRow: loopNode.end_row,
        severity,
        title: `O(N^${loop.nesting_depth}) candidate: nested ${loop.loop_type} loop with call(s)`,
        detail: `Nesting depth ${loop.nesting_depth}; calls in body: ${calleeNames.join(', ')}`,
        requiresRemediation,
        nestingDepth: loop.nesting_depth,
        estimatedComplexityClass: `O(N^${loop.nesting_depth})`,
        callsInBody: calleeNames,
      });

      if (requiresRemediation) {
        const skeleton = buildAnonymizedSkeleton(msg.nodes, msg.identifiers, loop.node_id);
        remediationCandidates.push({
          podId: 'complexity',
          nodeId: loop.node_id,
          anonymizedSkeleton: skeleton.text,
          reason: `nesting_depth=${loop.nesting_depth}; calls=${calleeNames.join('|')}`,
        });
      }
    }

    post({ type: 'RESULT', podId: 'complexity', submissionId: msg.submissionId, findings, remediationCandidates });
  } catch (err) {
    post({ type: 'ERROR', podId: 'complexity', submissionId: msg.submissionId, message: err instanceof Error ? err.message : String(err) });
  }
};
