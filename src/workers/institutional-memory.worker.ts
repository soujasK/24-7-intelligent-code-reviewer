/**
 * Closed-loop institutional memory: when a developer rejects or edits an AI
 * remediation, distills that correction into a new `<id, type, description>`
 * policy rule.
 *
 * Deliberately offline/pure in this worker — no Firestore write happens
 * here. Distillation only needs the two text snippets already in memory
 * (what the AI suggested, what the developer wrote instead); committing
 * the result is the caller's job via
 * src/firebase/rules-repository.ts#commitDistilledRule, which owns the one
 * Firebase App instance and the id-allocation transaction. Keeping this
 * worker Firebase-free also means it distills from anonymized skeletons
 * without ever needing network access itself.
 *
 * The heuristic below (regex over two code snippets) is the $0 fallback.
 * A production build would route this through a Cloud Function that calls
 * an LLM with a *prompt template*, not a client-held API key — see the
 * comment on callRemediationDistillerFunction() in rules-repository.ts.
 */
import type { DistillError, DistilledRule, DistillRequest, DistillResult } from '../types/institutional-memory';

declare const self: DedicatedWorkerGlobalScope;

const DOTTED_CALL_PATTERN = /\b[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+\b/;
const BARE_CALL_PATTERN = /\b([A-Za-z_][\w]*)\s*\(/;

function extractPrimaryCallToken(snippet: string): string | null {
  const dotted = snippet.match(DOTTED_CALL_PATTERN);
  if (dotted) return dotted[0] ?? null;
  const bare = snippet.match(BARE_CALL_PATTERN);
  return bare ? (bare[1] ?? null) : null;
}

/** Extracts a PascalCase identifier (a strong signal of "our internal
 *  SomeWrapper class") from the developer's replacement, preferring it
 *  over a plain call token since it's the more reusable policy anchor. */
function extractInternalApiName(snippet: string): string | null {
  const pascalCase = snippet.match(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][a-z0-9]*)+\b/);
  if (pascalCase) return pascalCase[0] ?? null;
  return extractPrimaryCallToken(snippet);
}

function distill(req: DistillRequest): DistilledRule {
  const rejectedToken = extractPrimaryCallToken(req.rejectedRemediationText) ?? extractPrimaryCallToken(req.originalFindingSkeleton);
  const replacementToken = extractInternalApiName(req.developerReplacementText);

  if (rejectedToken && replacementToken) {
    return {
      type: 'FORBIDDEN_CALL',
      description: `Use our internal \`${replacementToken}\` instead of \`${rejectedToken}\` — developer-corrected remediation.`,
    };
  }
  if (replacementToken) {
    return {
      type: 'GENERIC_KEYWORD_MATCH',
      description: `Prefer \`${replacementToken}\` in this context — developer-corrected remediation (original suggestion rejected).`,
    };
  }
  return {
    type: req.originatingPodHint ?? 'GENERIC_KEYWORD_MATCH',
    description: `Developer rejected an AI remediation without a clearly extractable replacement API; review context: ${req.developerReplacementText.slice(0, 160)}`,
  };
}

self.onmessage = (event: MessageEvent<DistillRequest>) => {
  const req = event.data;
  if (req.type !== 'DISTILL') return;
  try {
    const rule = distill(req);
    self.postMessage({ type: 'RESULT', requestId: req.requestId, rule } satisfies DistillResult);
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      requestId: req.requestId,
      message: err instanceof Error ? err.message : String(err),
    } satisfies DistillError);
  }
};
