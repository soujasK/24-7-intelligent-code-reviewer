import { useState, useEffect } from 'react';
import {
  fetchUserScanSessions,
  fetchUserCsvRulesSessions,
  type CodeScanHistoryItem,
  type CsvPolicyHistoryItem,
} from '../../firebase/user-session-history';
import {
  FileCode,
  FileSpreadsheet,
  TrendingUp,
  ShieldCheck,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';

export type SessionHistoryItem = CodeScanHistoryItem;

interface SessionHistoryTimelineProps {
  history: CodeScanHistoryItem[];
  csvHistory?: CsvPolicyHistoryItem[];
  userId?: string | null;
}

export function SessionHistoryTimeline({ history, csvHistory = [], userId }: SessionHistoryTimelineProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'code' | 'csv'>('code');
  const [firestoreCodeHistory, setFirestoreCodeHistory] = useState<CodeScanHistoryItem[]>([]);
  const [firestoreCsvHistory, setFirestoreCsvHistory] = useState<CsvPolicyHistoryItem[]>([]);

  useEffect(() => {
    if (userId) {
      void fetchUserScanSessions(userId).then((fetched) => {
        if (fetched.length > 0) setFirestoreCodeHistory(fetched);
      });
      void fetchUserCsvRulesSessions(userId).then((fetched) => {
        if (fetched.length > 0) setFirestoreCsvHistory(fetched);
      });
    } else {
      setFirestoreCodeHistory([]);
      setFirestoreCsvHistory([]);
    }
  }, [userId, history, csvHistory]);

  const displayCodeHistory = [...firestoreCodeHistory, ...history];
  const displayCsvHistory = [...firestoreCsvHistory, ...csvHistory];

  const latestScore = displayCodeHistory[displayCodeHistory.length - 1]?.score ?? 10.0;
  const initialScore = displayCodeHistory[0]?.score ?? 10.0;
  const scoreDiff = latestScore - initialScore;
  const scoreGrowthStr = displayCodeHistory.length > 1
    ? (scoreDiff >= 0 ? `+${scoreDiff.toFixed(1)}` : scoreDiff.toFixed(1))
    : '+0.0';

  const totalSessionsCount = displayCodeHistory.length + displayCsvHistory.length;

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#19120e]/95 to-[#130e0b]/95 p-5 mb-6 text-stone-200 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-950/60 border border-amber-500/30 text-amber-400 shadow-inner">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-sm font-extrabold tracking-tight text-white uppercase font-sans">
                Evaluation History & Growth Timeline
              </h3>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono font-bold border border-emerald-500/30">
                {scoreGrowthStr} Score Growth
              </span>
            </div>
            <p className="text-xs text-stone-400">
              Separated tracking for Code Review Scans and Ingested Historical CSV Policy Datasets.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-xl border border-amber-500/30 bg-[#221812] px-3.5 py-1.5 text-xs font-mono font-medium text-stone-200 hover:text-white hover:bg-amber-950/50 hover:border-amber-500/50 transition-all shadow-sm"
        >
          {isOpen ? 'Hide Timeline' : `View History (${totalSessionsCount} Records)`}
        </button>
      </div>

      {isOpen && (
        <div className="mt-4 pt-4 border-t border-amber-500/15 space-y-4">
          {/* TAB BAR: SEPARATE CODE VS CSV */}
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('code')}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-mono font-bold transition-all border ${
                  activeTab === 'code'
                    ? 'bg-amber-600 text-white border-amber-500/50 shadow-md shadow-amber-950/70'
                    : 'bg-[#1b140f] text-stone-400 hover:text-stone-200 border-white/[0.06]'
                }`}
              >
                <FileCode className="h-3.5 w-3.5" />
                <span>Code Reviews ({displayCodeHistory.length})</span>
              </button>

              <button
                onClick={() => setActiveTab('csv')}
                className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-mono font-bold transition-all border ${
                  activeTab === 'csv'
                    ? 'bg-amber-600 text-white border-amber-500/50 shadow-md shadow-amber-950/70'
                    : 'bg-[#1b140f] text-stone-400 hover:text-stone-200 border-white/[0.06]'
                }`}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>CSV Policy Datasets ({displayCsvHistory.length})</span>
              </button>
            </div>

            <span className="text-[11px] font-mono text-stone-500 hidden sm:inline">
              {activeTab === 'code' ? 'Repository Quality Records' : 'Historical Rule Ingestions'}
            </span>
          </div>

          {/* TAB CONTENT: CODE REVIEWS */}
          {activeTab === 'code' && (
            <div className="space-y-2.5">
              {displayCodeHistory.length === 0 ? (
                <div className="rounded-xl bg-[#140e0b]/90 border border-amber-900/25 p-5 text-center text-xs text-stone-400 font-mono">
                  <ShieldCheck className="h-6 w-6 text-emerald-400 mx-auto mb-2 opacity-80" />
                  No code scan sessions recorded yet. Import a GitHub repository to track quality scores and remediation growth over time.
                </div>
              ) : (
                displayCodeHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl bg-[#150f0c] border border-amber-900/30 px-4 py-3 text-xs font-mono hover:border-amber-500/30 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          item.status === 'passed' ? 'bg-emerald-400 shadow-emerald-500/50 shadow-sm' : 'bg-amber-400 shadow-amber-500/50 shadow-sm'
                        }`}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-100">{item.repoOrFile}</span>
                          <span className="text-stone-500 text-[11px]">({item.fileCount} file(s))</span>
                        </div>
                        <span className="text-[10px] text-stone-400 block mt-0.5">
                          {item.violationsCount === 0 ? 'Verified Zero-Trust' : `${item.violationsCount} Issues Identified`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-stone-400 text-[11px] flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-stone-500" />
                        {item.timestamp}
                      </span>
                      <div className="flex items-baseline gap-1 bg-[#1c1410] border border-amber-500/30 px-3 py-1 rounded-lg">
                        <span className="font-bold font-mono text-emerald-400 text-sm">{item.score.toFixed(1)}</span>
                        <span className="text-[10px] text-stone-500 font-mono">/ 10</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB CONTENT: CSV POLICY DATASETS */}
          {activeTab === 'csv' && (
            <div className="space-y-2.5">
              {displayCsvHistory.length === 0 ? (
                <div className="rounded-xl bg-[#140e0b]/90 border border-amber-900/25 p-5 text-center text-xs text-stone-400 font-mono">
                  <FileSpreadsheet className="h-6 w-6 text-amber-400 mx-auto mb-2 opacity-80" />
                  No CSV policy datasets uploaded yet. Upload a CSV file in schema <code className="text-amber-300">&lt;id&gt;, &lt;type&gt;, &lt;description&gt;</code> to record institutional memory.
                </div>
              ) : (
                displayCsvHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#150f0c] border border-amber-900/30 px-4 py-3 text-xs font-mono hover:border-amber-500/30 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-950/60 border border-indigo-500/30 text-indigo-300">
                        <Layers className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-stone-100">{item.datasetName}</span>
                          <span className="rounded-full bg-indigo-500/20 px-2 py-0.2 text-[10px] text-indigo-300 border border-indigo-500/30 font-semibold">
                            {item.ruleCount} Rules
                          </span>
                        </div>
                        <span className="text-[10px] text-stone-400 block mt-0.5">
                          {item.summary}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-stone-400 text-[11px] flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-stone-500" />
                        {item.timestamp}
                      </span>
                      <div className="flex items-center gap-1 bg-[#1c1410] border border-indigo-500/30 px-2.5 py-1 rounded-lg">
                        <Sparkles className="h-3 w-3 text-indigo-400" />
                        <span className="text-[10px] font-bold text-indigo-300">Active Policy</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
