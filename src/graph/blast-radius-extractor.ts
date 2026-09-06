import type { FlattenedAst, FunctionRow } from '../types/ast';
import type { PolicyViolation } from '../types/rules';
import type { PodFinding } from '../types/pods';
import type * as d3 from 'd3';

export type GraphNodeKind = 'file' | 'function' | 'external_call';

export interface NodeViolationInfo {
  message: string;
  severity: 'info' | 'warn' | 'error';
  source: string;
}

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string; // "file-0", "func-12", "ext-eval"
  numericId: number;
  name: string;
  kind: GraphNodeKind;
  fileId: number;
  filePath: string;
  language?: string;
  startRow?: number;
  endRow?: number;
  paramCount?: number;
  loc?: number;
  callCount?: number; // fanout / incoming calls
  hasViolation: boolean;
  severity?: 'info' | 'warn' | 'error';
  violations: NodeViolationInfo[];
  // Blast radius runtime flags
  isIsolated?: boolean;
  isRootSelected?: boolean;
  isDownstream?: boolean;
  isUpstream?: boolean;
  depthFromSelected?: number;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  kind: 'CONTAINS' | 'CALLS' | 'EXTERNAL';
  isCrossFile: boolean;
  hasViolation: boolean;
  isHighlighted?: boolean;
}

export interface BlastRadiusGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  summary: {
    totalFiles: number;
    totalFunctions: number;
    totalCalls: number;
    totalViolations: number;
  };
}

export interface BlastRadiusImpactSummary {
  selectedNode: GraphNode;
  impactedFunctionsCount: number;
  impactedFilesCount: number;
  crossFileEdgesCount: number;
  highestSeverity: 'info' | 'warn' | 'error' | null;
  downstreamNodes: GraphNode[];
  upstreamNodes: GraphNode[];
  pathViolations: NodeViolationInfo[];
}

/**
 * Extracts a complete graph of files, functions, call-chains, and external sinks
 * with all active security violations mapped to specific nodes.
 */
