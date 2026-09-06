/**
 * GitHub OAuth Authentication helper using Firebase Auth.
 * Requests `repo` scope to enable reading user repositories client-side.
 */
import {
  GithubAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { getAuthInstance, isFirebaseConfigured } from './firebase-init';

export interface GitHubUserSession {
  user: User | null;
  accessToken: string | null;
}

let cachedAccessToken: string | null = typeof window !== 'undefined' ? localStorage.getItem('github_access_token') : null;

export async function signInWithGithub(): Promise<GitHubUserSession | undefined> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured in .env — fill in VITE_FIREBASE_* variables first.');
  }

  const auth = getAuthInstance();
  const provider = new GithubAuthProvider();
  provider.addScope('repo');

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GithubAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken ?? null;
    cachedAccessToken = token;
    if (token) localStorage.setItem('github_access_token', token);

    return {
      user: result.user,
      accessToken: token,
    };
  } catch (err: unknown) {
    const firebaseErr = err as { code?: string; message?: string };
    if (firebaseErr?.code === 'auth/popup-blocked') {
      console.warn('[GitHub Auth] Popup blocked by browser, automatically falling back to full-page redirect...');
      await signInWithRedirect(auth, provider);
      return undefined;
    }
    if (firebaseErr?.code === 'auth/popup-closed-by-user' || firebaseErr?.code === 'auth/cancelled-popup-request') {
      return undefined;
    }
    throw err;
  }
}

export async function signInWithGithubRedirect(): Promise<void> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured in .env.');
  }
  const auth = getAuthInstance();
  const provider = new GithubAuthProvider();
  provider.addScope('repo');
  await signInWithRedirect(auth, provider);
}

export async function signOutGithub(): Promise<void> {
  if (!isFirebaseConfigured) return;
  const auth = getAuthInstance();
  await signOut(auth);
  cachedAccessToken = null;
  localStorage.removeItem('github_access_token');
}

export function subscribeToGitHubAuth(
  callback: (session: GitHubUserSession) => void,
): () => void {
  if (!isFirebaseConfigured) {
    callback({ user: null, accessToken: null });
    return () => {};
  }

  const auth = getAuthInstance();

  // Check redirect result on load
  getRedirectResult(auth)
    .then((result) => {
      if (result) {
        const credential = GithubAuthProvider.credentialFromResult(result);
        const token = credential?.accessToken ?? null;
        if (token) {
          cachedAccessToken = token;
          localStorage.setItem('github_access_token', token);
        }
        callback({
          user: result.user,
          accessToken: cachedAccessToken,
        });
      }
    })
    .catch((err) => {
      console.warn('[GitHub Auth] Redirect result error:', err);
    });

  return onAuthStateChanged(auth, (user) => {
    if (!cachedAccessToken) {
      cachedAccessToken = localStorage.getItem('github_access_token');
    }
    callback({
      user,
      accessToken: cachedAccessToken,
    });
  });
}
