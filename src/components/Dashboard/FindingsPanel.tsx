import { useState, useMemo } from 'react';
import type { PolicyViolation } from '../../types/rules';
import type { PodFinding } from '../../types/pods';
import {
  ShieldAlert,
  Zap,
  Network,
  FileCode2,
  Lightbulb,
  ExternalLink,
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Search,
  X,
  Copy,
  Check,
  Terminal,
  Filter,
  Layers,
} from 'lucide-react';

interface FindingsPanelProps {
  violations: PolicyViolation[];
  findings: PodFinding[];
  filePaths?: string[];
  /** Wired to swarm-orchestrator's requestRemediation() */
  onRequestRemediation?: (finding: PodFinding) => Promise<string>;
  onSelectFileAndLine?: (fileIndex: number, line: number) => void;
}

type RemediationState =
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; message: string };

const SEVERITY_CONFIG: Record<
  'info' | 'warn' | 'error',
  { label: string; bg: string; text: string; border: string; glow: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  error: {
    label: 'CRITICAL',
    bg: 'bg-rose-950/40',
    text: 'text-rose-400',
    border: 'border-rose-500/40',
    glow: 'shadow-rose-950/40',
    Icon: AlertCircle,
  },
  warn: {
    label: 'WARNING',
    bg: 'bg-amber-950/30',
    text: 'text-amber-400',
    border: 'border-amber-500/40',
    glow: 'shadow-amber-950/40',
    Icon: AlertTriangle,
  },
  info: {
    label: 'INFO',
    bg: 'bg-zinc-800/60',
    text: 'text-zinc-300',
    border: 'border-white/[0.08]',
    glow: 'shadow-zinc-950/40',
    Icon: Info,
  },
};

interface FindingItem {
  key: string;
  podId: 'security' | 'complexity' | 'architecture' | 'policy';
  podCode: string;
  severity: 'info' | 'warn' | 'error';
  line: number;
  fileId: number;
  fileName: string;
  filePath: string;
  title: string;
  evidence: string;
  finding: PodFinding | null;
}

interface AgentGroup {
  id: 'security' | 'complexity' | 'architecture' | 'policy';
  podCode: string;
  name: string;
  shortName: string;
  Icon: React.ComponentType<{ className?: string }>;
  description: string;
  items: FindingItem[];
}

