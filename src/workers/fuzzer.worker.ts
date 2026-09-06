/**
 * fuzzer.worker.ts — CP-style verdict engine running untrusted Python inside
 * Pyodide, isolated in its own Web Worker.
 *
 * TLE strategy (two layers, both required):
 *   1. Cooperative: pyodide.setInterruptBuffer() over a SharedArrayBuffer.
 *      CPython's eval loop polls the interrupt flag between bytecode
 *      instructions, so a pure-Python infinite loop raises KeyboardInterrupt
 *      almost immediately after the HOST writes a 2 into the buffer. This
 *      requires the timer to live on a *different* thread than the one
 *      running Python — this worker's own JS thread is blocked for the
 *      duration of a synchronous solve() call, so it cannot arm its own
 *      timeout. That responsibility belongs to the caller (see
 *      fuzzer-client.ts), which owns the SharedArrayBuffer and the setTimeout.
 *   2. Preemptive: if the interrupt never lands (SharedArrayBuffer
 *      unavailable because the page isn't cross-origin-isolated, or a
 *      blocking native call that never checks the signal flag), the host
 *      hard-kills this worker via Worker.terminate() and respawns a fresh
 *      one. That path never touches this file — terminate() is a stop-the-
 *      world kill, there's no handler to write here — but the RUN protocol
 *      is designed so the host can safely do it: every RUN is idempotent
 *      and a fresh worker just re-INITs.
 */
import { loadPyodide, type PyodideInterface } from 'pyodide';
import type {
  FuzzerInboundMessage,
  FuzzerOutboundMessage,
  FuzzTestCase,
  TestVerdict,
  VerdictStatus,
} from '../types/verdicts';

declare const self: DedicatedWorkerGlobalScope;

const DEFAULT_ENTRY_POINT = 'solve';
let pyodide: PyodideInterface | null = null;
let interruptBuffer: Uint8Array | null = null;
const pyodideReady: Promise<PyodideInterface> = initPyodide();

async function initPyodide(): Promise<PyodideInterface> {
  const instance = await loadPyodide({
    // Assets copied from node_modules/pyodide into /public/pyodide by
    // scripts/copy-pyodide-assets.mjs (see package.json "postinstall").
    indexURL: '/pyodide/',
  });
  pyodide = instance;
  post({ type: 'READY' });
  return instance;
}

function post(message: FuzzerOutboundMessage): void {
  self.postMessage(message);
}

function currentHeapBytes(): number {
  // Emscripten's growable WASM linear memory buffer. Monotonic within a
  // pyodide instance (memory is never returned to the OS), so we track
  // deltas rather than absolutes.
  const heap: ArrayBufferLike | undefined = (pyodide as unknown as { HEAPU8?: Uint8Array })?.HEAPU8?.buffer;
  return heap?.byteLength ?? 0;
}

function classifyError(err: unknown): { status: VerdictStatus; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('KeyboardInterrupt')) return { status: 'TLE', message: 'execution interrupted: time limit exceeded' };
  if (message.includes('MemoryError') || message.includes('out of memory')) {
    return { status: 'MLE', message: 'allocation failed: memory limit exceeded' };
  }
  // Trim to the most useful tail of the Python traceback for the UI.
  const trimmed = message.split('\n').slice(-6).join('\n');
  return { status: 'RE', message: trimmed };
}

/** Loose structural equality: numeric comparisons use a relative epsilon so
 *  floating point CP answers (e.g. geometry, probability) aren't flagged WA
 *  on ULP noise. */
function structurallyEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= 1e-6 * scale;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => structurallyEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
    return aKeys.every((k) => structurallyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return Object.is(a, b);
}

