import { useState, useEffect, useRef, useMemo } from 'react';
import { FindingsPanel } from './components/Dashboard/FindingsPanel';
import { GitHubRepoSelector } from './components/GitHub/GitHubRepoSelector';
import { AgentSwarmPanel } from './components/Dashboard/AgentSwarmPanel';
import { EloRatingCard } from './components/Dashboard/EloRatingCard';
import { HistoricalCsvUploader } from './components/Dashboard/HistoricalCsvUploader';
import { SessionHistoryTimeline } from './components/Dashboard/SessionHistoryTimeline';
import { BlastRadiusGraph } from './components/Graph/BlastRadiusGraph';
import { ChatbotPanel } from './components/Chat/ChatbotPanel';
import { useSwarmOrchestrator } from './state/swarm-orchestrator';
import { generateSecurityReportCsv, downloadCsvReport } from './utils/csv-exporter';
import type { RawPolicyRule } from './types/rules';
import type { FuzzTestCase, TestVerdict } from './types/verdicts';
import type { SourceFileInput } from './db/ast-loader';
import { subscribeToGitHubAuth, type GitHubUserSession } from './firebase/github-auth';
import { saveUserScanSession, saveUserCsvRulesSession, type CsvPolicyHistoryItem } from './firebase/user-session-history';
import { calculateCodeQualityScore } from './utils/quality-score';
import type { SessionHistoryItem } from './components/Dashboard/SessionHistoryTimeline';

import {
  ShieldCheck,
  Download,
  Search,
  X,
  Layers,
  Network,
} from 'lucide-react';

const CLEAN_STARTER_FILE = `# Python Zero-Trust Sandbox
def solve(n):
    """Clean entry point for AST parsing & property testing."""
    return n * 2

if __name__ == "__main__":
    print(solve(5))
`;



const SAMPLE_TEST_CASES: FuzzTestCase[] = [
  { id: 'n=3', input: [3], expected: 8, timeoutMs: 2000 },
  { id: 'n=0', input: [0], expected: 0, timeoutMs: 2000 },
];

const DEMO_ISSUER = 'shishir.kudchadker@gmail.com';

type WorkspaceViewMode = 'mesh' | 'graph' | 'audit';

