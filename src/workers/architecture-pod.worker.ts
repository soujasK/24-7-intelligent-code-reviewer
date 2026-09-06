/**
 * Architecture Pod — call-graph fan-out / blast-radius detection.
 *
 * Evaluates both cross-file caller blast-radius and high-density call-site
 * hubs to flag structural risk without requiring external LLMs.
 */
import type { ArchitectureFinding, PodAnalyzeMessage, PodOutboundMessage } from '../types/pods';

declare const self: DedicatedWorkerGlobalScope;

function post(message: PodOutboundMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<PodAnalyzeMessage>) => {
  const msg = event.data;
  if (msg.type !== 'ANALYZE') return;

  try {
    const nodeById = new Map(msg.nodes.map((n) => [n.node_id, n]));
    const callsByCallee = new Map<string, typeof msg.callExpressions>();
    for (const call of msg.callExpressions) {
      const bucket = callsByCallee.get(call.callee_name) ?? [];
      bucket.push(call);
      callsByCallee.set(call.callee_name, bucket);
    }

    const findings: ArchitectureFinding[] = [];
    for (const fn of msg.functions) {
      const callers = callsByCallee.get(fn.name) ?? [];
      const callerFileCount = new Set(callers.map((c) => c.file_id)).size;

      // Flag either cross-file fanout (>= 2 files) or high call-site coupling (>= 2 callers)
      if (callerFileCount < 2 && callers.length < 2) continue;

      const node = nodeById.get(fn.node_id);
      if (!node) continue;

      const isCrossFile = callerFileCount >= 2;
      const severity = callerFileCount >= 3 ? 'error' : isCrossFile ? 'warn' : 'info';

      findings.push({
        podId: 'architecture',
        nodeId: fn.node_id,
        fileId: fn.file_id,
        startRow: node.start_row,
        endRow: node.end_row,
        severity,
        title: isCrossFile
          ? `Cross-File Blast Radius: "${fn.name}"`
          : `High Call-Coupling Hub: "${fn.name}"`,
        detail: isCrossFile
          ? `Called from ${callerFileCount} distinct file(s) across ${callers.length} call site(s) — modifying this signature breaks cross-file callers.`
          : `Central hub called from ${callers.length} internal call site(s) — high coupling density.`,
        requiresRemediation: false,
        functionName: fn.name,
        callerFileCount,
        callSiteCount: callers.length,
      });
    }

    post({
      type: 'RESULT',
      podId: 'architecture',
      submissionId: msg.submissionId,
      findings,
      remediationCandidates: [],
    });
  } catch (err) {
    post({
      type: 'ERROR',
      podId: 'architecture',
      submissionId: msg.submissionId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
