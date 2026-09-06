/**
 * Flattens a tree-sitter Tree into the relational rows defined in
 * src/types/ast.ts / src/db/ast-schema.sql, in a single iterative
 * pre-order/post-order cursor walk (no recursion — deeply nested
 * generated code shouldn't blow the JS call stack).
 */
import type Parser from 'web-tree-sitter';
import type {
  AstNodeRow,
  CallExpressionRow,
  EdgeRow,
  FlattenedAst,
  FunctionRow,
  IdentifierKind,
  IdentifierRow,
  LoopRow,
  SourceFileRow,
  SupportedLanguage,
} from '../types/ast';

// ---------------------------------------------------------------------------
// Per-language grammar node-type tables. Extend these when adding a language.
// ---------------------------------------------------------------------------
interface LanguageGrammarConfig {
  functionTypes: ReadonlySet<string>;
  classTypes: ReadonlySet<string>;
  loopTypes: ReadonlyMap<string, LoopRow['loop_type']>;
  callTypes: ReadonlySet<string>;
  identifierTypes: ReadonlySet<string>;
  parameterContainerTypes: ReadonlySet<string>;
  importTypes: ReadonlySet<string>;
}

const GRAMMAR_CONFIG: Record<SupportedLanguage, LanguageGrammarConfig> = {
  python: {
    functionTypes: new Set(['function_definition']),
    classTypes: new Set(['class_definition']),
    loopTypes: new Map([
      ['for_statement', 'for'],
      ['while_statement', 'while'],
      ['list_comprehension', 'comprehension'],
      ['dictionary_comprehension', 'comprehension'],
      ['set_comprehension', 'comprehension'],
      ['generator_expression', 'comprehension'],
    ]),
    callTypes: new Set(['call']),
    identifierTypes: new Set(['identifier']),
    parameterContainerTypes: new Set(['parameters', 'lambda_parameters']),
    importTypes: new Set(['import_statement', 'import_from_statement']),
  },
  cpp: {
    functionTypes: new Set(['function_definition']),
    classTypes: new Set(['class_specifier', 'struct_specifier']),
    loopTypes: new Map([
      ['for_statement', 'for'],
      ['for_range_loop', 'for_range'],
      ['while_statement', 'while'],
    ]),
    callTypes: new Set(['call_expression']),
    identifierTypes: new Set(['identifier', 'field_identifier']),
    parameterContainerTypes: new Set(['parameter_list', 'parameter_declaration']),
    importTypes: new Set(['preproc_include']),
  },
};

function classifyIdentifier(
  nodeType: string,
  fieldName: string | null,
  parentType: string | null,
  cfg: LanguageGrammarConfig,
): IdentifierKind {
  if (fieldName === 'name' && parentType && cfg.functionTypes.has(parentType)) return 'function';
  if (fieldName === 'name' && parentType && cfg.classTypes.has(parentType)) return 'class';
  if (parentType && cfg.parameterContainerTypes.has(parentType)) return 'parameter';
  if (parentType && cfg.importTypes.has(parentType)) return 'import';
  if (nodeType === 'field_identifier' || fieldName === 'attribute') return 'attribute';
  return 'variable';
}

/** Monotonic surrogate-key allocator, shared across every file in one
 *  submission so cross-file edges (call graph, blast radius) use globally
 *  unique ids. Call reset() between submissions (mirrors resetForNewSubmission
 *  in duckdb-client.ts). */
export class SurrogateIdAllocator {
  private counters: Record<'file' | 'node' | 'identifier' | 'function' | 'loop' | 'call' | 'edge', number> = {
    file: 0,
    node: 0,
    identifier: 0,
    function: 0,
    loop: 0,
    call: 0,
    edge: 0,
  };

  next(key: keyof SurrogateIdAllocator['counters']): number {
    return this.counters[key]++;
  }

  reset(): void {
    (Object.keys(this.counters) as Array<keyof SurrogateIdAllocator['counters']>).forEach((k) => {
      this.counters[k] = 0;
    });
  }
}

