import { useState } from 'react';
import type { SwarmPhase } from '../../state/swarm-orchestrator';
import type { PodFinding } from '../../types/pods';
import type { PolicyViolation } from '../../types/rules';
import type { TestVerdict } from '../../types/verdicts';
import {
  ExternalLink,
  AlertTriangle,
  Sliders,
  X,
  CheckCircle2,
} from 'lucide-react';

interface AgentSwarmPanelProps {
  phase: SwarmPhase;
  violations: PolicyViolation[];
  findings: PodFinding[];
  verdicts: TestVerdict[];
  hasReceipt: boolean;
  filePaths?: string[];
  onSelectFileAndLine?: (fileIndex: number, line: number) => void;
}

// Custom High-Tech Cyber Sensor Visuals (Non-Generic)
function SecuritySensorVisual({ count }: { count: number }): JSX.Element {
  const isAlert = count > 0;
  return (
    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 border border-white/[0.08] shadow-inner">
      <svg className="h-7 w-7" viewBox="0 0 40 40">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke={isAlert ? '#f43f5e' : '#10b981'}
          strokeWidth="1.5"
          strokeDasharray="4 3"
          className="animate-spin"
          style={{ animationDuration: '10s' }}
        />
        <circle
          cx="20"
          cy="20"
          r="9"
          fill={isAlert ? 'rgba(244, 63, 94, 0.15)' : 'rgba(16, 185, 129, 0.15)'}
          stroke={isAlert ? '#fb7185' : '#34d399'}
          strokeWidth="1.5"
        />
        <circle
          cx="20"
          cy="20"
          r="3"
          fill={isAlert ? '#f43f5e' : '#10b981'}
          className={isAlert ? 'animate-ping' : ''}
        />
      </svg>
      {isAlert && (
        <span className="absolute -top-1 -right-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        </span>
      )}
    </div>
  );
}

function ComplexitySensorVisual({ count }: { count: number }): JSX.Element {
  const isAlert = count > 0;
  return (
    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 border border-white/[0.08] shadow-inner">
      <svg className="h-7 w-7" viewBox="0 0 40 40">
        <path
          d="M6 30 Q12 10 20 22 T34 10"
          fill="none"
          stroke={isAlert ? '#f59e0b' : '#10b981'}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line x1="6" y1="32" x2="34" y2="32" stroke="#3f3f46" strokeWidth="1" strokeDasharray="2 2" />
        <circle cx="20" cy="22" r="2.5" fill={isAlert ? '#fbbf24' : '#34d399'} />
        <circle cx="34" cy="10" r="2.5" fill={isAlert ? '#f59e0b' : '#10b981'} className={isAlert ? 'animate-pulse' : ''} />
      </svg>
    </div>
  );
}

function ArchitectureSensorVisual({ count }: { count: number }): JSX.Element {
  const isAlert = count > 0;
  return (
    <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 border border-white/[0.08] shadow-inner">
      <svg className="h-7 w-7" viewBox="0 0 40 40">
        <line x1="20" y1="8" x2="10" y2="28" stroke={isAlert ? '#818cf8' : '#3f3f46'} strokeWidth="1.5" />
        <line x1="20" y1="8" x2="30" y2="28" stroke={isAlert ? '#818cf8' : '#3f3f46'} strokeWidth="1.5" />
        <line x1="10" y1="28" x2="30" y2="28" stroke={isAlert ? '#818cf8' : '#3f3f46'} strokeWidth="1.5" />
        <circle cx="20" cy="8" r="3" fill="#818cf8" />
        <circle cx="10" cy="28" r="3" fill="#6366f1" />
        <circle cx="30" cy="28" r="3" fill="#c084fc" />
      </svg>
    </div>
  );
}

