/**
 * Lazily initializes web-tree-sitter and caches compiled Language grammars.
 * All .wasm assets are served from /public/wasm (see project file tree) so
 * they're fetched same-origin with no CDN dependency — required for the
 * Zero-Trust "nothing proprietary leaves the browser" story to hold even
 * for the parser itself.
 *
 * Targets web-tree-sitter@^0.22 API surface (Parser.init / Parser.Language.load /
 * parser.setLanguage). If you upgrade past the 0.23 module-export rewrite,
 * update the import + Language.load call sites here only — nothing else in
 * the codebase touches the tree-sitter API directly.
 */
import Parser from 'web-tree-sitter';
import type { SupportedLanguage } from '../types/ast';

const WASM_BASE = '/wasm';

const GRAMMAR_PATHS: Record<SupportedLanguage, string> = {
  python: `${WASM_BASE}/tree-sitter-python.wasm`,
  cpp: `${WASM_BASE}/tree-sitter-cpp.wasm`,
};

let coreInitPromise: Promise<void> | null = null;
const languageCache = new Map<SupportedLanguage, Parser.Language>();

async function ensureCoreInitialized(): Promise<void> {
  if (!coreInitPromise) {
    coreInitPromise = Parser.init({
      locateFile: (fileName: string) => `${WASM_BASE}/${fileName}`,
    });
  }
  await coreInitPromise;
}

async function loadLanguage(language: SupportedLanguage): Promise<Parser.Language> {
  const cached = languageCache.get(language);
  if (cached) return cached;

  const response = await fetch(GRAMMAR_PATHS[language]);
  if (!response.ok) {
    throw new Error(`Failed to fetch grammar for ${language}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const lang = await Parser.Language.load(bytes);
  languageCache.set(language, lang);
  return lang;
}

/** Returns a fresh Parser instance bound to the requested grammar. Parsers
 *  are cheap (no wasm re-instantiation — the compiled Language is cached);
 *  callers should create one per parse() call rather than sharing across
 *  concurrent parses, since Parser.parse() is not re-entrant. */
export async function getParser(language: SupportedLanguage): Promise<Parser> {
  await ensureCoreInitialized();
  const lang = await loadLanguage(language);
  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

export async function parseSource(source: string, language: SupportedLanguage): Promise<Parser.Tree> {
  const parser = await getParser(language);
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error(`tree-sitter returned no tree for language=${language}`);
  }
  return tree;
}