async function runSingleCase(
  instance: PyodideInterface,
  entryPoint: string,
  testCase: FuzzTestCase,
  memoryBudgetBytes: number,
): Promise<TestVerdict> {
  const heapBefore = currentHeapBytes();
  const startedAt = performance.now();

  // PyProxy handles created for this call — always destroyed in `finally`
  // so a leaked reference can't masquerade as an MLE on the *next* test.
  const proxies: Array<{ destroy: () => void }> = [];

  try {
    const solveFn = instance.globals.get(entryPoint);
    if (typeof solveFn !== 'function') {
      return { testId: testCase.id, status: 'RE', runtimeMs: 0, heapDeltaBytes: 0, error: `entry point "${entryPoint}" is not callable` };
    }

    let result: unknown;
    if (Array.isArray(testCase.input)) {
      const pyArgs = testCase.input.map((arg) => {
        const converted = instance.toPy(arg);
        if (converted && typeof (converted as { destroy?: unknown }).destroy === 'function') {
          proxies.push(converted as { destroy: () => void });
        }
        return converted;
      });
      result = solveFn(...pyArgs);
    } else {
      const kwargs = instance.toPy(testCase.input);
      if (kwargs && typeof (kwargs as { destroy?: unknown }).destroy === 'function') {
        proxies.push(kwargs as { destroy: () => void });
      }
      result = solveFn.callKwargs(kwargs);
    }

    let jsResult: unknown = result;
    if (result && typeof (result as { toJs?: unknown }).toJs === 'function') {
      const proxyResult = result as { toJs: (opts?: unknown) => unknown; destroy: () => void };
      jsResult = proxyResult.toJs({ dict_converter: Object.fromEntries });
      proxies.push(proxyResult);
    }

    const runtimeMs = performance.now() - startedAt;
    const heapDeltaBytes = currentHeapBytes() - heapBefore;

    if (heapDeltaBytes > memoryBudgetBytes) {
      return { testId: testCase.id, status: 'MLE', runtimeMs, heapDeltaBytes, actual: jsResult };
    }
    const status: VerdictStatus = structurallyEqual(jsResult, testCase.expected) ? 'AC' : 'WA';
    return { testId: testCase.id, status, runtimeMs, heapDeltaBytes, actual: jsResult };
  } catch (err) {
    const runtimeMs = performance.now() - startedAt;
    const heapDeltaBytes = currentHeapBytes() - heapBefore;
    const { status, message } = classifyError(err);
    return { testId: testCase.id, status, runtimeMs, heapDeltaBytes, error: message };
  } finally {
    for (const proxy of proxies) {
      try { proxy.destroy(); } catch { /* already GC'd/destroyed */ }
    }
    // Clear any interrupt this test consumed so the next test starts clean.
    if (interruptBuffer) interruptBuffer[0] = 0;
  }
}

async function handleRun(msg: Extract<FuzzerInboundMessage, { type: 'RUN' }>): Promise<void> {
  const instance = await pyodideReady;
  const startedAt = performance.now();
  const verdicts: TestVerdict[] = [];

  try {
    instance.runPython(msg.code);
  } catch (err) {
    const { message } = classifyError(err);
    post({ type: 'FATAL_ERROR', runId: msg.runId, message: `code failed to load: ${message}` });
    return;
  }

  const entryPoint = msg.entryPoint ?? DEFAULT_ENTRY_POINT;
  for (const testCase of msg.testCases) {
    const verdict = await runSingleCase(instance, entryPoint, testCase, msg.memoryBudgetBytes);
    verdicts.push(verdict);
    post({ type: 'VERDICT', runId: msg.runId, verdict });
  }

  post({
    type: 'RUN_COMPLETE',
    runId: msg.runId,
    summary: {
      runId: msg.runId,
      totalMs: performance.now() - startedAt,
      passed: verdicts.filter((v) => v.status === 'AC').length,
      failed: verdicts.filter((v) => v.status !== 'AC').length,
      verdicts,
    },
  });
}

self.onmessage = async (event: MessageEvent<FuzzerInboundMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'INIT': {
        interruptBuffer = new Uint8Array(msg.interruptBuffer);
        const instance = await pyodideReady;
        instance.setInterruptBuffer(interruptBuffer);
        break;
      }
      case 'RUN':
        await handleRun(msg);
        break;
      case 'ABORT':
        // No-op at the worker level: the host enforces ABORT by writing the
        // interrupt buffer (soft) or calling terminate() (hard). Kept in the
        // message union for symmetry / future cooperative cleanup hooks.
        break;
    }
  } catch (err) {
    post({ type: 'FATAL_ERROR', message: err instanceof Error ? err.message : String(err) });
  }
};