export function AgentSwarmPanel({
  phase,
  violations,
  findings,
  verdicts: _verdicts,
  hasReceipt: _hasReceipt,
  filePaths,
  onSelectFileAndLine,
}: AgentSwarmPanelProps): JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const getFileName = (fileId?: number): string => {
    const path = filePaths?.[fileId ?? 0] ?? 'submission.py';
    return path.split('/').pop() ?? path;
  };

  const securityFindings = findings.filter((f) => f.podId === 'security');
  const complexityFindings = findings.filter((f) => f.podId === 'complexity');
  const architectureFindings = findings.filter((f) => f.podId === 'architecture');

  const isIngesting = phase === 'ingesting';
  const isScanning = phase === 'scanning';
  const isAnalyzing = phase === 'analyzing';
  const isDone = phase === 'done';

  const totalSecurityCount = securityFindings.length + violations.length;

  const agents = [
    {
      id: 'security',
      podCode: 'POD-01 : Static Sink',
      title: 'Security Pod',
      subtitle: 'Static Injection & Sink Guard',
      Visual: <SecuritySensorVisual count={totalSecurityCount} />,
      description: 'Scans for unsanitized deserialization sinks, unsafe dynamic eval & injection points.',
      status: isIngesting
        ? 'Ingesting AST'
        : isScanning || isAnalyzing
          ? 'Scanning AST'
          : isDone
            ? totalSecurityCount > 0
              ? `${totalSecurityCount} Vulnerability`
              : 'Zero-Trust Pass'
            : 'Standby',
      active: isIngesting || isScanning || isAnalyzing,
      count: totalSecurityCount,
      accentBorder: totalSecurityCount > 0 ? 'border-t-rose-500' : 'border-t-emerald-500',
      findingsList: [
        ...violations.map((v) => ({
          title: `Rule #${v.ruleId} (${v.ruleType})`,
          detail: v.message,
          line: v.startRow + 1,
          fileId: v.fileId ?? 0,
          fileName: getFileName(v.fileId),
        })),
        ...securityFindings.map((f) => ({
          title: f.title,
          detail: f.detail,
          line: f.startRow + 1,
          fileId: f.fileId ?? 0,
          fileName: getFileName(f.fileId),
        })),
      ],
      rulesEvaluated: [
        'DANGEROUS_SINKS (pickle, yaml, eval, exec, os.system)',
        'UNTRUSTED_SOURCES (request.json, sys.argv, os.getenv)',
        'FORBIDDEN_CALL (SafeAbs / Custom wrappers)',
      ],
    },
    {
      id: 'complexity',
      podCode: 'POD-02 : Loop Complexity',
      title: 'Complexity Pod',
      subtitle: 'Algorithmic Bottlenecks',
      Visual: <ComplexitySensorVisual count={complexityFindings.length} />,
      description: 'Detects loop nesting depth >= 2, recursive cycles & O(N^k) candidates.',
      status: isAnalyzing
        ? 'Analyzing Loops'
        : isDone
          ? complexityFindings.length > 0
            ? `${complexityFindings.length} Bottlenecks`
            : 'Optimal O(N)'
          : 'Standby',
      active: isAnalyzing,
      count: complexityFindings.length,
      accentBorder: complexityFindings.length > 0 ? 'border-t-amber-500' : 'border-t-emerald-500',
      findingsList: complexityFindings.map((f) => ({
        title: f.title,
        detail: f.detail,
        line: f.startRow + 1,
        fileId: f.fileId ?? 0,
        fileName: getFileName(f.fileId),
      })),
      rulesEvaluated: [
        'NESTED_LOOP_COMPLEXITY (depth >= 2 with call containment)',
        'HOT_LOOP_CALL_COUNT (call expressions in iteration body)',
        'ASYMPTOTIC_BOUND_ESTIMATOR',
      ],
    },
    {
      id: 'architecture',
      podCode: 'POD-03 : Blast Radius',
      title: 'Architecture Pod',
      subtitle: 'Blast Radius & Fanout',
      Visual: <ArchitectureSensorVisual count={architectureFindings.length} />,
      description: 'Evaluates function fanout, cross-file call hubs & blast radius propagation.',
      status: isAnalyzing
        ? 'Analyzing Coupling'
        : isDone
          ? architectureFindings.length > 0
            ? `${architectureFindings.length} Blast Risks`
            : 'Modular Hub'
          : 'Standby',
      active: isAnalyzing,
      count: architectureFindings.length,
      accentBorder: architectureFindings.length > 0 ? 'border-t-indigo-500' : 'border-t-emerald-500',
      findingsList: architectureFindings.map((f) => ({
        title: f.title,
        detail: f.detail,
        line: f.startRow + 1,
        fileId: f.fileId ?? 0,
        fileName: getFileName(f.fileId),
      })),
      rulesEvaluated: [
        'CROSS_FILE_FANOUT (caller_file_count >= 2)',
        'CALL_COUPLING_DENSITY (central hub functions)',
        'DOWNSTREAM_BREAKING_CHANGE_PREDICTOR',
      ],
    },
  ];

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <div className="space-y-4 mb-6">
      {/* Panel Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">
              Autonomous Swarm Pods
            </h2>
          </div>
        </div>
      </div>

      {/* 3 Agent Cards Grid (Security, Complexity, Architecture) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const isSelected = selectedAgentId === agent.id;

          return (
            <div
              key={agent.id}
              onClick={() => setSelectedAgentId(isSelected ? null : agent.id)}
              className={`rounded-2xl border border-white/[0.08] p-4 transition-all cursor-pointer flex flex-col justify-between relative group border-t-2 ${
                agent.accentBorder
              } ${
                isSelected
                  ? 'bg-zinc-900/95 ring-1 ring-indigo-500/50 shadow-2xl shadow-indigo-950/50'
                  : 'bg-zinc-900/70 hover:bg-zinc-900/90 hover:border-white/[0.14] shadow-lg'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  {agent.Visual}

                  {agent.active ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border font-semibold ${
                        agent.count > 0
                          ? 'bg-rose-950/60 text-rose-300 border-rose-500/30'
                          : 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {agent.status}
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-bold text-zinc-100 mt-0.5">{agent.title}</h3>
                <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1 leading-relaxed">
                  {agent.description}
                </p>
              </div>

              <div className="mt-4 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono">
                <span className="text-zinc-500">Telemetry:</span>
                <span className="text-zinc-300 group-hover:text-indigo-300 transition-colors flex items-center gap-1">
                  <span>Inspect</span>
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Agent Telemetry Drawer */}
      {selectedAgent && (
        <div className="rounded-2xl border border-indigo-500/30 bg-zinc-950 p-5 shadow-2xl text-zinc-200 space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div className="flex items-center gap-3">
              {selectedAgent.Visual}
              <div>
                <h4 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                  {selectedAgent.title} Telemetry
                </h4>
                <p className="text-xs text-zinc-400">{selectedAgent.description}</p>
              </div>
            </div>
            <button
              onClick={() => setSelectedAgentId(null)}
              className="rounded-xl bg-zinc-800/80 p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Rules / Heuristics Checked */}
            <div>
              <h5 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5 font-mono">
                <Sliders className="h-3.5 w-3.5 text-indigo-400" />
                <span>Active Heuristics & Rules Evaluated</span>
              </h5>
              <ul className="space-y-1.5 text-xs font-mono">
                {selectedAgent.rulesEvaluated.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-xl bg-zinc-900 border border-white/[0.04] p-2.5 text-zinc-300"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Findings Produced */}
            <div>
              <h5 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5 font-mono">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                <span>Emitted Findings ({selectedAgent.findingsList.length})</span>
              </h5>
              {selectedAgent.findingsList.length > 0 ? (
                <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {selectedAgent.findingsList.map((f, i) => (
                    <li
                      key={i}
                      className="rounded-xl bg-zinc-900 border border-white/[0.06] p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between font-medium text-zinc-200">
                        <span className="truncate pr-2 font-mono">{f.title}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFileAndLine?.(f.fileId, f.line);
                          }}
                          className="text-[10px] text-indigo-300 font-mono bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-500/30 hover:text-white transition-colors shrink-0 flex items-center gap-1"
                          title={`Select ${f.fileName} at line ${f.line}`}
                        >
                          <span>{f.fileName} : L{f.line}</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1 font-mono">{f.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl bg-zinc-900/60 border border-white/[0.04] p-3 text-xs text-emerald-400 flex items-center gap-2 font-mono">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>No violations detected by this pod.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
