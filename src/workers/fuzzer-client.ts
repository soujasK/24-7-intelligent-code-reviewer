/**
 * fuzzer-client.ts — main-thread (or orchestrator-worker) controller for
 * fuzzer.worker.ts. This is where hard timeouts actually get ENFORCED: the
 * worker running Python cannot time itself out (its JS thread is blocked
 * synchronously inside the Python call), so this controller runs on a
 * separate thread, owns the shared interrupt buffer, and is the thing that
 * calls Worker.terminate() when even the interrupt doesn't land.
 *
 * Usage:
 *   const client = new FuzzerClient();
 *   const summary = await client.run({ code, testCases }, (verdict) => {...});
 *
 * Caught at runtime, not review: the first version armed test case #1's
 * timeout the instant run() was called — before the worker had even
 * finished loading Pyodide (a multi-second, one-time wasm+stdlib fetch).
 * Every run's first case TLE'd on a cold worker regardless of how trivial
 * the code was. Timeouts now only start once the worker reports READY, and
 * a respawned worker (after a genuine TLE) is handed the *remaining* test
 * cases explicitly — the earlier version silently abandoned them, since a
 * freshly spawned worker has no idea a run was in progress.
 */
import type {
  FuzzerInboundMessage,
  FuzzerOutboundMessage,
  FuzzTestCase,
  RunSummary,
  TestVerdict,
} from '../types/verdicts';

const SIGINT = 2;
/** Extra grace after a soft interrupt before we conclude the worker is
 *  truly wedged (native call ignoring the signal flag) and hard-kill it. */
const HARD_KILL_GRACE_MS = 250;
const DEFAULT_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024; // 256MB
/** One-time budget for Pyodide's cold start (wasm + stdlib fetch/compile).
 *  Separate from any test case's timeoutMs — this is judge infrastructure
 *  startup, not solution runtime. */
const WORKER_BOOT_TIMEOUT_MS = 30_000;

export interface FuzzRunOptions {
  code: string;
  testCases: FuzzTestCase[];
  entryPoint?: string;
  memoryBudgetBytes?: number;
}

type VerdictListener = (verdict: TestVerdict) => void;

interface ActiveRun {
  runId: string;
  resolve: (summary: RunSummary) => void;
  reject: (err: Error) => void;
  onVerdict?: VerdictListener;
  code: string;
  entryPoint?: string;
  memoryBudgetBytes: number;
  testCases: FuzzTestCase[];
  cursor: number;
  verdicts: TestVerdict[];
}

export class FuzzerClient {
  private worker!: Worker;
  private interruptView: Uint8Array | null = null;
  private readonly supportsSharedMemory: boolean;

  private ready!: Promise<void>;
  private resolveReady!: () => void;

  private softTimer: ReturnType<typeof setTimeout> | null = null;
  private hardTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRun: ActiveRun | null = null;

  constructor() {
    this.supportsSharedMemory =
      typeof SharedArrayBuffer !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
    this.spawnWorker();
  }