export default function App(): JSX.Element {
  const { state, submit, runFuzz, attest, requestRemediation, reset } = useSwarmOrchestrator();
  const [activeFiles, setActiveFiles] = useState<SourceFileInput[]>([
    { path: 'main.py', language: 'python', content: CLEAN_STARTER_FILE },
  ]);
  const [activeRules, setActiveRules] = useState<RawPolicyRule[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');
  const [verdicts, setVerdicts] = useState<TestVerdict[]>([]);
  const [activeRepoName, setActiveRepoName] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('mesh');

  // User Auth & Session History Tracking (Separated for Code Scans & CSV Datasets)
  const [session, setSession] = useState<GitHubUserSession>({ user: null, accessToken: null });
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryItem[]>([]);
  const [csvHistory, setCsvHistory] = useState<CsvPolicyHistoryItem[]>([]);

  useEffect(() => {
    return subscribeToGitHubAuth((newSession) => setSession(newSession));
  }, []);

  const currentFile = activeFiles[selectedFileIndex] ?? activeFiles[0] ?? { path: 'main.py', language: 'python', content: '' };
  const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error';

  const filteredFileEntries = useMemo(() => {
    const q = fileSearchQuery.toLowerCase().trim();
    return activeFiles
      .map((file, originalIdx) => ({ file, originalIdx }))
      .filter(({ file }) => !q || file.path.toLowerCase().includes(q));
  }, [activeFiles, fileSearchQuery]);

  const runFullAgentPipeline = async (
    files: SourceFileInput[],
    repoName: string | null,
    rulesToUse = activeRules,
    recordHistory = false,
  ): Promise<void> => {
    setActiveRepoName(repoName);
    setActiveFiles(files);
    setSelectedFileIndex(0);
    setVerdicts([]);

    // Step 1: Submit to AST grounder & 3 Pod Workers with historical rules
    const scanResult = await submit(files, rulesToUse);

    // Step 2: Run CP-Fuzz Gate ONLY if primary Python file defines solve() entry point
    const primaryPython = files.find((f) => f.language === 'python' && f.content.includes('def solve('));
    let currentVerdicts: TestVerdict[] = [];
    if (primaryPython) {
      try {
        await runFuzz(primaryPython.content, SAMPLE_TEST_CASES, (v) => {
          currentVerdicts = [...currentVerdicts, v];
          setVerdicts((prev) => [...prev, v]);
        });
      } catch (fuzzErr) {
        console.warn('[Fuzzer Gate] Skipped fuzzing due to code signature mismatch:', fuzzErr);
      }
    }

    // Step 3: Sign ECDSA Audit Receipt
    try {
      await attest({
        submissionId: scanResult.submissionId,
        fileShas: scanResult.asts.map((a) => a.sourceFile.sha256),
        ruleSetVersion: 'v1.0-swarm',
        issuer: DEMO_ISSUER,
      });
    } catch (attestErr) {
      console.warn('[Attestor Agent] Attestation receipt bypassed:', attestErr);
    }

    // Step 4: Record Session History ONLY on full scan/repo ingest runs, not rule config
    if (recordHistory) {
      const quality = calculateCodeQualityScore(scanResult.violations, state.findings, currentVerdicts);
      const newSessionItem: SessionHistoryItem = {
        id: `session-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        repoOrFile: repoName ?? files[0]?.path ?? 'Workspace Code',
        fileCount: files.length,
        score: quality.score,
        violationsCount: scanResult.violations.length + state.findings.length,
        status: quality.score >= 7.5 ? 'passed' : 'review_required',
      };

      setSessionHistory((prev) => [...prev, newSessionItem]);

      if (session.user?.uid) {
        void saveUserScanSession(session.user.uid, newSessionItem);
      }
    }
  };

  const handleResetWorkspace = (): void => {
    reset();
    setActiveFiles([{ path: 'main.py', language: 'python', content: CLEAN_STARTER_FILE }]);
    setSelectedFileIndex(0);
    setActiveRules([]);
    setActiveRepoName(null);
    setVerdicts([]);
  };

  const handleRulesLoaded = async (newRules: RawPolicyRule[], datasetName?: string): Promise<void> => {
    setActiveRules(newRules);

    // Record institutional CSV rule dataset in dedicated CSV history tab & Firestore
    const uniqueTypes = [...new Set(newRules.map((r) => r.type))];
    const newCsvItem: CsvPolicyHistoryItem = {
      id: `csv-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      datasetName: datasetName ?? 'Uploaded CSV Policy Dataset',
      ruleCount: newRules.length,
      ruleTypes: uniqueTypes,
      summary: `${newRules.length} review rules active (${uniqueTypes.slice(0, 3).join(', ')}${uniqueTypes.length > 3 ? '...' : ''})`,
    };

    setCsvHistory((prev) => [...prev, newCsvItem]);

    if (session.user?.uid) {
      void saveUserCsvRulesSession(session.user.uid, newCsvItem);
    }

    await runFullAgentPipeline(activeFiles, activeRepoName, newRules, false);
  };

  const handleClearRules = async (): Promise<void> => {
    setActiveRules([]);
    if (activeFiles.length === 1 && activeFiles[0]?.path === 'main.py' && activeFiles[0]?.content === CLEAN_STARTER_FILE) {
      reset();
      setVerdicts([]);
    } else {
      await runFullAgentPipeline(activeFiles, activeRepoName, [], false);
    }
  };

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCodeChange = (newCode: string): void => {
    setActiveFiles((prev) =>
      prev.map((f, i) => (i === selectedFileIndex ? { ...f, content: newCode } : f)),
    );
    if (state.phase !== 'idle') {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void submit(
          activeFiles.map((f, i) => (i === selectedFileIndex ? { ...f, content: newCode } : f)),
          activeRules,
        );
      }, 900);
    }
  };

  const handleGitHubRepoLoaded = async (files: SourceFileInput[], repoName: string): Promise<void> => {
    await runFullAgentPipeline(files, repoName, activeRules, true);
  };

  const handleExportCsv = (): void => {
    const csvData = generateSecurityReportCsv({
      repoName: activeRepoName,
      violations: state.violations,
      findings: state.findings,
      verdicts,
      filePaths,
    });
    const filename = `zero-trust-report-${(activeRepoName ?? 'workspace').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    downloadCsvReport(filename, csvData);
  };

  const handleSelectNodeInEditor = (filePath: string): void => {
    const foundIndex = activeFiles.findIndex((f) => f.path === filePath || f.path.endsWith(filePath));
    if (foundIndex >= 0) {
      setSelectedFileIndex(foundIndex);
    }
  };

  const totalFindings = state.violations.length + state.findings.length;
  const totalErrors = state.violations.filter((v) => v.severity === 'error').length + state.findings.filter((f) => f.severity === 'error').length;
  const totalWarns = state.violations.filter((v) => v.severity === 'warn').length + state.findings.filter((f) => f.severity === 'warn').length;

  const activeFileViolations = state.violations.filter((v) => v.fileId === selectedFileIndex);
  const activeFileFindings = state.findings.filter((f) => f.fileId === selectedFileIndex);
  const activeFileErrors = activeFileViolations.filter((v) => v.severity === 'error').length + activeFileFindings.filter((f) => f.severity === 'error').length;
  const activeFileWarns = activeFileViolations.filter((v) => v.severity === 'warn').length + activeFileFindings.filter((f) => f.severity === 'warn').length;

  const filePaths = activeFiles.map((f) => f.path);

  const handleSelectFileAndLine = (fileIndex: number, _line?: number): void => {
    if (fileIndex >= 0 && fileIndex < activeFiles.length) {
      setSelectedFileIndex(fileIndex);
    }
  };

  return (
    <div className="min-h-screen cyber-bg cyber-grid text-stone-100 p-4 sm:p-6 font-sans">
      {/* GLOBAL COMMAND NAVBAR */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/20 bg-[#17120e]/85 px-4 py-3 backdrop-blur-2xl shadow-2xl shadow-black/60">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-600 via-amber-500 to-orange-500 text-white shadow-lg shadow-amber-600/30">
            <ShieldCheck className="h-5 w-5" />
            <div className="absolute -inset-1 rounded-xl bg-amber-500/20 blur-sm pointer-events-none" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-[#fdf8f3] uppercase font-mono">
                24/7 Intelligent Code Review
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/35 font-semibold shadow-sm">
                Zero-Trust Mesh v2.0
              </span>
            </div>
          </div>
        </div>

        {/* WORKSPACE VIEW MODE SWITCHER TABS */}
        <div className="flex items-center rounded-xl border border-amber-500/20 bg-[#1f1712]/90 p-1 shadow-inner">
          <button
            onClick={() => setViewMode('mesh')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              viewMode === 'mesh'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-950/70'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/40'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Defense Mesh</span>
          </button>
          <button
            onClick={() => setViewMode('graph')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              viewMode === 'graph'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-950/70'
                : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/40'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            <span>Blast Radius Graph</span>
          </button>
        </div>

        {/* CONTROLS & ACTION BUTTONS */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Export Report */}
          <button
            onClick={handleExportCsv}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-[#1e1712]/80 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-[#2a1f18] hover:text-white disabled:opacity-40 transition-all cursor-pointer shadow-sm"
            title="Export Zero-Trust Compliance & Audit Report (CSV)"
          >
            <Download className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </header>

      {/* GITHUB INGESTION COMPONENT */}
      <GitHubRepoSelector onRepoLoaded={handleGitHubRepoLoaded} disabled={busy} />

      {/* MISSION CONTROL HUD: CIRCULAR METRICS & QUALITY SCORE */}
      <EloRatingCard
        skillMatrix={null}
        scannedFilesCount={activeFiles.length}
        totalFindings={totalFindings}
        errorCount={totalErrors}
        warnCount={totalWarns}
        activeFilePath={currentFile.path}
        activeFileFindingsCount={activeFileViolations.length + activeFileFindings.length}
        activeFileErrors={activeFileErrors}
        activeFileWarns={activeFileWarns}
      />

      {/* HISTORICAL REVIEW DATA CSV INGESTION ENGINE */}
      <HistoricalCsvUploader
        onRulesLoaded={handleRulesLoaded}
        onClearRules={handleClearRules}
        currentRuleCount={activeRules.length}
      />

      {/* DEVELOPER GROWTH & SESSION HISTORY TIMELINE (SEPARATED FOR CODE SCANS & CSV RULES) */}
      <SessionHistoryTimeline history={sessionHistory} csvHistory={csvHistory} userId={session.user?.uid} />

      {/* VIEW 1: DEFENSE MESH & SWARM WORKSPACE */}
      {viewMode === 'mesh' && (
        <div className="space-y-6">
          {/* Autonomous Swarm Pods */}
          <AgentSwarmPanel
            phase={state.phase}
            violations={state.violations}
            findings={state.findings}
            verdicts={verdicts}
            hasReceipt={Boolean(state.receipt)}
            filePaths={filePaths}
            onSelectFileAndLine={handleSelectFileAndLine}
          />

          {/* 2-Column Split: Code Studio vs Triage Findings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Code Studio & File Switcher */}
            <section className="space-y-3">
              {/* Workspace File Actions & Selector (Multi-File / Ingested Repositories Only) */}
              {activeFiles.length > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1 bg-[#17120e]/60 p-2.5 rounded-2xl border border-amber-500/15">
                  <div className="flex flex-wrap items-center gap-2 flex-1">
                    <div className="relative flex items-center">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-stone-500" />
                      <input
                        type="text"
                        placeholder="Search files..."
                        value={fileSearchQuery}
                        onChange={(e) => setFileSearchQuery(e.target.value)}
                        className="w-32 sm:w-40 rounded-xl border border-amber-500/20 bg-[#1c1510]/90 pr-6 pl-7 py-1 text-xs text-stone-200 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder:text-stone-500 shadow-inner"
                      />
                      {fileSearchQuery && (
                        <button
                          onClick={() => setFileSearchQuery('')}
                          className="absolute right-2 text-xs text-stone-400 hover:text-white"
                          title="Clear search"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto flex-1 max-w-full">
                      {filteredFileEntries.map(({ file, originalIdx }) => {
                        const fileViolationsCount = state.violations.filter((v) => v.fileId === originalIdx).length;
                        const fileFindingsCount = state.findings.filter((f) => f.fileId === originalIdx).length;
                        const totalFileIssues = fileViolationsCount + fileFindingsCount;

                        return (
                          <button
                            key={file.path}
                            onClick={() => setSelectedFileIndex(originalIdx)}
                            className={`rounded-xl px-3 py-1 text-xs font-mono transition-all flex items-center gap-1.5 whitespace-nowrap shadow-sm ${
                              originalIdx === selectedFileIndex
                                ? 'bg-amber-600 text-white font-semibold shadow-md shadow-amber-950/60'
                                : 'bg-[#1e1712]/90 border border-amber-900/20 text-stone-400 hover:text-stone-200 hover:bg-[#2a1f18]'
                            }`}
                            title={file.path}
                          >
                            <span>{file.path}</span>
                            {totalFileIssues > 0 && (
                              <span
                                className={`rounded-full px-1.5 py-0.2 text-[9px] font-mono font-bold ${
                                  fileViolationsCount > 0
                                    ? 'bg-rose-950 text-rose-300 border border-rose-500/30'
                                    : 'bg-amber-950 text-amber-300 border border-amber-500/30'
                                }`}
                              >
                                {totalFileIssues}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={handleResetWorkspace}
                      className="rounded-xl border border-amber-900/30 bg-[#221812] px-2.5 py-1 text-xs font-mono text-stone-400 hover:text-rose-300 hover:bg-rose-950/40 hover:border-rose-500/30 transition-all shrink-0"
                      title="Reset to clean single file"
                    >
                      Reset Clean
                    </button>
                  </div>
                </div>
              )}

              <ChatbotPanel
                code={currentFile.content}
                filePath={currentFile.path}
                onChangeCode={handleCodeChange}
                violations={state.violations.filter((v) => v.fileId === selectedFileIndex)}
                findings={state.findings.filter((f) => f.fileId === selectedFileIndex)}
                activeRules={activeRules}
                busy={busy}
                repoName={activeRepoName}
                allFiles={activeFiles}
              />
            </section>

            {/* Right: Security Findings & Triage */}
            <section className="space-y-6">
              <div>
                <FindingsPanel
                  violations={state.violations}
                  findings={state.findings}
                  filePaths={filePaths}
                  onRequestRemediation={requestRemediation}
                  onSelectFileAndLine={handleSelectFileAndLine}
                />
              </div>
            </section>
          </div>
        </div>
      )}

      {/* VIEW 2: FULL-BLEED BLAST RADIUS GRAPH */}
      {viewMode === 'graph' && (
        <div className="space-y-4">
          <BlastRadiusGraph
            asts={state.asts}
            violations={state.violations}
            findings={state.findings}
            focusedFilePath={currentFile.path}
            onSelectNodeInEditor={handleSelectNodeInEditor}
            onRequestRemediation={requestRemediation}
          />
        </div>
      )}

    </div>
  );
}

