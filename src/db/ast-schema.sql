-- ============================================================================
-- ast-schema.sql
-- In-memory relational schema for flattened tree-sitter ASTs, loaded into a
-- single DuckDB-Wasm instance shared across the tab's lifetime (one instance,
-- re-truncated per submission — see duckdb-client.ts).
--
-- Design notes:
--   * BIGINT surrogate keys are assigned client-side during flattening
--     (monotonic per-session counter), NOT via DuckDB sequences — this lets
--     the flattener build edges/foreign keys before any row is inserted,
--     which is required for single-pass Arrow bulk loads.
--   * No FOREIGN KEY constraints: DuckDB-Wasm bulk-loads via Arrow are
--     append-only per table and constraint checks would force row-by-row
--     validation, defeating the sub-10ms scan budget. Referential integrity
--     is guaranteed by construction in ast-flattener.ts instead.
--   * Everything is CREATE TABLE (not TEMP) because the whole database is
--     already :memory: — see duckdb-client.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_files (
    file_id   INTEGER PRIMARY KEY,
    path      VARCHAR NOT NULL,
    language  VARCHAR NOT NULL CHECK (language IN ('python', 'cpp')),
    sha256    VARCHAR NOT NULL,
    loc       INTEGER NOT NULL
);

-- One row per tree-sitter node (named + anonymous), pre-order flattened.
CREATE TABLE IF NOT EXISTS nodes (
    node_id     BIGINT PRIMARY KEY,
    file_id     INTEGER NOT NULL,
    parent_id   BIGINT,             -- NULL for the root node
    node_type   VARCHAR NOT NULL,   -- tree-sitter grammar node kind, e.g. 'call', 'for_statement'
    depth       INTEGER NOT NULL,
    child_index INTEGER NOT NULL,   -- ordinal position among siblings
    start_row   INTEGER NOT NULL,
    start_col   INTEGER NOT NULL,
    end_row     INTEGER NOT NULL,
    end_col     INTEGER NOT NULL,
    text        VARCHAR NOT NULL,
    is_named    BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS identifiers (
    id                     BIGINT PRIMARY KEY,
    node_id                BIGINT NOT NULL,
    file_id                INTEGER NOT NULL,
    name                   VARCHAR NOT NULL,
    kind                   VARCHAR NOT NULL CHECK (kind IN
                              ('variable', 'parameter', 'function', 'class', 'attribute', 'import')),
    enclosing_function_id  BIGINT
);

CREATE TABLE IF NOT EXISTS functions (
    id                   BIGINT PRIMARY KEY,
    node_id              BIGINT NOT NULL,
    file_id              INTEGER NOT NULL,
    name                 VARCHAR NOT NULL,
    start_row            INTEGER NOT NULL,
    end_row              INTEGER NOT NULL,
    param_count          INTEGER NOT NULL,
    parent_function_id   BIGINT   -- non-null for nested/closure functions
);

CREATE TABLE IF NOT EXISTS loops (
    id                     BIGINT PRIMARY KEY,
    node_id                BIGINT NOT NULL,
    file_id                INTEGER NOT NULL,
    loop_type              VARCHAR NOT NULL CHECK (loop_type IN
                              ('for', 'while', 'for_range', 'comprehension')),
    nesting_depth          INTEGER NOT NULL,   -- 1-indexed; outermost loop = 1
    parent_loop_id         BIGINT,
    enclosing_function_id  BIGINT
);

CREATE TABLE IF NOT EXISTS call_expressions (
    id                      BIGINT PRIMARY KEY,
    node_id                 BIGINT NOT NULL,
    file_id                 INTEGER NOT NULL,
    callee_name             VARCHAR NOT NULL,   -- dotted path where resolvable, e.g. 'requests.get'
    arg_count               INTEGER NOT NULL,
    enclosing_function_id   BIGINT,
    enclosing_loop_id       BIGINT,             -- innermost enclosing loop, if any
    enclosing_loop_depth    INTEGER NOT NULL DEFAULT 0
);

-- Generic AST/dataflow/call edges. AST_CHILD is redundant with nodes.parent_id
-- but is materialized here so recursive CTEs over edges don't need a UNION
-- with the nodes table when walking mixed edge types (e.g. call-graph +
-- structural blast-radius queries in csv-rule-compiler.ts).
CREATE TABLE IF NOT EXISTS edges (
    id           BIGINT PRIMARY KEY,
    src_node_id  BIGINT NOT NULL,
    dst_node_id  BIGINT NOT NULL,
    edge_type    VARCHAR NOT NULL CHECK (edge_type IN ('AST_CHILD', 'CALLS', 'DATAFLOW'))
);

-- Compiled policy rules (see csv-rule-compiler.ts) kept alongside the AST so
-- a scan run can be replayed/audited from DuckDB alone.
CREATE TABLE IF NOT EXISTS policy_rules (
    rule_id     INTEGER PRIMARY KEY,
    rule_type   VARCHAR NOT NULL,
    description VARCHAR NOT NULL,
    severity    VARCHAR NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
    sql_text    VARCHAR NOT NULL
);

-- Materialized scan results, one row per (rule, node) violation.
CREATE TABLE IF NOT EXISTS violations (
    id          BIGINT PRIMARY KEY,
    rule_id     INTEGER NOT NULL,
    node_id     BIGINT NOT NULL,
    file_id     INTEGER NOT NULL,
    severity    VARCHAR NOT NULL,
    message     VARCHAR NOT NULL,
    evidence    VARCHAR NOT NULL
);

-- ---- Indexes: the scanner is read-heavy and re-run on every keystroke debounce ----
CREATE INDEX IF NOT EXISTS idx_nodes_parent        ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_file_type      ON nodes(file_id, node_type);
CREATE INDEX IF NOT EXISTS idx_calls_callee         ON call_expressions(callee_name);
CREATE INDEX IF NOT EXISTS idx_calls_loop_depth     ON call_expressions(enclosing_loop_depth);
CREATE INDEX IF NOT EXISTS idx_loops_depth          ON loops(nesting_depth);
CREATE INDEX IF NOT EXISTS idx_edges_src            ON edges(src_node_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_dst            ON edges(dst_node_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_identifiers_name     ON identifiers(name);

-- ---- Convenience view: blast-radius fan-out per function ----
-- Counts distinct call-sites (across files) that CALL a given function,
-- used by the Architecture Pod to flag "breaking change" candidates before
-- any LLM involvement.
CREATE OR REPLACE VIEW v_function_fanout AS
SELECT
    f.id                AS function_id,
    f.name              AS function_name,
    f.file_id           AS defined_in_file_id,
    COUNT(DISTINCT ce.file_id) AS caller_file_count,
    COUNT(*)                   AS call_site_count
FROM functions f
JOIN call_expressions ce ON ce.callee_name = f.name
GROUP BY f.id, f.name, f.file_id;