  private spawnWorker(): void {
    this.worker = new Worker(new URL('./fuzzer.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FuzzerOutboundMessage>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => this.handleWorkerCrash(event.message);

    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    if (this.supportsSharedMemory) {
      const sab = new SharedArrayBuffer(1);
      this.interruptView = new Uint8Array(sab);
      this.post({ type: 'INIT', interruptBuffer: sab });
    }
    // Without SharedArrayBuffer, TLE enforcement degrades to hard-kill-only:
    // the page isn't cross-origin-isolated, so cooperative interrupt is
    // unavailable and every timeout pays the full worker-respawn cost.
  }

  /** Resolves once this worker generation has Pyodide loaded, or rejects
   *  after WORKER_BOOT_TIMEOUT_MS so a broken deployment (e.g. missing
   *  /pyodide/ assets) fails fast instead of hanging every run forever. */
  private async awaitReady(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Pyodide worker did not become ready within the boot timeout')), WORKER_BOOT_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.ready, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private post(message: FuzzerInboundMessage): void {
    this.worker.postMessage(message);
  }

  private clearTimers(): void {
    if (this.softTimer) clearTimeout(this.softTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    this.softTimer = null;
    this.hardTimer = null;
  }

  private armTimeoutFor(testCase: FuzzTestCase): void {
    this.clearTimers();
    this.softTimer = setTimeout(() => {
      if (this.interruptView) {
        Atomics.store(this.interruptView, 0, SIGINT);
      }
      // Whether or not the soft interrupt lands, arm the hard kill. If the
      // worker responds with a VERDICT in time, clearTimers() cancels this.
      this.hardTimer = setTimeout(() => void this.forceTimeoutCurrentCase(testCase), HARD_KILL_GRACE_MS);
    }, testCase.timeoutMs);
  }

  private async forceTimeoutCurrentCase(testCase: FuzzTestCase): Promise<void> {
    const run = this.activeRun;
    if (!run) return;

    this.emitVerdict(run, {
      testId: testCase.id,
      status: 'TLE',
      runtimeMs: testCase.timeoutMs + HARD_KILL_GRACE_MS,
      heapDeltaBytes: 0,
      error: 'worker did not respond to interrupt; terminated and respawned',
    });

    // The worker is presumed wedged (e.g. a blocking native call). There is
    // no graceful recovery from inside a hung wasm instance — terminate,
    // respawn, and hand the fresh worker whatever test cases are left.
    run.cursor += 1;
    this.worker.terminate();
    this.spawnWorker();
    await this.resumeOnFreshWorker(run);
  }

  private async handleWorkerCrash(message: string): Promise<void> {
    const run = this.activeRun;
    if (!run) return;
    const testCase = run.testCases[run.cursor];
    if (testCase) {
      this.emitVerdict(run, {
        testId: testCase.id,
        status: 'RE',
        runtimeMs: 0,
        heapDeltaBytes: 0,
        error: `worker crashed: ${message}`,
      });
      run.cursor += 1;
    }
    this.spawnWorker();
    await this.resumeOnFreshWorker(run);
  }

  /** Sends whatever test cases remain (from run.cursor onward) to the
   *  current — just-(re)spawned — worker as a brand new RUN batch. Verdicts
   *  still match back to `run` purely by runId, so the worker doesn't need
   *  to know anything about the batch it's replacing. */
  private async resumeOnFreshWorker(run: ActiveRun): Promise<void> {
    if (run.cursor >= run.testCases.length) {
      this.finishRun(run);
      return;
    }
    try {
      await this.awaitReady();
    } catch (err) {
      this.activeRun = null;
      run.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (this.activeRun !== run) return; // superseded while we were awaiting readiness

    this.post({
      type: 'RUN',
      runId: run.runId,
      code: run.code,
      entryPoint: run.entryPoint,
      testCases: run.testCases.slice(run.cursor),
      memoryBudgetBytes: run.memoryBudgetBytes,
    });
    const nextCase = run.testCases[run.cursor];
    if (nextCase) this.armTimeoutFor(nextCase);
  }

  private emitVerdict(run: ActiveRun, verdict: TestVerdict): void {
    run.verdicts.push(verdict);
    run.onVerdict?.(verdict);
  }

  private finishRun(run: ActiveRun): void {
    this.clearTimers();
    const summary: RunSummary = {
      runId: run.runId,
      totalMs: run.verdicts.reduce((sum, v) => sum + v.runtimeMs, 0),
      passed: run.verdicts.filter((v) => v.status === 'AC').length,
      failed: run.verdicts.filter((v) => v.status !== 'AC').length,
      verdicts: run.verdicts,
    };
    this.activeRun = null;
    run.resolve(summary);
  }

  /** Normal-path advance: the SAME worker instance is already processing
   *  its internal test-case loop (see fuzzer.worker.ts's handleRun), so
   *  unlike resumeOnFreshWorker() this never re-sends a RUN message —
   *  it only arms the next timeout. */
  private advance(run: ActiveRun): void {
    run.cursor += 1;
    if (run.cursor >= run.testCases.length) {
      this.finishRun(run);
      return;
    }
    const nextCase = run.testCases[run.cursor];
    if (!nextCase) return; // unreachable given the bounds check above
    this.armTimeoutFor(nextCase);
  }

  private handleMessage(message: FuzzerOutboundMessage): void {
    switch (message.type) {
      case 'READY':
        this.resolveReady();
        return;
      case 'VERDICT': {
        const run = this.activeRun;
        if (!run || message.runId !== run.runId) return;
        this.clearTimers();
        this.emitVerdict(run, message.verdict);
        this.advance(run);
        return;
      }
      case 'RUN_COMPLETE':
        // advance() already resolved once cursor exhausted; RUN_COMPLETE
        // from the worker is a secondary confirmation, safe to ignore here.
        return;
      case 'FATAL_ERROR': {
        const run = this.activeRun;
        if (!run) return;
        this.clearTimers();
        this.activeRun = null;
        run.reject(new Error(message.message));
        return;
      }
    }
  }

  /** Runs a full CP-fuzz batch against one code submission. Resolves once
   *  every test case has a verdict (AC/TLE/MLE/WA/RE) — never rejects on a
   *  per-test failure, only on infrastructure failure (e.g. code wouldn't
   *  even load, or Pyodide never became ready). */
  async run(options: FuzzRunOptions, onVerdict?: VerdictListener): Promise<RunSummary> {
    if (this.activeRun) {
      throw new Error('FuzzerClient does not support concurrent runs; queue at the call site.');
    }
    await this.awaitReady(); // exclude Pyodide's cold start from every test's timeout budget

    const runId = crypto.randomUUID();
    return new Promise<RunSummary>((resolve, reject) => {
      const run: ActiveRun = {
        runId,
        resolve,
        reject,
        onVerdict,
        code: options.code,
        entryPoint: options.entryPoint,
        memoryBudgetBytes: options.memoryBudgetBytes ?? DEFAULT_MEMORY_BUDGET_BYTES,
        testCases: options.testCases,
        cursor: 0,
        verdicts: [],
      };
      this.activeRun = run;
      this.post({
        type: 'RUN',
        runId,
        code: run.code,
        entryPoint: run.entryPoint,
        testCases: run.testCases,
        memoryBudgetBytes: run.memoryBudgetBytes,
      });
      const firstCase = options.testCases[0];
      if (firstCase) this.armTimeoutFor(firstCase);
      else this.finishRun(run);
    });
  }

  dispose(): void {
    this.clearTimers();
    this.worker.terminate();
  }
}
