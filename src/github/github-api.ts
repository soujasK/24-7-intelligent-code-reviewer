/**
 * Client-side GitHub REST API service.
 * Fetches user repositories, file trees, and source code content directly
 * into browser memory for Wasm Tree-Sitter & DuckDB static analysis.
 */
import type { SupportedLanguage } from '../types/ast';
import type { SourceFileInput } from '../db/ast-loader';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  default_branch: string;
  private: boolean;
  html_url: string;
  description: string | null;
}

export interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
  url: string;
}

const SUPPORTED_EXTENSIONS: Record<string, SupportedLanguage> = {
  // Python
  py: 'python',
  pyw: 'python',
  // C / C++
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  c: 'cpp',
  hpp: 'cpp',
  h: 'cpp',
  // TypeScript & JavaScript (mapped to Wasm C-like structural grammar)
  ts: 'cpp',
  tsx: 'cpp',
  js: 'cpp',
  jsx: 'cpp',
  mjs: 'cpp',
  cjs: 'cpp',
};

export function getSupportedLanguage(filename: string): SupportedLanguage | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? (SUPPORTED_EXTENSIONS[ext] ?? null) : null;
}

function buildHeaders(token?: string, raw = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.v3.raw' : 'application/vnd.github.v3+json',
  };
  if (token && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

export async function fetchUserRepos(token: string): Promise<GitHubRepo[]> {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: buildHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
  }

  const data = (await res.json()) as GitHubRepo[];
  return data;
}

export async function fetchRepoInfo(token: string | undefined, owner: string, repo: string): Promise<GitHubRepo> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const res = await fetch(url, {
    headers: buildHeaders(token),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(`GitHub authorization error (401). If using a token, ensure it is valid.`);
    }
    if (res.status === 404) {
      throw new Error(`Repository "${owner}/${repo}" not found (404). Check spelling or repository access.`);
    }
    throw new Error(`Failed to fetch repo metadata (${res.status}): ${res.statusText}`);
  }

  return (await res.json()) as GitHubRepo;
}

export async function fetchRepoTree(
  token: string | undefined,
  owner: string,
  repo: string,
  branch?: string,
): Promise<{ tree: GitHubTreeItem[]; branch: string }> {
  // First, if branch not provided, try to fetch repo metadata to get default_branch
  let targetBranch = branch?.trim();
  if (!targetBranch) {
    try {
      const info = await fetchRepoInfo(token, owner, repo);
      targetBranch = info.default_branch || 'main';
    } catch {
      targetBranch = 'main';
    }
  }

  const tryBranch = async (b: string): Promise<Response> => {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${b}?recursive=1`;
    return await fetch(url, { headers: buildHeaders(token) });
  };

  let res = await tryBranch(targetBranch);
  let resolvedBranch = targetBranch;

  if (!res.ok && res.status === 404) {
    // Try fallback branches (master, main, HEAD)
    const candidates = ['master', 'main', 'HEAD'].filter((b) => b !== targetBranch);
    for (const cand of candidates) {
      const fallbackRes = await tryBranch(cand);
      if (fallbackRes.ok) {
        res = fallbackRes;
        resolvedBranch = cand;
        break;
      }
    }
  }

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(`GitHub API rate limit exceeded (403). Paste a GitHub Personal Access Token (PAT) for 5,000 req/hr.`);
    }
    if (res.status === 401) {
      throw new Error(`GitHub authorization error (401). Please verify sign-in credentials.`);
    }
    if (res.status === 404) {
      throw new Error(`Repository "${owner}/${repo}" not found or branch inaccessible (404).`);
    }
    throw new Error(`Failed to fetch repo file tree (${res.status}): ${res.statusText}`);
  }

  const data = (await res.json()) as { tree?: GitHubTreeItem[]; truncated?: boolean };
  if (!data.tree || !Array.isArray(data.tree)) {
    return { tree: [], branch: resolvedBranch };
  }

  const filtered = data.tree.filter((item) => item.type === 'blob' && getSupportedLanguage(item.path) !== null);
  return { tree: filtered, branch: resolvedBranch };
}

export async function fetchFileContent(
  token: string | undefined,
  owner: string,
  repo: string,
  path: string,
  branch = 'main',
): Promise<string> {
  // If unauthenticated (no token), use raw.githubusercontent.com CDN (NO rate limit!)
  if (!token || token.trim().length === 0) {
    const branchesToTry = [branch, 'master', 'main', 'HEAD'].filter((b, idx, arr) => arr.indexOf(b) === idx);
    for (const b of branchesToTry) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${path}`;
        const rawRes = await fetch(rawUrl);
        if (rawRes.ok) {
          return await rawRes.text();
        }
      } catch {
        // Continue to next branch fallback
      }
    }
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: buildHeaders(token, true),
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(`GitHub API rate limit exceeded (403). Paste a GitHub Personal Access Token (PAT) to get 5,000 req/hr.`);
    }
    throw new Error(`Failed to fetch ${path} (${res.status})`);
  }

  return res.text();
}

export async function fetchRepoSourceFiles(
  token: string | undefined,
  owner: string,
  repo: string,
  branch?: string,
  maxFiles = 50,
  onProgress?: (current: number, total: number, currentPath: string) => void,
): Promise<SourceFileInput[]> {
  const { tree: treeItems, branch: resolvedBranch } = await fetchRepoTree(token, owner, repo, branch);
  const targetItems = treeItems.slice(0, maxFiles);
  const sourceFiles: SourceFileInput[] = [];

  for (let i = 0; i < targetItems.length; i++) {
    const item = targetItems[i];
    if (!item) continue;

    const language = getSupportedLanguage(item.path);
    if (!language) continue;

    if (onProgress) {
      onProgress(i + 1, targetItems.length, item.path);
    }

    try {
      const content = await fetchFileContent(token, owner, repo, item.path, resolvedBranch);
      sourceFiles.push({
        path: item.path,
        language,
        content,
      });
    } catch (err) {
      console.warn(`Skipped ${item.path}:`, err);
    }
  }

  return sourceFiles;
}
