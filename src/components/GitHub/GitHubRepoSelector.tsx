import { useState, useEffect, useMemo } from 'react';
import {
  signInWithGithub,
  signInWithGithubRedirect,
  signOutGithub,
  subscribeToGitHubAuth,
  type GitHubUserSession,
} from '../../firebase/github-auth';
import { fetchUserRepos, fetchRepoSourceFiles, type GitHubRepo } from '../../github/github-api';
import type { SourceFileInput } from '../../db/ast-loader';
import {
  Key,
  Clipboard,
  Eye,
  EyeOff,
  Globe,
  Lock,
  AlertCircle,
  FolderGit2,
  RefreshCw,
  Search,
  GitBranch,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

function GithubIcon({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

interface GitHubRepoSelectorProps {
  onRepoLoaded: (files: SourceFileInput[], repoName: string) => void;
  disabled?: boolean;
}

export function GitHubRepoSelector({ onRepoLoaded, disabled }: GitHubRepoSelectorProps): JSX.Element {
  const [session, setSession] = useState<GitHubUserSession>({ user: null, accessToken: null });
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState<string>('');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [activeScanningRepo, setActiveScanningRepo] = useState<string | null>(null);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');
  const [isExpanded, setIsExpanded] = useState(true);

  // Manual Token / PAT mode
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [showTokenSecret, setShowTokenSecret] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

  // Manual fallback for public repos when not signed in
  const [publicRepoUrl, setPublicRepoUrl] = useState('');

  const handlePasteToken = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setManualToken(text.trim().replace(/^["']|["']$/g, ''));
      }
    } catch {
      setError('Unable to read clipboard automatically. Please paste manually into the box.');
    }
  };

  const handlePastePublicRepo = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setPublicRepoUrl(text.trim().replace(/^["']|["']$/g, ''));
      }
    } catch {
      setError('Unable to read clipboard automatically. Please paste manually into the box.');
    }
  };

  useEffect(() => {
    return subscribeToGitHubAuth((newSession) => {
      setSession(newSession);
      if (newSession.accessToken) {
        void loadUserRepos(newSession.accessToken);
      } else {
        setRepos([]);
      }
    });
  }, []);

  const loadUserRepos = async (token: string): Promise<void> => {
    setLoadingRepos(true);
    setError(null);
    try {
      const userRepos = await fetchUserRepos(token);
      setRepos(userRepos);
      if (userRepos.length > 0 && userRepos[0]) {
        setSelectedRepoFullName(userRepos[0].full_name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repositories with token');
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleSignIn = async (): Promise<void> => {
    setError(null);
    setIsSigningIn(true);

    const safetyTimer = setTimeout(() => {
      setIsSigningIn(false);
      setError(
        'GitHub OAuth request timed out or popup was closed. You can also use "Personal Access Token (PAT)" or "Public Repo Scan" below for instant zero-setup scanning.',
      );
    }, 15000);

    try {
      const newSession = await signInWithGithub();
      clearTimeout(safetyTimer);
      if (newSession) {
        setSession(newSession);
      }
    } catch (err: unknown) {
      clearTimeout(safetyTimer);
      const firebaseErr = err as { code?: string; message?: string };
      if (firebaseErr?.code === 'auth/operation-not-allowed') {
        setError(
          'GitHub Sign-In is not enabled in Firebase Console for this project. Use "Personal Access Token (PAT)" or "Public Repo Scan" below to scan repos with zero setup.',
        );
      } else if (firebaseErr?.code === 'auth/unauthorized-domain') {
        setError(
          'This domain is not authorized in Firebase Authentication settings. Use "Personal Access Token (PAT)" or "Public Repo Scan" below.',
        );
      } else if (firebaseErr?.code === 'auth/popup-blocked') {
        setError('Popup blocked by browser. You can use page redirect or "Personal Access Token (PAT)".');
      } else if (
        firebaseErr?.code === 'auth/popup-closed-by-user' ||
        firebaseErr?.code === 'auth/cancelled-popup-request'
      ) {
        // Deliberate close
      } else {
        setError(err instanceof Error ? err.message : 'GitHub sign-in failed');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignInRedirect = async (): Promise<void> => {
    setError(null);
    try {
      await signInWithGithubRedirect();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'GitHub redirect sign-in failed');
    }
  };

  const handleApplyManualToken = async (): Promise<void> => {
    const token = manualToken.trim();
    if (!token) {
      setError('Please enter a valid GitHub token (e.g. ghp_...)');
      return;
    }
    setError(null);
    setSession({
      user: { displayName: 'GitHub PAT User', email: 'pat@github' } as unknown as GitHubUserSession['user'],
      accessToken: token,
    });
    await loadUserRepos(token);
  };

  const handleSignOut = async (): Promise<void> => {
    await signOutGithub();
    setSession({ user: null, accessToken: null });
    setRepos([]);
    setSelectedRepoFullName('');
    setManualToken('');
  };

  const handleScanRepo = async (repoFullName: string, defaultBranch?: string): Promise<void> => {
    if (!repoFullName) return;
    const repoObj = repos.find((r) => r.full_name === repoFullName);
    const branch = defaultBranch || repoObj?.default_branch;

    setScanning(true);
    setActiveScanningRepo(repoFullName);
    setError(null);
    setProgressText(`Fetching file tree for ${repoFullName}...`);

    try {
      const parts = repoFullName.split('/');
      const owner = parts[0] ?? '';
      const repoName = parts[1] ?? '';

      const files = await fetchRepoSourceFiles(
        session.accessToken || undefined,
        owner,
        repoName,
        branch,
        50,
        (current, total, path) => {
          setProgressText(`Streaming file ${current}/${total}: ${path}`);
        },
      );

      if (files.length === 0) {
        setError(`No supported source code files (.py, .ts, .tsx, .js, .cpp, .h) found in ${repoFullName}`);
      } else {
        setSelectedRepoFullName(repoFullName);
        onRepoLoaded(files, repoFullName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan repository');
    } finally {
      setScanning(false);
      setActiveScanningRepo(null);
      setProgressText('');
    }
  };

  const handleScanPublicRepo = async (overrideRepo?: string): Promise<void> => {
    const rawTarget = (overrideRepo ?? publicRepoUrl).trim();
    if (!rawTarget) return;

    const parts = rawTarget.replace('https://github.com/', '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      setError('Please enter a valid repo in format: owner/repo (e.g. pallets/flask)');
      return;
    }
    const owner = parts[0];
    const repoName = parts[1].replace(/\.git$/, '');
    await handleScanRepo(`${owner}/${repoName}`);
  };

  // Filtered repositories based on search and visibility
  const filteredRepos = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return repos.filter((r) => {
      if (visibilityFilter === 'public' && r.private) return false;
      if (visibilityFilter === 'private' && !r.private) return false;
      if (q) {
        return r.full_name.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q));
      }
      return true;
    });
  }, [repos, searchQuery, visibilityFilter]);

  const publicCount = repos.filter((r) => !r.private).length;
  const privateCount = repos.filter((r) => r.private).length;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/80 backdrop-blur-xl p-5 mb-6 text-zinc-200 shadow-2xl">
      {/* Top Header / Account Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 border border-white/[0.1] text-zinc-100 shadow-inner">
            <GithubIcon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100 tracking-wide font-sans">
                {session.user ? 'Connected Repositories' : 'Git Repository Ingest'}
              </h3>
              {session.user && (
                <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 font-semibold">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  <span>{session.user.displayName || 'Connected'}</span>
                </span>
              )}
            </div>
            {session.user && (
              <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                Select a project below to import into client-side WebAssembly AST memory.
              </p>
            )}
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2">
          {session.user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded((prev) => !prev)}
                className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all shadow-sm"
              >
                <span>{isExpanded ? 'Collapse Projects' : 'Expand Projects'}</span>
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>

              <button
                onClick={handleSignOut}
                className="rounded-xl border border-white/[0.08] bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-500/30 transition-all shadow-sm"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTokenInput((prev) => !prev)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all shadow-sm ${
                  showTokenInput
                    ? 'border-indigo-500/40 bg-indigo-950/40 text-indigo-300'
                    : 'border-white/[0.08] bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                <Key className="h-3.5 w-3.5" />
                <span>{showTokenInput ? 'Close PAT' : 'Personal Token (PAT)'}</span>
              </button>

              <button
                onClick={handleSignIn}
                disabled={disabled || scanning || isSigningIn}
                className="flex items-center gap-2 rounded-xl bg-white px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 transition-all shadow-md shadow-white/10 font-sans"
              >
                {isSigningIn ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-zinc-950" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <GithubIcon className="h-3.5 w-3.5" />
                    <span>Sign In with GitHub</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Manual Token / PAT Box */}
      {showTokenInput && !session.user && (
        <div className="mt-4 p-4 rounded-xl border border-white/[0.08] bg-zinc-950/90 space-y-3 shadow-inner">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5 font-mono">
              <Key className="h-3.5 w-3.5 text-indigo-400" />
              <span>Personal Access Token (PAT)</span>
            </span>
            <span className="text-[11px] font-mono text-zinc-500">Requires `repo` scope for private repositories</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showTokenSecret ? 'text' : 'password'}
                placeholder="Paste token: ghp_... or github_pat_..."
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value.trim())}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted) {
                    e.preventDefault();
                    setManualToken(pasted.trim().replace(/^["']|["']$/g, ''));
                  }
                }}
                className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 pr-10 pl-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowTokenSecret((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                title={showTokenSecret ? 'Hide Token' : 'Show Token'}
              >
                {showTokenSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={handlePasteToken}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all"
              title="Paste from clipboard"
            >
              <Clipboard className="h-3.5 w-3.5" />
              <span>Paste</span>
            </button>
            <button
              type="button"
              onClick={handleApplyManualToken}
              disabled={!manualToken.trim() || loadingRepos}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition-all shadow-md shadow-indigo-600/30"
            >
              {loadingRepos ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FolderGit2 className="h-3.5 w-3.5" />}
              <span>{loadingRepos ? 'Connecting...' : 'Load Repos'}</span>
            </button>
          </div>
        </div>
      )}

      {/* RENDER-STYLE PROJECT SELECTION HUB (WHEN LOGGED IN) */}
      {session.user && isExpanded && (
        <div className="mt-4 space-y-3.5">
          {/* Search and Visibility Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-950/70 p-2.5 rounded-xl border border-white/[0.06]">
            {/* Search Bar */}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Search your repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 pr-3 pl-9 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-zinc-500"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setVisibilityFilter('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-mono font-medium transition-all ${
                  visibilityFilter === 'all'
                    ? 'bg-zinc-800 text-white border border-white/[0.1]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All ({repos.length})
              </button>
              <button
                onClick={() => setVisibilityFilter('public')}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-mono font-medium transition-all ${
                  visibilityFilter === 'public'
                    ? 'bg-zinc-800 text-white border border-white/[0.1]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Globe className="h-3 w-3 text-zinc-400" />
                <span>Public ({publicCount})</span>
              </button>
              <button
                onClick={() => setVisibilityFilter('private')}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-mono font-medium transition-all ${
                  visibilityFilter === 'private'
                    ? 'bg-zinc-800 text-white border border-white/[0.1]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Lock className="h-3 w-3 text-zinc-400" />
                <span>Private ({privateCount})</span>
              </button>
            </div>
          </div>

          {/* Render-Style Project Rows List */}
          {loadingRepos ? (
            <div className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-8 text-center text-xs text-indigo-400 font-mono flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Fetching repositories from GitHub...</span>
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-zinc-950/40 p-8 text-center text-xs text-zinc-500 font-mono">
              {repos.length === 0
                ? 'No repositories found in your account.'
                : `No repositories match "${searchQuery}".`}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
              {filteredRepos.map((repo) => {
                const isCurrentActive = selectedRepoFullName === repo.full_name;
                const isScanningThis = scanning && activeScanningRepo === repo.full_name;

                return (
                  <div
                    key={repo.id}
                    className={`rounded-xl border p-3.5 transition-all flex flex-col justify-between gap-3 ${
                      isCurrentActive
                        ? 'border-indigo-500/50 bg-indigo-950/20 shadow-lg shadow-indigo-950/30'
                        : 'border-white/[0.06] bg-zinc-950/60 hover:bg-zinc-900/80 hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <FolderGit2 className="h-4 w-4 text-indigo-400 shrink-0" />
                          <span className="font-bold text-xs text-zinc-100 font-mono truncate">
                            {repo.full_name}
                          </span>
                        </div>

                        {repo.private ? (
                          <span className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-white/[0.06] shrink-0">
                            <Lock className="h-2.5 w-2.5" />
                            <span>Private</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/60 text-zinc-400 border border-white/[0.06] shrink-0">
                            <Globe className="h-2.5 w-2.5" />
                            <span>Public</span>
                          </span>
                        )}
                      </div>

                      {repo.description && (
                        <p className="text-[11px] text-zinc-400 line-clamp-1 font-sans">
                          {repo.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.04] text-[10px] font-mono text-zinc-500">
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3 text-zinc-400" />
                        <span>{repo.default_branch || 'main'}</span>
                      </span>

                      <button
                        onClick={() => handleScanRepo(repo.full_name, repo.default_branch)}
                        disabled={disabled || scanning}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition-all shadow-sm ${
                          isScanningThis
                            ? 'bg-indigo-700 text-white animate-pulse'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        } disabled:opacity-40`}
                      >
                        {isScanningThis ? (
                          <>
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            <span>Importing...</span>
                          </>
                        ) : (
                          <>
                            <span>Connect & Scan</span>
                            <ArrowRight className="h-3 w-3" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Repository Input & Quick Selection Bar (Available for both Signed-In and Guest Users) */}
      <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-300 font-bold font-sans flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-indigo-400" />
            <span>{session.user ? 'Import Connected Repository (Public & Private)' : 'Import Repository (Public & Private)'}</span>
          </span>
          {session.user && (
            <span className="text-[11px] font-mono text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>{repos.filter((r) => r.private).length} Private / {repos.filter((r) => !r.private).length} Public Repos Loaded</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Select Dropdown (Unconditionally visible, prioritizing Private Repositories) */}
          <select
            value={publicRepoUrl}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__action_signin__') {
                void handleSignIn();
                return;
              }
              if (val === '__action_pat__') {
                setShowTokenInput(true);
                return;
              }
              setPublicRepoUrl(val);
              if (val) {
                const found = repos.find((r) => r.full_name === val);
                if (found) {
                  void handleScanRepo(val, found.default_branch);
                } else {
                  void handleScanPublicRepo(val);
                }
              }
            }}
            disabled={disabled || scanning || loadingRepos}
            className="rounded-xl border border-indigo-500/40 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[230px] shrink-0 font-semibold cursor-pointer hover:border-indigo-400 shadow-lg shadow-indigo-950/40"
          >
            <option value="">Choose Repository (Public/Private)</option>
            {repos.length > 0 ? (
              <>
                {repos.filter((r) => r.private).length > 0 && (
                  <optgroup label={`🔒 PRIVATE REPOSITORIES (${repos.filter((r) => r.private).length})`}>
                    {repos
                      .filter((r) => r.private)
                      .map((r) => (
                        <option key={r.id} value={r.full_name}>
                          🔒 {r.full_name} (Private)
                        </option>
                      ))}
                  </optgroup>
                )}
                {repos.filter((r) => !r.private).length > 0 && (
                  <optgroup label={`🌐 PUBLIC REPOSITORIES (${repos.filter((r) => !r.private).length})`}>
                    {repos
                      .filter((r) => !r.private)
                      .map((r) => (
                        <option key={r.id} value={r.full_name}>
                          🌐 {r.full_name}
                        </option>
                      ))}
                  </optgroup>
                )}
              </>
            ) : (
              <>
                {!session.user && (
                  <optgroup label="🔒 Private Repository Access">
                    <option value="__action_signin__">🔒 Click to Sign In with GitHub (Load Private Repos)</option>
                    <option value="__action_pat__">🔑 Enter Personal Access Token (PAT)</option>
                  </optgroup>
                )}
                <optgroup label="🌐 Featured Public Sample Repos">
                  <option value="pallets/flask">🌐 pallets/flask (Python)</option>
                  <option value="fastapi/fastapi">🌐 fastapi/fastapi (Python)</option>
                  <option value="facebook/react">🌐 facebook/react (TypeScript)</option>
                  <option value="expressjs/express">🌐 expressjs/express (JavaScript)</option>
                </optgroup>
              </>
            )}
          </select>

          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Enter repository path: owner/repo (e.g. your-name/private-repo or pallets/flask)"
              value={publicRepoUrl}
              onChange={(e) => setPublicRepoUrl(e.target.value.trim())}
              disabled={disabled || scanning}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScanPublicRepo();
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted) {
                  e.preventDefault();
                  setPublicRepoUrl(pasted.trim().replace(/^["']|["']$/g, ''));
                }
              }}
              className="w-full rounded-xl border border-white/[0.08] bg-zinc-950 pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono shadow-inner"
            />
          </div>

          <button
            type="button"
            onClick={handlePastePublicRepo}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-all"
            title="Paste from clipboard"
          >
            <Clipboard className="h-3.5 w-3.5" />
            <span>Paste</span>
          </button>

          <button
            onClick={() => handleScanPublicRepo()}
            disabled={disabled || scanning || !publicRepoUrl.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40 transition-all shadow-md shadow-indigo-600/30 font-sans"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>Scan Repo</span>
          </button>
        </div>
      </div>

      {/* Progress Status */}
      {scanning && (
        <div className="mt-4 text-xs font-mono text-indigo-300 flex items-center gap-2 bg-indigo-950/40 p-3 rounded-xl border border-indigo-500/30 shadow-inner">
          <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
          <span>{progressText}</span>
        </div>
      )}

      {/* Error Display & Fallback Action */}
      {error && (
        <div className="mt-4 text-xs text-rose-300 bg-rose-950/40 border border-rose-500/30 p-4 rounded-xl flex flex-col gap-2.5 shadow-sm">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold text-rose-200">Repository Notice</span>
              <p className="text-rose-300/90 leading-relaxed">{error}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1 pt-2 border-t border-rose-500/20">
            <span className="text-zinc-400 text-[11px] font-mono">Quick Options:</span>
            {error.includes('Popup') && (
              <button
                onClick={handleSignInRedirect}
                className="rounded-lg bg-zinc-800 border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 transition-all font-mono"
              >
                Try Sign-In Redirect
              </button>
            )}
            <button
              onClick={() => setShowTokenInput(true)}
              className="flex items-center gap-1 rounded-lg bg-indigo-950/80 border border-indigo-500/40 px-2.5 py-1 text-[11px] text-indigo-200 hover:bg-indigo-900 transition-all font-mono"
            >
              <Key className="h-3 w-3" />
              <span>Use Personal Token (PAT)</span>
            </button>
            <button
              onClick={() => {
                setPublicRepoUrl('pallets/flask');
                void handleScanPublicRepo('pallets/flask');
              }}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 transition-all font-mono"
            >
              <Globe className="h-3 w-3" />
              <span>Scan Public Demo (pallets/flask)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
