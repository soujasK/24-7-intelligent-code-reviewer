// Runs on `npm install` (see package.json "postinstall"). Vite serves
// /public verbatim, same-origin — copying these here (instead of importing
// them via a CDN) is what lets the Zero-Trust story hold for the parser and
// the Python sandbox themselves, not just the submitted source code.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeModules = join(root, 'node_modules');
const publicDir = join(root, 'public');

function copy(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[copy-wasm-assets] SKIP ${label}: not found at ${src}`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-wasm-assets] copied ${label}`);
}

// --- tree-sitter runtime + grammars -----------------------------------
copy(
  join(nodeModules, 'web-tree-sitter', 'tree-sitter.wasm'),
  join(publicDir, 'wasm', 'tree-sitter.wasm'),
  'tree-sitter runtime',
);
copy(
  join(nodeModules, 'tree-sitter-wasms', 'out', 'tree-sitter-python.wasm'),
  join(publicDir, 'wasm', 'tree-sitter-python.wasm'),
  'python grammar',
);
copy(
  join(nodeModules, 'tree-sitter-wasms', 'out', 'tree-sitter-cpp.wasm'),
  join(publicDir, 'wasm', 'tree-sitter-cpp.wasm'),
  'cpp grammar',
);

// --- pyodide runtime (stdlib zip, .wasm, package lockfile) --------------
copy(join(nodeModules, 'pyodide'), join(publicDir, 'pyodide'), 'pyodide runtime');
