/**
 * Privacy-preserving sanitization: re-renders a subtree of the flattened
 * AST as pseudo-code with every identifier replaced by a role-based
 * placeholder and every literal replaced by a type tag. Keywords,
 * operators, and punctuation are re-emitted verbatim — they're grammar,
 * not proprietary content.
 *
 * This is a plain module, not its own worker: it's pure CPU-bound
 * transform with no I/O, so it runs inline inside whichever pod worker
 * needs it (security-pod.worker.ts, complexity-pod.worker.ts) rather than
 * paying an extra postMessage round trip for zero isolation benefit — it's
 * already off the main thread by virtue of running inside the calling pod.
 *
 * Example: `cache_result = pickle.loads(request.get("payload"))` becomes
 * `var_1 = fn_1 ( fn_2 ( <STRING> ) )` before it's ever eligible to leave
 * the browser for an LLM remediation call.
 */
import type { AstNodeRow, IdentifierKind, IdentifierRow } from '../types/ast';

export interface AnonymizedSkeleton {
  text: string;
  /** placeholder -> original name, kept only in the calling pod's memory so
   *  a returned LLM remediation can be re-hydrated with real names locally.
   *  Never serialized, never sent anywhere. */
  placeholderToOriginal: Record<string, string>;
}

const LITERAL_NODE_TYPES = new Set([
  'string', 'string_literal', 'concatenated_string', 'integer', 'float',
  'number_literal', 'true', 'false', 'none', 'null', 'char_literal',
]);

const PLACEHOLDER_PREFIX: Record<IdentifierKind, string> = {
  variable: 'var',
  parameter: 'arg',
  function: 'fn',
  class: 'Cls',
  attribute: 'attr',
  import: 'mod',
};

/** Renders the subtree rooted at `rootNodeId` with identifiers/literals
 *  scrubbed. `nodes`/`identifiers` are the full submission's flattened
 *  rows — the function walks only the requested subtree, not everything. */
export function buildAnonymizedSkeleton(
  nodes: readonly AstNodeRow[],
  identifiers: readonly IdentifierRow[],
  rootNodeId: number,
): AnonymizedSkeleton {
  const nodeById = new Map(nodes.map((n) => [n.node_id, n]));
  const childrenByParent = new Map<number, AstNodeRow[]>();
  for (const n of nodes) {
    if (n.parent_id === null) continue;
    const bucket = childrenByParent.get(n.parent_id) ?? [];
    bucket.push(n);
    childrenByParent.set(n.parent_id, bucket);
  }
  childrenByParent.forEach((bucket) => bucket.sort((a, b) => a.child_index - b.child_index));
  const identifierByNodeId = new Map(identifiers.map((i) => [i.node_id, i]));

  const placeholderByOriginalName = new Map<string, string>();
  const placeholderToOriginal: Record<string, string> = {};
  const counters: Record<IdentifierKind, number> = {
    variable: 0, parameter: 0, function: 0, class: 0, attribute: 0, import: 0,
  };

  function placeholderFor(idRow: IdentifierRow): string {
    const cached = placeholderByOriginalName.get(idRow.name);
    if (cached) return cached;
    counters[idRow.kind] += 1;
    const placeholder = `${PLACEHOLDER_PREFIX[idRow.kind]}_${counters[idRow.kind]}`;
    placeholderByOriginalName.set(idRow.name, placeholder);
    placeholderToOriginal[placeholder] = idRow.name;
    return placeholder;
  }

  function render(nodeId: number): string {
    const node = nodeById.get(nodeId);
    if (!node) return '';
    const children = childrenByParent.get(nodeId) ?? [];
    if (children.length === 0) {
      const idRow = identifierByNodeId.get(nodeId);
      if (idRow) return placeholderFor(idRow);
      if (LITERAL_NODE_TYPES.has(node.node_type)) return `<${node.node_type.toUpperCase()}>`;
      return node.text; // leaf punctuation/keyword token, e.g. 'if', '(', '+='
    }
    return children.map((c) => render(c.node_id)).join(' ');
  }

  return { text: render(rootNodeId), placeholderToOriginal };
}