/** `noUncheckedIndexedAccess` types every array index read as `T | undefined`
 *  (even right after a `.length` guard, which doesn't narrow it) — these two
 *  helpers centralize the stack-top read/increment pattern used throughout
 *  the cursor walk below instead of asserting non-null at every call site. */
function peek<T>(stack: readonly T[]): T | undefined {
  return stack[stack.length - 1];
}
function incrementTop(stack: number[]): void {
  const topIndex = stack.length - 1;
  stack[topIndex] = (stack[topIndex] ?? 0) + 1;
}

interface ContextFrame {
  /** Surrogate node_id of the AST node that pushed this frame. */
  ownerNodeId: number;
  kind: 'function' | 'loop';
  contextId: number;
  loopDepth: number; // only meaningful for kind === 'loop'
}

export interface FlattenFileInput {
  tree: Parser.Tree;
  path: string;
  language: SupportedLanguage;
  sourceSha256: string;
  loc: number;
}

export function flattenFile(input: FlattenFileInput, allocator: SurrogateIdAllocator): FlattenedAst {
  const cfg = GRAMMAR_CONFIG[input.language];
  const fileId = allocator.next('file');

  const sourceFile: SourceFileRow = {
    file_id: fileId,
    path: input.path,
    language: input.language,
    sha256: input.sourceSha256,
    loc: input.loc,
  };

  const nodes: AstNodeRow[] = [];
  const identifiers: IdentifierRow[] = [];
  const functions: FunctionRow[] = [];
  const loops: LoopRow[] = [];
  const callExpressions: CallExpressionRow[] = [];
  const edges: EdgeRow[] = [];

  const nodeIdStack: number[] = []; // ancestor surrogate ids, top = immediate parent
  const nodeTypeStack: string[] = []; // parallel stack of ancestor grammar types
  const childIndexStack: number[] = [0];
  const contextStack: ContextFrame[] = [];

  const enclosingFunctionId = (): number | null => {
    for (let i = contextStack.length - 1; i >= 0; i--) {
      const frame = contextStack[i];
      if (frame && frame.kind === 'function') return frame.contextId;
    }
    return null;
  };
  const enclosingLoop = (): { id: number; depth: number } | null => {
    for (let i = contextStack.length - 1; i >= 0; i--) {
      const frame = contextStack[i];
      if (frame && frame.kind === 'loop') return { id: frame.contextId, depth: frame.loopDepth };
    }
    return null;
  };

  const cursor = input.tree.walk();
  let depth = 0;

  const visit = (): void => {
    const node = cursor.currentNode;
    const fieldName = cursor.currentFieldName ?? null;
    const parentId = peek(nodeIdStack) ?? null;
    const parentType = peek(nodeTypeStack) ?? null;
    const assignedId = allocator.next('node');
    const childIndex = peek(childIndexStack) ?? 0;

    nodes.push({
      node_id: assignedId,
      file_id: fileId,
      parent_id: parentId,
      node_type: node.type,
      depth,
      child_index: childIndex,
      start_row: node.startPosition.row,
      start_col: node.startPosition.column,
      end_row: node.endPosition.row,
      end_col: node.endPosition.column,
      text: node.text,
      is_named: node.isNamed,
    });

    if (parentId !== null) {
      edges.push({
        id: allocator.next('edge'),
        src_node_id: parentId,
        dst_node_id: assignedId,
        edge_type: 'AST_CHILD',
      });
    }

    // --- derived-table extraction -------------------------------------
    if (cfg.identifierTypes.has(node.type)) {
      identifiers.push({
        id: allocator.next('identifier'),
        node_id: assignedId,
        file_id: fileId,
        name: node.text,
        kind: classifyIdentifier(node.type, fieldName, parentType, cfg),
        enclosing_function_id: enclosingFunctionId(),
      });
    }

    let pushedFrame: ContextFrame | null = null;

    if (cfg.functionTypes.has(node.type)) {
      const funcId = allocator.next('function');
      const nameNode = node.childForFieldName('name');
      const paramsNode = node.childForFieldName('parameters');
      functions.push({
        id: funcId,
        node_id: assignedId,
        file_id: fileId,
        name: nameNode?.text ?? '<anonymous>',
        start_row: node.startPosition.row,
        end_row: node.endPosition.row,
        param_count: paramsNode?.namedChildCount ?? 0,
        parent_function_id: enclosingFunctionId(),
      });
      pushedFrame = { ownerNodeId: assignedId, kind: 'function', contextId: funcId, loopDepth: 0 };
    } else if (cfg.loopTypes.has(node.type)) {
      const loopId = allocator.next('loop');
      const parentLoop = enclosingLoop();
      const nestingDepth = (parentLoop?.depth ?? 0) + 1;
      loops.push({
        id: loopId,
        node_id: assignedId,
        file_id: fileId,
        loop_type: cfg.loopTypes.get(node.type)!,
        nesting_depth: nestingDepth,
        parent_loop_id: parentLoop?.id ?? null,
        enclosing_function_id: enclosingFunctionId(),
      });
      pushedFrame = { ownerNodeId: assignedId, kind: 'loop', contextId: loopId, loopDepth: nestingDepth };
    }

    if (cfg.callTypes.has(node.type)) {
      const calleeNode = node.childForFieldName('function');
      const argsNode = node.childForFieldName('arguments');
      const loop = enclosingLoop();
      callExpressions.push({
        id: allocator.next('call'),
        node_id: assignedId,
        file_id: fileId,
        callee_name: calleeNode?.text ?? '<unknown>',
        arg_count: argsNode?.namedChildCount ?? 0,
        enclosing_function_id: enclosingFunctionId(),
        enclosing_loop_id: loop?.id ?? null,
        enclosing_loop_depth: loop?.depth ?? 0,
      });
    }

    if (pushedFrame) contextStack.push(pushedFrame);
    nodeIdStack.push(assignedId);
    nodeTypeStack.push(node.type);
  };

  const closeCurrent = (): void => {
    const closedNodeId = nodeIdStack.pop();
    nodeTypeStack.pop();
    if (closedNodeId === undefined) return;
    while (peek(contextStack)?.ownerNodeId === closedNodeId) {
      contextStack.pop();
    }
  };

  visit(); // root
  let reachedRoot = false;
  while (!reachedRoot) {
    if (cursor.gotoFirstChild()) {
      depth += 1;
      childIndexStack.push(0);
      visit();
      continue;
    }
    if (cursor.gotoNextSibling()) {
      incrementTop(childIndexStack);
      closeCurrent(); // the sibling we just left is fully processed
      visit();
      continue;
    }
    let retracing = true;
    while (retracing) {
      if (!cursor.gotoParent()) {
        retracing = false;
        reachedRoot = true;
        closeCurrent();
      } else {
        depth -= 1;
        childIndexStack.pop();
        closeCurrent();
        if (cursor.gotoNextSibling()) {
          incrementTop(childIndexStack);
          retracing = false;
          visit();
        }
      }
    }
  }

  return { sourceFile, nodes, identifiers, functions, loops, callExpressions, edges };
}

