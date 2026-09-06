/**
 * Shared AST domain types. These mirror the DuckDB-Wasm relational schema
 * 1:1 (see src/db/ast-schema.sql) so that rows can be bulk-loaded via
 * Apache Arrow without a lossy JS <-> SQL mapping step.
 */

export type SupportedLanguage = 'python' | 'cpp';

export interface SourceFileRow {
  file_id: number;
  path: string;
  language: SupportedLanguage;
  sha256: string;
  loc: number;
}

/** One row per tree-sitter AST node, flattened via a pre-order walk. */
export interface AstNodeRow {
  node_id: number;
  file_id: number;
  parent_id: number | null;
  node_type: string;
  depth: number;
  child_index: number;
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
  /** Raw source slice for this node. Never leaves the browser unsanitized. */
  text: string;
  is_named: boolean;
}

export type IdentifierKind = 'variable' | 'parameter' | 'function' | 'class' | 'attribute' | 'import';

export interface IdentifierRow {
  id: number;
  node_id: number;
  file_id: number;
  name: string;
  kind: IdentifierKind;
  enclosing_function_id: number | null;
}

export interface FunctionRow {
  id: number;
  node_id: number;
  file_id: number;
  name: string;
  start_row: number;
  end_row: number;
  param_count: number;
  parent_function_id: number | null;
}

export interface LoopRow {
  id: number;
  node_id: number;
  file_id: number;
  loop_type: 'for' | 'while' | 'for_range' | 'comprehension';
  nesting_depth: number;
  parent_loop_id: number | null;
  enclosing_function_id: number | null;
}

export interface CallExpressionRow {
  id: number;
  node_id: number;
  file_id: number;
  callee_name: string;
  arg_count: number;
  enclosing_function_id: number | null;
  enclosing_loop_id: number | null;
  enclosing_loop_depth: number;
}

export type EdgeType = 'AST_CHILD' | 'CALLS' | 'DATAFLOW';

export interface EdgeRow {
  id: number;
  src_node_id: number;
  dst_node_id: number;
  edge_type: EdgeType;
}

/** Result of parsing + flattening one file, ready for bulk insertion. */
export interface FlattenedAst {
  sourceFile: SourceFileRow;
  nodes: AstNodeRow[];
  identifiers: IdentifierRow[];
  functions: FunctionRow[];
  loops: LoopRow[];
  callExpressions: CallExpressionRow[];
  edges: EdgeRow[];
}
