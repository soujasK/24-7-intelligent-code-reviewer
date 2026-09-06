/** CP-style fuzzing verdict types shared between fuzzer.worker.ts and the UI. */

export type VerdictStatus = 'AC' | 'TLE' | 'MLE' | 'WA' | 'RE';

export interface FuzzTestCase {
  id: string;
  /** Positional args (array) or kwargs (object) passed to the entry point. */
  input: unknown[] | Record<string, unknown>;
  expected: unknown;
  timeoutMs: number;
  /** Optional per-case override; falls back to the run's global budget. */
  memoryBudgetBytes?: number;
}

export interface TestVerdict {
  testId: string;
  status: VerdictStatus;
  runtimeMs: number;
  heapDeltaBytes: number;
  actual?: unknown;
  error?: string;
}

export interface RunSummary {
  runId: string;
  totalMs: number;
  passed: number;
  failed: number;
  verdicts: TestVerdict[];
}

// ---- Worker <-> host message contracts ----

export type FuzzerInboundMessage =
  | { type: 'INIT'; interruptBuffer: SharedArrayBuffer }
  | {
      type: 'RUN';
      runId: string;
      code: string;
      entryPoint?: string;
      testCases: FuzzTestCase[];
      memoryBudgetBytes: number;
    }
  | { type: 'ABORT'; runId: string };

export type FuzzerOutboundMessage =
  | { type: 'READY' }
  | { type: 'VERDICT'; runId: string; verdict: TestVerdict }
  | { type: 'RUN_COMPLETE'; runId: string; summary: RunSummary }
  | { type: 'FATAL_ERROR'; runId?: string; message: string };