/** Cross-file pass: resolves call_expressions.callee_name against
 *  functions.name to materialize CALLS edges for the call graph / blast
 *  radius view. Deliberately simple (name match, no scope/overload
 *  resolution) — sufficient for flagging fan-out, not for a linker. */
export function linkCallGraphEdges(
  functions: readonly FunctionRow[],
  callExpressions: readonly CallExpressionRow[],
  allocator: SurrogateIdAllocator,
): EdgeRow[] {
  const byName = new Map<string, number[]>();
  for (const fn of functions) {
    const bucket = byName.get(fn.name);
    if (bucket) bucket.push(fn.node_id);
    else byName.set(fn.name, [fn.node_id]);
  }

  const edges: EdgeRow[] = [];
  for (const call of callExpressions) {
    // Strip a leading "self." / "this->" / module prefix for a best-effort match.
    const shortName = call.callee_name.split(/\.|->/).pop() ?? call.callee_name;
    const targets = byName.get(call.callee_name) ?? byName.get(shortName);
    if (!targets) continue;
    for (const targetNodeId of targets) {
      edges.push({
        id: allocator.next('edge'),
        src_node_id: call.node_id,
        dst_node_id: targetNodeId,
        edge_type: 'CALLS',
      });
    }
  }
  return edges;
}