export function extractBlastRadiusGraph(
  asts: readonly FlattenedAst[],
  violations: readonly PolicyViolation[],
  findings: readonly PodFinding[],
): BlastRadiusGraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeMap = new Map<string, GraphNode>();

  const fileMap = new Map<number, { path: string; language: string; loc: number }>();
  for (const ast of asts) {
    fileMap.set(ast.sourceFile.file_id, {
      path: ast.sourceFile.path,
      language: ast.sourceFile.language,
      loc: ast.sourceFile.loc,
    });
  }

  // 1. Create File Nodes
  for (const ast of asts) {
    const fileId = ast.sourceFile.file_id;
    const nodeIdStr = `file-${fileId}`;

    const fileViolations: NodeViolationInfo[] = [];

    const fileNode: GraphNode = {
      id: nodeIdStr,
      numericId: fileId,
      name: ast.sourceFile.path.split('/').pop() ?? ast.sourceFile.path,
      kind: 'file',
      fileId,
      filePath: ast.sourceFile.path,
      language: ast.sourceFile.language,
      loc: ast.sourceFile.loc,
      hasViolation: false,
      violations: fileViolations,
    };

    nodes.push(fileNode);
    nodeMap.set(nodeIdStr, fileNode);
  }

  // Helper to test if a node/line spans a function
  const allFunctions = asts.flatMap((a) => a.functions);
  const functionNodeMap = new Map<number, FunctionRow>();
  const functionByName = new Map<string, FunctionRow[]>();

  for (const fn of allFunctions) {
    functionNodeMap.set(fn.node_id, fn);
    const existing = functionByName.get(fn.name) ?? [];
    existing.push(fn);
    functionByName.set(fn.name, existing);
  }

  // 2. Create Function Nodes & CONTAINS links
  for (const ast of asts) {
    const fileId = ast.sourceFile.file_id;
    const filePath = ast.sourceFile.path;

    for (const fn of ast.functions) {
      const funcNodeIdStr = `func-${fn.node_id}`;

      const fnNode: GraphNode = {
        id: funcNodeIdStr,
        numericId: fn.node_id,
        name: `${fn.name}()`,
        kind: 'function',
        fileId,
        filePath,
        language: ast.sourceFile.language,
        startRow: fn.start_row,
        endRow: fn.end_row,
        paramCount: fn.param_count,
        hasViolation: false,
        violations: [],
      };

      nodes.push(fnNode);
      nodeMap.set(funcNodeIdStr, fnNode);

      // Link: File CONTAINS Function
      links.push({
        id: `contains-file-${fileId}-to-${funcNodeIdStr}`,
        source: `file-${fileId}`,
        target: funcNodeIdStr,
        kind: 'CONTAINS',
        isCrossFile: false,
        hasViolation: false,
      });
    }
  }

  // 3. Map Violations and Pod Findings to Nodes
  for (const v of violations) {
    const violationInfo: NodeViolationInfo = {
      message: `${v.ruleType}: ${v.message}`,
      severity: v.severity,
      source: `Rule #${v.ruleId}`,
    };

    // Try finding enclosing function
    const enclosingFunc = allFunctions.find(
      (fn) => fn.file_id === v.fileId && v.startRow >= fn.start_row && v.startRow <= fn.end_row,
    );

    if (enclosingFunc) {
      const targetNode = nodeMap.get(`func-${enclosingFunc.node_id}`);
      if (targetNode) {
        targetNode.hasViolation = true;
        targetNode.violations.push(violationInfo);
        if (!targetNode.severity || v.severity === 'error' || (v.severity === 'warn' && targetNode.severity === 'info')) {
          targetNode.severity = v.severity;
        }
      }
    } else {
      const fileNode = nodeMap.get(`file-${v.fileId}`);
      if (fileNode) {
        fileNode.hasViolation = true;
        fileNode.violations.push(violationInfo);
        if (!fileNode.severity || v.severity === 'error') {
          fileNode.severity = v.severity;
        }
      }
    }
  }

  for (const f of findings) {
    const findingInfo: NodeViolationInfo = {
      message: `[${f.podId.toUpperCase()}] ${f.title}: ${f.detail}`,
      severity: f.severity,
      source: `${f.podId} pod`,
    };

    const enclosingFunc = allFunctions.find(
      (fn) => f.startRow >= fn.start_row && f.startRow <= fn.end_row,
    );

    if (enclosingFunc) {
      const targetNode = nodeMap.get(`func-${enclosingFunc.node_id}`);
      if (targetNode) {
        targetNode.hasViolation = true;
        targetNode.violations.push(findingInfo);
        if (!targetNode.severity || f.severity === 'error' || (f.severity === 'warn' && targetNode.severity === 'info')) {
          targetNode.severity = f.severity;
        }
      }
    }
  }

  // 4. Create CALLS Edges and External Sink Nodes
  const createdExternalNodes = new Set<string>();

  for (const ast of asts) {
    const fileId = ast.sourceFile.file_id;

    for (const call of ast.callExpressions) {
      // Find caller function
      let callerNodeId: string;
      if (call.enclosing_function_id) {
        const callerFn = functionNodeMap.get(call.enclosing_function_id);
        callerNodeId = callerFn ? `func-${callerFn.node_id}` : `file-${fileId}`;
      } else {
        callerNodeId = `file-${fileId}`;
      }

      const shortCallee = call.callee_name.split(/\.|->/).pop() ?? call.callee_name;
      const matchingFunctions = functionByName.get(call.callee_name) ?? functionByName.get(shortCallee);

      if (matchingFunctions && matchingFunctions.length > 0) {
        for (const targetFn of matchingFunctions) {
          const targetNodeId = `func-${targetFn.node_id}`;
          const isCrossFile = targetFn.file_id !== fileId;
          const linkId = `call-${callerNodeId}-to-${targetNodeId}`;

          const callerNode = nodeMap.get(callerNodeId);
          const targetNode = nodeMap.get(targetNodeId);

          if (targetNode) {
            targetNode.callCount = (targetNode.callCount ?? 0) + 1;
          }

          links.push({
            id: linkId,
            source: callerNodeId,
            target: targetNodeId,
            kind: 'CALLS',
            isCrossFile,
            hasViolation: Boolean(callerNode?.hasViolation || targetNode?.hasViolation),
          });
        }
      } else {
        // High-interest external sink (e.g. eval, pickle, abs, etc.)
        const extName = call.callee_name;
        const extNodeId = `ext-${extName}`;

        if (!createdExternalNodes.has(extNodeId)) {
          createdExternalNodes.add(extNodeId);
          const isKnownSink = /^(eval|exec|pickle|os\.system|subprocess|yaml\.load|open|read|write|SafeAbs|abs)$/i.test(extName);

          const extNode: GraphNode = {
            id: extNodeId,
            numericId: -1,
            name: extName,
            kind: 'external_call',
            fileId: -1,
            filePath: 'external',
            hasViolation: isKnownSink && ['eval', 'exec', 'pickle', 'os.system'].includes(extName),
            severity: isKnownSink ? 'warn' : undefined,
            violations: isKnownSink
              ? [{ message: `External Sink: ${extName}`, severity: 'warn', source: 'Sink Monitor' }]
              : [],
          };
          nodes.push(extNode);
          nodeMap.set(extNodeId, extNode);
        }

        const callerNode = nodeMap.get(callerNodeId);
        links.push({
          id: `extcall-${callerNodeId}-to-${extNodeId}`,
          source: callerNodeId,
          target: extNodeId,
          kind: 'EXTERNAL',
          isCrossFile: true,
          hasViolation: Boolean(callerNode?.hasViolation),
        });
      }
    }
  }

  return {
    nodes,
    links,
    summary: {
      totalFiles: asts.length,
      totalFunctions: allFunctions.length,
      totalCalls: links.filter((l) => l.kind === 'CALLS' || l.kind === 'EXTERNAL').length,
      totalViolations: violations.length + findings.length,
    },
  };
}

