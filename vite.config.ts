import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// COOP/COEP make the page "cross-origin isolated", which is what unlocks
// SharedArrayBuffer — required for fuzzer-client.ts's interrupt-buffer TLE
// path (src/workers/fuzzer.worker.ts). Without these headers the app still
// runs, but FuzzerClient silently falls back to hard-terminate-only timeout
// enforcement (see the `supportsSharedMemory` check there).
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  optimizeDeps: {
    // duckdb-wasm and pyodide both publish a real "module"/exports.import
    // entry point (native ESM) and ship their own wasm-loading glue that
    // Vite's dep pre-bundler mishandles if it tries to re-process them —
    // excluded so they're served as-authored.
    //
    // web-tree-sitter is NOT excluded: it's CommonJS-only (no "module" or
    // "exports" field, just "main"), so it needs Vite's esbuild pre-bundle
    // pass to get CJS->ESM interop and a `default` export at all. Verified
    // by running the app: excluding it produces
    // "does not provide an export named 'default'" at runtime in the
    // browser, since the raw CJS file is then served unconverted.
    exclude: ['@duckdb/duckdb-wasm', 'pyodide'],
  },
});
