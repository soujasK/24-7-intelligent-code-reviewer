import type { SkillMatrix } from '../../firebase/elo-engine';
import {
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

interface EloRatingCardProps {
  skillMatrix: SkillMatrix | null;
  scannedFilesCount: number;
  totalFindings: number;
  errorCount?: number;
  warnCount?: number;
  activeFilePath?: string;
  activeFileFindingsCount?: number;
  activeFileErrors?: number;
  activeFileWarns?: number;
}

export function EloRatingCard({
  skillMatrix,
  scannedFilesCount: _scannedFilesCount,
  totalFindings,
  errorCount = 0,
  warnCount = 0,
  activeFilePath,
  activeFileFindingsCount = 0,
  activeFileErrors = 0,
  activeFileWarns = 0,
}: EloRatingCardProps): JSX.Element {
  // 1. Dynamic Workspace Security Index (Weighted: Error = -15%, Warn = -5%)
  const workspaceSecIndex =
    totalFindings === 0
      ? 100
      : Math.max(5, Math.min(100, Math.round(100 - (errorCount * 15 + warnCount * 5))));

  // 2. Dynamic Active File Security Index
  const activeFileSecIndex =
    activeFileFindingsCount === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round(100 - (activeFileErrors * 25 + activeFileWarns * 10))));

  // 3. Dynamic ELO Rating
  const defaultElo =
    totalFindings === 0
      ? 1600
      : Math.max(600, Math.min(2400, Math.round(1500 - (errorCount * 65 + warnCount * 25))));

  const overallRating = skillMatrix?.overall?.rating ?? defaultElo;

  const getTier = (rating: number) => {
    if (totalFindings === 0 || rating >= 1500)
      return {
        label: 'Zero-Trust Grade A',
        color: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/30',
        glow: 'from-emerald-600/20 to-teal-600/20',
      };
    if (rating >= 1800)
      return {
        label: 'Grandmaster Elite',
        color: 'text-purple-400 border-purple-500/40 bg-purple-950/30',
        glow: 'from-purple-600/20 to-indigo-600/20',
      };
    if (rating >= 1200)
      return {
        label: 'Intermediate Grade B',
        color: 'text-amber-400 border-amber-500/40 bg-amber-950/30',
        glow: 'from-amber-600/20 to-orange-600/20',
      };
    return {
      label: 'Remediation Required',
      color: 'text-rose-400 border-rose-500/40 bg-rose-950/30',
      glow: 'from-rose-600/20 to-red-600/20',
    };
  };

  const tier = getTier(overallRating);

  const getGaugeColor = (val: number) => {
    if (val >= 85) return '#10b981';
    if (val >= 60) return '#f59e0b';
    return '#f43f5e';
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#1e1611]/95 via-[#18120e]/85 to-[#120e0b]/95 p-5 shadow-2xl backdrop-blur-xl mb-6 scanline-effect shadow-black/60">
      {/* Background Ambient Glow */}
      <div className={`absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br ${tier.glow} blur-3xl pointer-events-none`} />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
        {/* Left: Overall ELO Status & Master Tier */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-[#140e0b] border border-amber-500/35 shadow-inner">
            <ShieldCheck className="h-7 w-7 text-amber-400" />
            <div className="absolute -inset-0.5 rounded-2xl bg-amber-500/20 blur-sm pointer-events-none" />
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-extrabold tracking-tight text-[#fdf8f3] uppercase font-sans">
                Security Operations Center (SOC)
              </h2>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-mono font-semibold ${tier.color} shadow-sm`}>
                {tier.label}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Circular Micro-Gauges & Precision HUD */}
        <div className="flex flex-wrap items-center gap-6">
          {/* Active File Health SVG Gauge */}
          {activeFilePath && (
            <div className="flex items-center gap-3 bg-[#140e0b]/80 border border-amber-900/30 rounded-xl px-3.5 py-2">
              <div className="relative h-12 w-12 flex items-center justify-center">
                <svg className="h-12 w-12 -rotate-90" viewBox="0 0 60 60">
                  <circle
                    cx="30"
                    cy="30"
                    r="24"
                    fill="none"
                    stroke="#2a2018"
                    strokeWidth="4"
                  />
                  <circle
                    cx="30"
                    cy="30"
                    r="24"
                    fill="none"
                    stroke={getGaugeColor(activeFileSecIndex)}
                    strokeWidth="4"
                    strokeDasharray={2 * Math.PI * 24}
                    strokeDashoffset={(2 * Math.PI * 24) * (1 - activeFileSecIndex / 100)}
                    strokeLinecap="round"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>
                <span className="absolute text-[11px] font-black font-mono text-white">
                  {Math.round(activeFileSecIndex)}%
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block font-mono">
                  Active File Health
                </span>
                <span className="text-[11px] font-mono text-stone-300">
                  {activeFileFindingsCount === 0 ? (
                    <span className="text-emerald-400 font-semibold">0 Violations</span>
                  ) : (
                    <span className="text-rose-400 font-semibold">{activeFileFindingsCount} Issue(s)</span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Workspace Security Index SVG Gauge */}
          <div className="flex items-center gap-3 bg-[#140e0b]/80 border border-amber-900/30 rounded-xl px-3.5 py-2">
            <div className="relative h-12 w-12 flex items-center justify-center">
              <svg className="h-12 w-12 -rotate-90" viewBox="0 0 60 60">
                <circle
                  cx="30"
                  cy="30"
                  r="24"
                  fill="none"
                  stroke="#2a2018"
                  strokeWidth="4"
                />
                <circle
                  cx="30"
                  cy="30"
                  r="24"
                  fill="none"
                  stroke={getGaugeColor(workspaceSecIndex)}
                  strokeWidth="4"
                  strokeDasharray={2 * Math.PI * 24}
                  strokeDashoffset={(2 * Math.PI * 24) * (1 - workspaceSecIndex / 100)}
                  strokeLinecap="round"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <span className="absolute text-[11px] font-black font-mono text-white">
                {Math.round(workspaceSecIndex)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block font-mono">
                Workspace Index
              </span>
              <span className="text-[11px] font-mono text-stone-300">
                {totalFindings === 0 ? (
                  <span className="text-emerald-400 font-semibold">0 Total Findings</span>
                ) : (
                  <span className="text-amber-400 font-semibold">{totalFindings} Total Findings</span>
                )}
              </span>
            </div>
          </div>

          {/* Standardized Code Quality Rating Score (1.0 - 10.0 scale) */}
          <div className="bg-[#140e0b]/90 border border-emerald-500/30 rounded-xl px-4 py-2 min-w-[130px] text-right shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block font-mono">
              Quality Score
            </span>
            <div className="flex items-baseline justify-end gap-1 mt-0.5">
              <span className="text-2xl font-black font-mono tracking-tight text-white">
                {totalFindings === 0
                  ? '10.0'
                  : (Math.max(1, Math.min(9.9, (overallRating / 3000) * 10 + 3.5))).toFixed(1)}
              </span>
              <span className="text-[11px] font-mono text-emerald-400 font-bold">/ 10</span>
            </div>
          </div>

          {/* Quality ELO Score Master Metric */}
          <div className="bg-[#140e0b]/90 border border-amber-500/35 rounded-xl px-4 py-2 min-w-[130px] text-right shadow-inner">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block font-mono">
              Quality ELO
            </span>
            <div className="flex items-baseline justify-end gap-1.5 mt-0.5">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <span className="text-2xl font-black font-mono tracking-tight text-white">{overallRating}</span>
              <span className="text-[10px] font-mono text-stone-500">pts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