/**
 * Calculates the downstream and upstream blast radius of a focal node via Breadth-First Search (BFS).
 */
export function computeBlastRadiusIsolation(
  selectedNodeId: string,
  nodes: GraphNode[],
  links: GraphLink[],
): {
  isolatedNodes: GraphNode[];
  isolatedLinks: GraphLink[];
  summary: BlastRadiusImpactSummary | null;
} {
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  if (!selectedNode) {
    return {
      isolatedNodes: nodes.map((n) => ({ ...n, isIsolated: false, isRootSelected: false, isDownstream: false, isUpstream: false })),
      isolatedLinks: links.map((l) => ({ ...l, isHighlighted: false })),
      summary: null,
    };
  }

  // Build adjacency list for directional traversals
  const downstreamAdj = new Map<string, Array<{ targetId: string; link: GraphLink }>>();
  const upstreamAdj = new Map<string, Array<{ sourceId: string; link: GraphLink }>>();

  for (const l of links) {
    const sId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const tId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;

    const outList = downstreamAdj.get(sId) ?? [];
    outList.push({ targetId: tId, link: l });
    downstreamAdj.set(sId, outList);

    const inList = upstreamAdj.get(tId) ?? [];
    inList.push({ sourceId: sId, link: l });
    upstreamAdj.set(tId, inList);
  }

  // BFS Downstream
  const downstreamSet = new Set<string>();
  const highlightedLinkIds = new Set<string>();
  const queueDown: Array<{ id: string; depth: number }> = [{ id: selectedNodeId, depth: 0 }];

  while (queueDown.length > 0) {
    const current = queueDown.shift()!;
    const neighbors = downstreamAdj.get(current.id) ?? [];
    for (const { targetId, link } of neighbors) {
      if (!downstreamSet.has(targetId) && targetId !== selectedNodeId) {
        downstreamSet.add(targetId);
        highlightedLinkIds.add(link.id);
        queueDown.push({ id: targetId, depth: current.depth + 1 });
      } else if (downstreamSet.has(targetId)) {
        highlightedLinkIds.add(link.id);
      }
    }
  }

  // BFS Upstream
  const upstreamSet = new Set<string>();
  const queueUp: Array<{ id: string; depth: number }> = [{ id: selectedNodeId, depth: 0 }];

  while (queueUp.length > 0) {
    const current = queueUp.shift()!;
    const callers = upstreamAdj.get(current.id) ?? [];
    for (const { sourceId, link } of callers) {
      if (!upstreamSet.has(sourceId) && sourceId !== selectedNodeId) {
        upstreamSet.add(sourceId);
        highlightedLinkIds.add(link.id);
        queueUp.push({ id: sourceId, depth: current.depth + 1 });
      } else if (upstreamSet.has(sourceId)) {
        highlightedLinkIds.add(link.id);
      }
    }
  }

  const allReachableIds = new Set([selectedNodeId, ...downstreamSet, ...upstreamSet]);

  const downstreamNodes: GraphNode[] = [];
  const upstreamNodes: GraphNode[] = [];
  const pathViolations: NodeViolationInfo[] = [...selectedNode.violations];
  const impactedFiles = new Set<number>();
  if (selectedNode.fileId >= 0) impactedFiles.add(selectedNode.fileId);

  let crossFileCount = 0;
  let highestSev: 'info' | 'warn' | 'error' | null = selectedNode.severity ?? null;

  const isolatedNodes = nodes.map((n) => {
    const isRoot = n.id === selectedNodeId;
    const isDown = downstreamSet.has(n.id);
    const isUp = upstreamSet.has(n.id);
    const isIso = allReachableIds.has(n.id);

    if (isDown) downstreamNodes.push(n);
    if (isUp) upstreamNodes.push(n);

    if (isIso && n.fileId >= 0) impactedFiles.add(n.fileId);
    if (isIso && n.violations.length > 0 && !isRoot) {
      pathViolations.push(...n.violations);
    }
    if (isIso && n.severity) {
      if (n.severity === 'error') highestSev = 'error';
      else if (n.severity === 'warn' && highestSev !== 'error') highestSev = 'warn';
      else if (!highestSev) highestSev = n.severity;
    }

    return {
      ...n,
      isIsolated: isIso,
      isRootSelected: isRoot,
      isDownstream: isDown,
      isUpstream: isUp,
    };
  });

  const isolatedLinks = links.map((l) => {
    const isHigh = highlightedLinkIds.has(l.id);
    if (isHigh && l.isCrossFile) crossFileCount++;
    return {
      ...l,
      isHighlighted: isHigh,
    };
  });

  const summary: BlastRadiusImpactSummary = {
    selectedNode,
    impactedFunctionsCount: downstreamNodes.filter((n) => n.kind === 'function').length,
    impactedFilesCount: impactedFiles.size,
    crossFileEdgesCount: crossFileCount,
    highestSeverity: highestSev,
    downstreamNodes,
    upstreamNodes,
    pathViolations,
  };

  return { isolatedNodes, isolatedLinks, summary };
}
