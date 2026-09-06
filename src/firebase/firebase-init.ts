/**
 * Single Firebase App instance for the tab. Every other firebase/* module
 * gets auth/db/functions through the lazy getters below — never calls
 * getAuth()/initializeFirestore()/getFunctions() itself.
 *
 * Caught at runtime: getAuth() validates the API key's FORMAT synchronously
 * and throws immediately if it's missing/malformed — unlike initializeApp(),
 * which just stores config and never throws. With no .env configured (the
 * project is explicitly designed to demo the engine layer without Firebase
 * set up), calling getAuth() at module load crashed the entire bundle
 * before a single button existed to click, since every Firebase-adjacent
 * module (llm-remediation.ts -> swarm-orchestrator.ts -> App.tsx) sits on
 * one import chain. Every service is constructed lazily now, only when
 * something actually tries to use it — so an unconfigured Firebase project
 * fails exactly one specific action, not the whole app.
 */
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** True once .env actually has real Firebase values. Every getter below
 *  checks this before touching the SDK, so the rest of the app can render
 *  and run (scan/fuzz/attest — none of which touch Firebase) with none of
 *  this filled in. */
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const useEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

// initializeApp() itself only stores config — it does not validate against
// Firebase's servers or even check the key's shape, so this is always safe.
export const firebaseApp = initializeApp(firebaseConfig);

function requireConfigured(): void {
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase is not configured — fill in .env from .env.example before using auth, ' +
        'Firestore, or the LLM remediation Cloud Functions.',
    );
  }
}

let authInstance: Auth | null = null;
export function getAuthInstance(): Auth {
  requireConfigured();
  if (!authInstance) {
    authInstance = getAuth(firebaseApp);
    if (useEmulator) connectAuthEmulator(authInstance, 'http://localhost:9099');
  }
  return authInstance;
}

let dbInstance: Firestore | null = null;
export function getDb(): Firestore {
  requireConfigured();
  if (!dbInstance) {
    // ignoreUndefinedProperties: violation/finding objects are built from
    // optional fields across pods; letting `undefined` through would
    // otherwise throw at write time instead of just omitting the field.
    dbInstance = initializeFirestore(firebaseApp, { ignoreUndefinedProperties: true });
    if (useEmulator) connectFirestoreEmulator(dbInstance, 'localhost', 8080);
  }
  return dbInstance;
}

let functionsInstance: Functions | null = null;
export function getFunctionsInstance(): Functions {
  requireConfigured();
  if (!functionsInstance) {
    functionsInstance = getFunctions(firebaseApp);
    if (useEmulator) connectFunctionsEmulator(functionsInstance, 'localhost', 5001);
  }
  return functionsInstance;
}

let analyticsInstance: Analytics | null = null;
export async function getAnalyticsInstance(): Promise<Analytics | null> {
  requireConfigured();
  if (!analyticsInstance && (await isSupported())) {
    analyticsInstance = getAnalytics(firebaseApp);
  }
  return analyticsInstance;
}

