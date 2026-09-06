import { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import {
  extractBlastRadiusGraph,
  computeBlastRadiusIsolation,
  type GraphNode,
  type GraphLink,
  type BlastRadiusImpactSummary,
} from '../../graph/blast-radius-extractor';
import type { FlattenedAst } from '../../types/ast';
import type { PolicyViolation } from '../../types/rules';
import type { PodFinding } from '../../types/pods';
import {
  Network,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Focus,
  X,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';

interface BlastRadiusGraphProps {
  asts: readonly FlattenedAst[];
  violations: readonly PolicyViolation[];
  findings: readonly PodFinding[];
  focusedFilePath?: string | null;
  onSelectNodeInEditor?: (filePath: string, line: number) => void;
  onRequestRemediation?: (finding: PodFinding) => Promise<string>;
}

export function BlastRadiusGraph({
  asts,
  violations,
  findings,
  focusedFilePath,
  onSelectNodeInEditor,
}: BlastRadiusGraphProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef = useRef<GraphNode[]>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'violations' | 'cross-file'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // 1. Extract Raw Graph Topology from AST & Violations
  const rawGraph = useMemo(() => {
    return extractBlastRadiusGraph(asts, violations, findings);
  }, [asts, violations, findings]);

  // 2. Compute Blast Radius Isolation State if a node is selected
  const { isolatedNodes, isolatedLinks, summary: blastSummary } = useMemo(() => {
    if (!selectedNodeId) {
      return {
        isolatedNodes: rawGraph.nodes.map((n) => ({
          ...n,
          isIsolated: false,
          isRootSelected: false,
          isDownstream: false,
          isUpstream: false,
        })),
        isolatedLinks: rawGraph.links.map((l) => ({ ...l, isHighlighted: false })),
        summary: null as BlastRadiusImpactSummary | null,
      };
    }
    return computeBlastRadiusIsolation(selectedNodeId, rawGraph.nodes, rawGraph.links);
  }, [rawGraph, selectedNodeId]);

  // 3. Filter nodes based on user filter controls
  const filteredNodes = useMemo(() => {
    let result = isolatedNodes;
    if (filterMode === 'violations') {
      result = result.filter((n) => n.hasViolation || n.isIsolated);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          n.filePath.toLowerCase().includes(q) ||
          n.violations.some((v) => v.message.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [isolatedNodes, filterMode, searchQuery]);

  const filteredLinks = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    return isolatedLinks.filter((l) => {
      const sId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      const matchesFilter = nodeIds.has(sId) && nodeIds.has(tId);
      if (!matchesFilter) return false;
      if (filterMode === 'cross-file') return l.isCrossFile || l.isHighlighted;
      return true;
    });
  }, [isolatedLinks, filteredNodes, filterMode]);

  // Helper to Zoom & Center on a specific file cluster
  const zoomToFileCluster = (filePath: string) => {
    if (!svgRef.current || !containerRef.current || !zoomBehaviorRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = containerRef.current.clientWidth || 800;
    const height = isExpanded ? 640 : 420;

    const baseName = filePath.split('/').pop() ?? filePath;
    const currentSimNodes = simNodesRef.current;

    // Find the file node or matching cluster nodes
    const clusterNodes = currentSimNodes.filter(
      (n) => n.filePath === filePath || n.filePath.endsWith(baseName) || n.name === baseName,
    );

    if (clusterNodes.length === 0) return;

    // Calculate cluster bounding box
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    clusterNodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
    });

    if (minX === Infinity) return;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const dx = Math.max(80, maxX - minX);
    const dy = Math.max(80, maxY - minY);

    // Compute scale to frame the file cluster nicely
    const scale = Math.min(2.0, Math.max(1.1, 0.75 / Math.max(dx / width, dy / height)));
    const transform = d3.zoomIdentity
      .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
      .scale(scale);

    svg
      .transition()
      .duration(750)
      .ease(d3.easeCubicOut)
      .call(zoomBehaviorRef.current.transform, transform);
  };

  // 4. Respond to File Selection from Outside (Tabs/Repo Selector)
  useEffect(() => {
    if (!focusedFilePath) return;

    // Auto-select file node to isolate its blast radius & calls
    const baseName = focusedFilePath.split('/').pop() ?? focusedFilePath;
    const matchingFileNode = rawGraph.nodes.find(
      (n) => n.kind === 'file' && (n.filePath === focusedFilePath || n.filePath.endsWith(baseName)),
    );

    if (matchingFileNode) {
      setSelectedNodeId(matchingFileNode.id);
    }

    // Delay slightly to let simulation settle before smooth zoom
    const timer = setTimeout(() => {
      zoomToFileCluster(focusedFilePath);
    }, 180);

    return () => clearTimeout(timer);
  }, [focusedFilePath, rawGraph]);

  // 5. Render D3 Force Simulation
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = containerRef.current.clientWidth || 800;
    const height = isExpanded ? 640 : 420;

    svg.selectAll('*').remove();

    // Definitions (Arrowheads and Glow Filters)
    const defs = svg.append('defs');

    // Standard Link Marker
    defs
      .append('marker')
      .attr('id', 'arrow-default')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#52525b');

    // Highlighted Blast Radius Marker
    defs
      .append('marker')
      .attr('id', 'arrow-highlighted')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 24)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#f43f5e');

    // Violation Pulsing Glow Filter
    const filter = defs.append('filter').attr('id', 'glow-red').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g').attr('class', 'graph-main-layer');

    // Zoom setup
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);
    zoomBehaviorRef.current = zoom;

    // Clone data for simulation
    const simNodes: GraphNode[] = filteredNodes.map((d) => ({ ...d }));
    simNodesRef.current = simNodes;

    const simNodeMap = new Map(simNodes.map((d) => [d.id, d]));
    const simLinks: GraphLink[] = filteredLinks
      .map((d) => {
        const sId = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
        const tId = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
        return {
          ...d,
          source: simNodeMap.get(sId)!,
          target: simNodeMap.get(tId)!,
        };
      })
      .filter((d) => d.source && d.target);

    // D3 Force Simulation Setup
    const simulation = d3
      .forceSimulation<GraphNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => (d.kind === 'CONTAINS' ? 55 : d.isCrossFile ? 110 : 80)),
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength((d) => (d.kind === 'file' ? -380 : -220)))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => (d.kind === 'file' ? 36 : 26)));

    // Links Render Layer
    const link = g
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .enter()
      .append('line')
      .attr('stroke', (d) => {
        if (selectedNodeId) {
          return d.isHighlighted ? '#f43f5e' : '#18181b';
        }
        if (d.hasViolation) return '#ef4444';
        if (d.kind === 'CONTAINS') return '#27272a';
        if (d.isCrossFile) return '#818cf8';
        return '#3f3f46';
      })
      .attr('stroke-width', (d) => (d.isHighlighted ? 2.5 : d.hasViolation ? 2 : 1))
      .attr('stroke-dasharray', (d) => (d.kind === 'CONTAINS' ? '3,3' : d.isCrossFile ? '4,2' : null))
      .attr('stroke-opacity', (d) => (selectedNodeId ? (d.isHighlighted ? 1 : 0.12) : 0.7))
      .attr('marker-end', (d) => (d.isHighlighted ? 'url(#arrow-highlighted)' : 'url(#arrow-default)'));

    // Nodes Render Layer
    const nodeGroup = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(simNodes)
      .enter()
      .append('g')
      .attr('cursor', 'pointer')
      .attr('opacity', (d) => (selectedNodeId ? (d.isIsolated || d.isRootSelected ? 1 : 0.16) : 1))
      .on('click', (_event, d) => {
        setSelectedNodeId((prev) => (prev === d.id ? null : d.id));
      });

    // Drag behavior
    nodeGroup.call(
      d3
        .drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // Pulsing Outer Rings for Violations / Selected Node
    nodeGroup
      .filter((d) => Boolean(d.hasViolation || d.isRootSelected))
      .append('circle')
      .attr('r', (d) => (d.kind === 'file' ? 24 : 18))
      .attr('fill', 'none')
      .attr('stroke', (d) => (d.isRootSelected ? '#a855f7' : d.severity === 'error' ? '#ef4444' : '#f59e0b'))
      .attr('stroke-width', 2)
      .attr('opacity', 0.85)
      .attr('class', (d) => (d.hasViolation ? 'animate-ping origin-center' : ''))
      .attr('style', 'transform-origin: center; animation-duration: 2s;');

    // Base Node Shapes: Rectangles for Files, Circles for Functions & Sinks
    nodeGroup.each(function (d) {
      const el = d3.select(this);

      if (d.kind === 'file') {
        // File Box Node
        el.append('rect')
          .attr('x', -20)
          .attr('y', -16)
          .attr('width', 40)
          .attr('height', 32)
          .attr('rx', 6)
          .attr('fill', d.isRootSelected ? '#581c87' : d.hasViolation ? '#7f1d1d' : '#18181b')
          .attr('stroke', d.isRootSelected ? '#c084fc' : d.hasViolation ? '#ef4444' : '#38bdf8')
          .attr('stroke-width', d.isRootSelected ? 2 : 1.5)
          .attr('filter', d.hasViolation ? 'url(#glow-red)' : null);

        el.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', 4)
          .attr('font-size', '10px')
          .attr('font-family', 'monospace')
          .attr('fill', '#94a3b8')
          .text('FILE');
      } else if (d.kind === 'external_call') {
        // External Sink Diamond / Circle
        el.append('circle')
          .attr('r', 13)
          .attr('fill', d.hasViolation ? '#831843' : '#18181b')
          .attr('stroke', d.hasViolation ? '#f43f5e' : '#a78bfa')
          .attr('stroke-width', 1.5);

        el.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', 3.5)
          .attr('font-size', '9px')
          .attr('font-weight', 'bold')
          .attr('fill', '#c084fc')
          .text('EXT');
      } else {
        // Function Node
        el.append('circle')
          .attr('r', d.isRootSelected ? 14 : 11)
          .attr('fill', d.isRootSelected ? '#4c1d95' : d.hasViolation ? '#991b1b' : d.isDownstream ? '#065f46' : '#09090b')
          .attr('stroke', d.isRootSelected ? '#e879f9' : d.hasViolation ? '#f87171' : d.isDownstream ? '#34d399' : '#10b981')
          .attr('stroke-width', d.isRootSelected ? 2 : 1.5)
          .attr('filter', d.hasViolation ? 'url(#glow-red)' : null);

        el.append('text')
          .attr('text-anchor', 'middle')
          .attr('dy', 3.5)
          .attr('font-size', '9px')
          .attr('font-weight', 'bold')
          .attr('fill', '#ffffff')
          .text('fn');
      }
    });

    // Node Labels
    nodeGroup
      .append('text')
      .attr('dy', (d) => (d.kind === 'file' ? 26 : 22))
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('font-weight', (d) => (d.isRootSelected || d.hasViolation ? 'bold' : 'normal'))
      .attr('fill', (d) => (d.isRootSelected ? '#e879f9' : d.hasViolation ? '#fca5a5' : '#a1a1aa'))
      .text((d) => (d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name));

    // Simulation Tick Update
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
        .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
        .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
        .attr('y2', (d) => (d.target as GraphNode).y ?? 0);

      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [filteredNodes, filteredLinks, selectedNodeId, isExpanded]);

  // Zoom control handlers
  const handleZoom = (factor: number) => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(300).call(zoomBehaviorRef.current.scaleBy, factor);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current).transition().duration(400).call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  const handleClearSelection = () => {
    setSelectedNodeId(null);
  };

  return (
    <div className="relative flex flex-col rounded-xl border border-white/[0.08] bg-zinc-900/90 shadow-2xl overflow-hidden mb-6">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-zinc-950 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-indigo-400">
            <Network className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                Blast Radius Force Graph
              </h3>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-400 border border-white/[0.06]">
                DuckDB-Wasm Call Chains
              </span>
              {focusedFilePath && (
                <span className="rounded bg-indigo-950/60 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
                  Focus: {focusedFilePath.split('/').pop()}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400">
              {rawGraph.summary.totalFiles} files · {rawGraph.summary.totalFunctions} functions · {rawGraph.summary.totalCalls} call edges
              {rawGraph.summary.totalViolations > 0 && (
                <span className="text-rose-400 ml-2 font-medium">
                  · {rawGraph.summary.totalViolations} Active finding(s)
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
            <input
              type="text"
              placeholder="Search graph..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-32 sm:w-40 rounded-lg border border-white/[0.08] bg-zinc-900 pl-7 pr-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Filter Mode Selector */}
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-zinc-900 p-0.5">
            <button
              onClick={() => setFilterMode('all')}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
                filterMode === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterMode('violations')}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
                filterMode === 'violations' ? 'bg-rose-900/80 text-rose-200' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Violations
            </button>
            <button
              onClick={() => setFilterMode('cross-file')}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all ${
                filterMode === 'cross-file' ? 'bg-indigo-900/80 text-indigo-200' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Cross-File
            </button>
          </div>

          {/* Zoom Buttons */}
          <div className="flex items-center gap-1 border-l border-white/[0.08] pl-2">
            {focusedFilePath && (
              <button
                onClick={() => zoomToFileCluster(focusedFilePath)}
                title="Focus & Zoom on Selected File"
                className="flex items-center gap-1 rounded-lg bg-indigo-950/60 border border-indigo-500/30 px-2 py-1 text-[11px] font-mono text-indigo-200 hover:bg-indigo-900"
              >
                <Focus className="h-3 w-3" />
                <span>Focus</span>
              </button>
            )}
            <button
              onClick={() => handleZoom(1.3)}
              title="Zoom In"
              className="rounded-lg bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700 hover:text-white"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleZoom(0.7)}
              title="Zoom Out"
              className="rounded-lg bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700 hover:text-white"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              title="Reset View"
              className="rounded-lg bg-zinc-800 px-2 py-1 text-[11px] font-mono text-zinc-300 hover:bg-zinc-700"
            >
              Fit
            </button>
          </div>

          {/* Expand / Collapse Button */}
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            className="rounded-lg bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700 hover:text-white"
            title={isExpanded ? 'Collapse Graph' : 'Expand Graph'}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        ref={containerRef}
        className={`relative w-full bg-zinc-950 transition-all ${
          isExpanded ? 'h-[640px]' : 'h-[420px]'
        }`}
      >
        <svg ref={svgRef} className="h-full w-full select-none" />

        {/* Legend Overlay */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.08] bg-zinc-900/80 px-3 py-1.5 backdrop-blur-sm text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-sky-400 bg-zinc-900" />
            <span>File</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-emerald-400 bg-emerald-950" />
            <span>Function</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-rose-500 bg-rose-950 animate-ping" />
            <span className="text-rose-400 font-medium">Violation Halo</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-fuchsia-400 bg-fuchsia-950" />
            <span>Selected Focal Node</span>
          </div>
        </div>

        {/* Interactive Blast Radius Inspector HUD */}
        {blastSummary && (
          <div className="absolute top-3 right-3 w-80 max-h-[90%] overflow-y-auto rounded-xl border border-fuchsia-500/30 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-md text-zinc-100 z-10 space-y-3">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Focus className="h-4 w-4 text-fuchsia-400" />
                <div>
                  <h4 className="text-xs font-semibold text-fuchsia-300 font-mono truncate max-w-[180px]">
                    {blastSummary.selectedNode.name}
                  </h4>
                  <p className="text-[10px] text-zinc-400">{blastSummary.selectedNode.filePath}</p>
                </div>
              </div>
              <button
                onClick={handleClearSelection}
                className="rounded-lg bg-zinc-800 p-1 text-zinc-400 hover:text-white transition-all"
                title="Exit Blast Radius Isolation"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Impact Metric Cards */}
            <div className="grid grid-cols-3 gap-2 text-center font-mono">
              <div className="rounded-lg bg-zinc-900 p-2 border border-white/[0.06]">
                <span className="text-[10px] uppercase text-zinc-500 block">Downstream</span>
                <span className="text-base font-bold text-emerald-400">
                  {blastSummary.impactedFunctionsCount}
                </span>
                <span className="text-[9px] text-zinc-400 block">Functions</span>
              </div>
              <div className="rounded-lg bg-zinc-900 p-2 border border-white/[0.06]">
                <span className="text-[10px] uppercase text-zinc-500 block">Cross-File</span>
                <span className="text-base font-bold text-indigo-400">
                  {blastSummary.crossFileEdgesCount}
                </span>
                <span className="text-[9px] text-zinc-400 block">Edges</span>
              </div>
              <div className="rounded-lg bg-zinc-900 p-2 border border-white/[0.06]">
                <span className="text-[10px] uppercase text-zinc-500 block">Blast Radius</span>
                <span className="text-base font-bold text-amber-400">
                  {blastSummary.impactedFilesCount}
                </span>
                <span className="text-[9px] text-zinc-400 block">File(s)</span>
              </div>
            </div>

            {/* Direct & Path Violations */}
            {blastSummary.pathViolations.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>{blastSummary.pathViolations.length} Finding(s) in Blast Radius Path:</span>
                </span>
                <ul className="space-y-1 max-h-36 overflow-y-auto text-xs">
                  {blastSummary.pathViolations.map((v, i) => (
                    <li
                      key={i}
                      className="rounded bg-rose-950/40 border border-rose-500/30 p-2 text-[11px] text-rose-200"
                    >
                      <span className="font-semibold block font-mono">{v.source}</span>
                      <p className="mt-0.5 text-zinc-300">{v.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded bg-emerald-950/20 border border-emerald-500/30 p-2 text-center text-[11px] text-emerald-300 font-mono">
                No security violations in this execution path
              </div>
            )}

            {/* Jump to Code Action */}
            {blastSummary.selectedNode.startRow !== undefined && onSelectNodeInEditor && (
              <button
                onClick={() =>
                  onSelectNodeInEditor(
                    blastSummary.selectedNode.filePath,
                    (blastSummary.selectedNode.startRow ?? 0) + 1,
                  )
                }
                className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-all shadow-sm"
              >
                <span>Inspect in Code Studio (Line {(blastSummary.selectedNode.startRow ?? 0) + 1})</span>
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