export function FindingsPanel({
  violations,
  findings,
  filePaths,
  onRequestRemediation,
  onSelectFileAndLine,
}: FindingsPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [remediations, setRemediations] = useState<Record<string, RemediationState>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyEvidence = (text: string, key: string): void => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSuggestFix = async (finding: PodFinding, key: string): Promise<void> => {
    if (!onRequestRemediation) return;
    setRemediations((prev) => ({ ...prev, [key]: { status: 'loading' } }));
    try {
      const text = await onRequestRemediation(finding);
      setRemediations((prev) => ({ ...prev, [key]: { status: 'done', text } }));
    } catch (err) {
      setRemediations((prev) => ({
        ...prev,
        [key]: { status: 'error', message: err instanceof Error ? err.message : String(err) },
      }));
    }
  };

  // Group all findings and violations by Agent Pod
  const agentGroups: AgentGroup[] = useMemo(() => {
    // 1. Security Pod Agent Items
    const securityItems: FindingItem[] = findings
      .filter((f) => f.podId === 'security')
      .map((f) => {
        const fileId = f.fileId ?? 0;
        const filePath = filePaths?.[fileId] ?? 'submission.py';
        const fileName = filePath.split('/').pop() ?? filePath;
        return {
          key: `security-${f.nodeId}-${f.startRow}-${fileId}`,
          podId: 'security',
          podCode: 'POD-01',
          severity: f.severity,
          line: f.startRow + 1,
          fileId,
          fileName,
          filePath,
          title: f.title,
          evidence: f.detail,
          finding: f,
        };
      });

    // 2. Complexity Pod Agent Items
    const complexityItems: FindingItem[] = findings
      .filter((f) => f.podId === 'complexity')
      .map((f) => {
        const fileId = f.fileId ?? 0;
        const filePath = filePaths?.[fileId] ?? 'submission.py';
        const fileName = filePath.split('/').pop() ?? filePath;
        return {
          key: `complexity-${f.nodeId}-${f.startRow}-${fileId}`,
          podId: 'complexity',
          podCode: 'POD-02',
          severity: f.severity,
          line: f.startRow + 1,
          fileId,
          fileName,
          filePath,
          title: f.title,
          evidence: f.detail,
          finding: f,
        };
      });

    // 3. Architecture Pod Agent Items
    const architectureItems: FindingItem[] = findings
      .filter((f) => f.podId === 'architecture')
      .map((f) => {
        const fileId = f.fileId ?? 0;
        const filePath = filePaths?.[fileId] ?? 'submission.py';
        const fileName = filePath.split('/').pop() ?? filePath;
        return {
          key: `architecture-${f.nodeId}-${f.startRow}-${fileId}`,
          podId: 'architecture',
          podCode: 'POD-03',
          severity: f.severity,
          line: f.startRow + 1,
          fileId,
          fileName,
          filePath,
          title: f.title,
          evidence: f.detail,
          finding: f,
        };
      });

    // 4. Deterministic SQL Policy Engine Items
    const policyItems: FindingItem[] = violations.map((v) => {
      const fileId = v.fileId ?? 0;
      const filePath = filePaths?.[fileId] ?? 'submission.py';
      const fileName = filePath.split('/').pop() ?? filePath;
      return {
        key: `policy-${v.ruleId}-${v.nodeId}-${v.startRow}-${fileId}`,
        podId: 'policy',
        podCode: 'SQL-04',
        severity: v.severity,
        line: v.startRow + 1,
        fileId,
        fileName,
        filePath,
        title: `Rule #${v.ruleId}: ${v.ruleType}`,
        evidence: `${v.message} — Evidence: ${v.evidence}`,
        finding: {
          podId: 'security',
          nodeId: v.nodeId,
          fileId: v.fileId,
          startRow: v.startRow,
          endRow: v.endRow,
          severity: v.severity,
          title: `${v.ruleType}: ${v.message}`,
          detail: v.evidence,
          requiresRemediation: true,
        } as PodFinding,
      };
    });

    return [
      {
        id: 'security',
        podCode: 'POD-01',
        name: 'Bug Reports & Security Sinks',
        shortName: 'Security',
        Icon: ShieldAlert,
        description: 'Vulnerabilities, unsanitized deserialization, injection & security bugs',
        items: securityItems,
      },
      {
        id: 'complexity',
        podCode: 'POD-02',
        name: 'Optimization & Performance',
        shortName: 'Optimization',
        Icon: Zap,
        description: 'Algorithmic bottlenecks, loop nesting depth & O(N^k) candidates',
        items: complexityItems,
      },
      {
        id: 'architecture',
        podCode: 'POD-03',
        name: 'Architectural Guidance',
        shortName: 'Architecture',
        Icon: Network,
        description: 'Function fanout, cross-file blast radius & high coupling hubs',
        items: architectureItems,
      },
      {
        id: 'policy',
        podCode: 'SQL-04',
        name: 'Historical Policy Rules',
        shortName: 'Historical Rules',
        Icon: FileCode2,
        description: 'Deterministic SQL rules compiled from historical review CSV data',
        items: policyItems,
      },
    ];
  }, [violations, findings, filePaths]);

  const allItems = useMemo(() => {
    return agentGroups.flatMap((g) => g.items);
  }, [agentGroups]);

  const totalFindingsCount = allItems.length;
  const criticalCount = allItems.filter((i) => i.severity === 'error').length;
  const warnCount = allItems.filter((i) => i.severity === 'warn').length;

  // Filter items according to user tab selection, severity, and search query
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return allItems.filter((item) => {
      // 1. Tab filter
      if (activeTab !== 'all' && item.podId !== activeTab) {
        return false;
      }
      // 2. Severity filter
      if (severityFilter !== 'all' && item.severity !== severityFilter) {
        return false;
      }
      // 3. Search query filter
      if (q) {
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesEvidence = item.evidence.toLowerCase().includes(q);
        const matchesFile = item.fileName.toLowerCase().includes(q) || item.filePath.toLowerCase().includes(q);
        const matchesPod = item.podCode.toLowerCase().includes(q) || item.podId.toLowerCase().includes(q);
        return matchesTitle || matchesEvidence || matchesFile || matchesPod;
      }
      return true;
    });
  }, [allItems, activeTab, severityFilter, searchQuery]);

  return (
    <div className="space-y-4">
      {/* HIGH-TECH SEGMENTED TAB BAR */}
      <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-1.5 backdrop-blur-2xl shadow-2xl">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
          {/* TAB 1: ALL FINDINGS */}
          <button
            onClick={() => setActiveTab('all')}
            className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-mono transition-all relative ${
              activeTab === 'all'
                ? 'bg-gradient-to-r from-amber-600/90 to-amber-700 text-white font-bold border border-amber-500/40 shadow-lg shadow-amber-950/60'
                : 'bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-bold leading-none truncate">All</span>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold shrink-0 ${
                criticalCount > 0
                  ? 'bg-rose-950 text-rose-300 border border-rose-500/30'
                  : 'bg-zinc-800 text-zinc-300 border border-white/[0.06]'
              }`}
            >
              {totalFindingsCount}
            </span>
          </button>

          {/* TABS 2-5: POD SPECIFIC TABS */}
          {agentGroups.map((group) => {
            const GroupIcon = group.Icon;
            const isSelected = activeTab === group.id;
            const groupCriticalCount = group.items.filter((i) => i.severity === 'error').length;
            const groupWarnCount = group.items.filter((i) => i.severity === 'warn').length;

            return (
              <button
                key={group.id}
                onClick={() => setActiveTab(group.id)}
                className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-mono transition-all relative ${
                  isSelected
                    ? 'bg-gradient-to-r from-amber-600/90 to-amber-700 text-white font-bold border border-amber-500/40 shadow-lg shadow-amber-950/60'
                    : 'bg-zinc-900/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GroupIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-semibold leading-none truncate">
                    {group.shortName}
                  </span>
                </div>

                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold shrink-0 ${
                    groupCriticalCount > 0
                      ? 'bg-rose-950 text-rose-300 border border-rose-500/30'
                      : groupWarnCount > 0
                        ? 'bg-amber-950 text-amber-300 border border-amber-500/30'
                        : 'bg-zinc-800/80 text-zinc-400 border border-white/[0.04]'
                  }`}
                >
                  {group.items.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECONDARY FILTER & SEARCH TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/80 p-3 backdrop-blur-xl shadow-lg">
        {/* Search Filter Input */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search findings by rule, code evidence, or file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-white/[0.08] bg-zinc-950 pr-8 pl-9 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-500 shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-white"
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Severity Filter Toggle Pills */}
        <div className="flex items-center gap-1.5 border-l border-white/[0.08] pl-3">
          <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline flex items-center gap-1">
            <Filter className="h-3 w-3 text-zinc-500" />
            <span>Severity:</span>
          </span>

          <button
            onClick={() => setSeverityFilter('all')}
            className={`rounded-xl px-3 py-1 text-xs font-mono font-medium transition-all ${
              severityFilter === 'all'
                ? 'bg-zinc-800 text-white border border-white/[0.1] shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({totalFindingsCount})
          </button>

          <button
            onClick={() => setSeverityFilter('error')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-mono font-medium transition-all border ${
              severityFilter === 'error'
                ? 'bg-rose-950/60 text-rose-200 border-rose-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-rose-300 border-transparent'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            <span>Critical ({criticalCount})</span>
          </button>

          <button
            onClick={() => setSeverityFilter('warn')}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-mono font-medium transition-all border ${
              severityFilter === 'warn'
                ? 'bg-amber-950/60 text-amber-200 border-amber-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-amber-300 border-transparent'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>Warnings ({warnCount})</span>
          </button>
        </div>
      </div>

      {/* FINDINGS STREAM LIST */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          allItems.length > 0 ? (
            <div className="rounded-2xl border border-amber-500/20 bg-[#17120e]/80 p-6 text-center text-xs text-stone-400 font-mono shadow-xl">
              No findings match active filters ({activeTab} · {severityFilter} · "{searchQuery}").
            </div>
          ) : null
        ) : (
          filteredItems.map((item) => {
            const badge = SEVERITY_CONFIG[item.severity];
            const remediation = remediations[item.key];
            const SeverityIcon = badge.Icon;
            const isCopied = copiedKey === item.key;

            return (
              <div
                key={item.key}
                className={`rounded-2xl border p-4 transition-all ${badge.bg} ${badge.border} shadow-xl text-zinc-200 space-y-3 backdrop-blur-md`}
              >
                {/* Header Row: Severity Badge + Pod Code + Target File Line Link */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/[0.06] pb-2.5">
                  <div className="flex items-center gap-2">
                    {/* Severity Pill */}
                    <span
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider border ${badge.border} ${badge.text} bg-zinc-950/80 shadow-sm`}
                    >
                      <SeverityIcon className="h-3 w-3" />
                      <span>{badge.label}</span>
                    </span>

                    {/* Pod Tag */}
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-900 border border-white/[0.08] text-zinc-400 uppercase font-semibold">
                      {item.podId}
                    </span>
                  </div>

                  {/* Jump-to-Code Location Pill */}
                  <button
                    onClick={() => onSelectFileAndLine?.(item.fileId, item.line)}
                    className="group flex items-center gap-1.5 font-mono text-xs text-indigo-300 hover:text-white bg-indigo-950/70 hover:bg-indigo-900/80 px-3 py-1 rounded-xl border border-indigo-500/40 transition-all shadow-sm"
                    title={`Inspect ${item.filePath} at line ${item.line}`}
                  >
                    <span className="font-semibold text-indigo-200">{item.fileName}</span>
                    <span className="text-zinc-400">:L{item.line}</span>
                    <ExternalLink className="h-3 w-3 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>

                {/* Finding Title */}
                <div>
                  <h4 className="text-sm font-bold text-zinc-100 font-sans tracking-wide">
                    {item.title}
                  </h4>
                </div>

                {/* AST Code Evidence Terminal Block */}
                <div className="relative rounded-xl border border-white/[0.06] bg-zinc-950/90 p-3 font-mono text-xs text-zinc-300 shadow-inner group">
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1 pb-1 border-b border-white/[0.04]">
                    <span className="flex items-center gap-1">
                      <Terminal className="h-3 w-3 text-indigo-400" />
                      <span>AST Trace Evidence</span>
                    </span>
                    <button
                      onClick={() => handleCopyEvidence(item.evidence, item.key)}
                      className="text-zinc-500 hover:text-zinc-200 flex items-center gap-1 transition-colors"
                      title="Copy evidence to clipboard"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap break-words text-zinc-300">
                    {item.evidence}
                  </p>
                </div>

                {/* AI Remediation Section */}
                {item.finding && onRequestRemediation && (
                  <div className="pt-2 border-t border-white/[0.06] flex flex-col gap-2">
                    {!remediation && (
                      <button
                        onClick={() => void handleSuggestFix(item.finding!, item.key)}
                        className="self-start flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-3.5 py-1.5 text-xs font-bold text-white hover:from-indigo-500 hover:to-indigo-400 shadow-lg shadow-indigo-600/30 transition-all font-sans"
                      >
                        <Lightbulb className="h-3.5 w-3.5" />
                        <span>Generate Remediation Fix</span>
                      </button>
                    )}

                    {remediation?.status === 'loading' && (
                      <div className="flex items-center gap-2 rounded-xl bg-indigo-950/40 border border-indigo-500/30 p-3 text-xs text-indigo-300 font-mono">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Generating zero-trust patch advice...</span>
                      </div>
                    )}

                    {remediation?.status === 'error' && (
                      <div className="rounded-xl bg-rose-950/40 border border-rose-500/30 p-3 text-xs text-rose-300 font-mono flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                        <span>Remediation engine unavailable: {remediation.message}</span>
                      </div>
                    )}

                    {remediation?.status === 'done' && (
                      <div className="rounded-xl bg-zinc-950 border border-indigo-500/40 p-3.5 text-xs text-zinc-200 space-y-2 shadow-2xl">
                        <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.06]">
                          <span className="font-bold text-indigo-300 flex items-center gap-1.5 font-mono text-xs">
                            <Lightbulb className="h-3.5 w-3.5 text-indigo-400" />
                            <span>Recommended Remediation & Patch:</span>
                          </span>
                          <button
                            onClick={() => handleCopyEvidence(remediation.text, `${item.key}-rem`)}
                            className="text-[11px] font-mono text-zinc-400 hover:text-white flex items-center gap-1"
                          >
                            {copiedKey === `${item.key}-rem` ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy Patch</span>
                              </>
                            )}
                          </button>
                        </div>
                        <p className="whitespace-pre-wrap leading-relaxed text-zinc-300 font-mono text-[11px] bg-zinc-900/60 p-2.5 rounded-lg border border-white/[0.04]">
                          {remediation.text}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
