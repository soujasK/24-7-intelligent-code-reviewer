/**
 * Firestore-backed rule store + developer public-key registry.
 *
 * Collections:
 *   rules/{id}          -> RawPolicyRule + { source: 'seed'|'distilled', createdAt }
 *   meta/rule_counter   -> { nextId: number }  (transactional id allocation)
 *   users/{uid}         -> { publicKeyJwk, skillMatrix }  (see elo-engine.ts)
 *   users/{uid}/history -> per-submission outcomes
 */
import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, type Unsubscribe,
} from 'firebase/firestore';
import { getDb } from './firebase-init';
import type { RawPolicyRule } from '../types/rules';
import type { DistilledRule } from '../types/institutional-memory';

function toRawPolicyRule(data: Record<string, unknown>): RawPolicyRule {
  return { id: Number(data.id), type: String(data.type), description: String(data.description) };
}

/** One-shot fetch — used to seed the CSV-to-SQL compiler at session start. */
export async function fetchRules(): Promise<RawPolicyRule[]> {
  const snap = await getDocs(query(collection(getDb(), 'rules'), orderBy('id', 'asc')));
  return snap.docs.map((d) => toRawPolicyRule(d.data()));
}

/** Live subscription — the swarm's rule library updates immediately when
 *  the institutional-memory loop commits a new distilled rule, with no
 *  reload needed for other sessions watching the same project. */
export function subscribeToRules(onChange: (rules: RawPolicyRule[]) => void): Unsubscribe {
  const q = query(collection(getDb(), 'rules'), orderBy('id', 'asc'));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => toRawPolicyRule(d.data()))));
}

/** Transactionally allocates the next integer rule id and commits the
 *  distilled rule. Called from the main thread after
 *  institutional-memory.worker.ts produces a DistilledRule — that worker
 *  stays Firebase-free by design (see its file header). */
export async function commitDistilledRule(distilled: DistilledRule): Promise<RawPolicyRule> {
  const counterRef = doc(getDb(), 'meta', 'rule_counter');
  return runTransaction(getDb(), async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const nextId = (counterSnap.data()?.nextId as number | undefined) ?? 1;
    tx.set(counterRef, { nextId: nextId + 1 }, { merge: true });

    const rule: RawPolicyRule = { id: nextId, type: distilled.type, description: distilled.description };
    tx.set(doc(getDb(), 'rules', String(nextId)), { ...rule, source: 'distilled', createdAt: serverTimestamp() });
    return rule;
  });
}

// ---- developer public-key registry (TOFU trust anchor for audit receipts) ----

export async function registerPublicKey(uid: string, jwk: JsonWebKey): Promise<void> {
  await setDoc(doc(getDb(), 'users', uid), { publicKeyJwk: jwk }, { merge: true });
}

export async function getPublicKeyForUser(uid: string): Promise<JsonWebKey | null> {
  const snap = await getDoc(doc(getDb(), 'users', uid));
  return (snap.data()?.publicKeyJwk as JsonWebKey | undefined) ?? null;
}

/**
 * PRODUCTION NOTE: an LLM-backed distiller/remediator must never hold an
 * LLM API key in client code. The real integration point is a Firebase
 * Callable Function:
 *
 *   import { getFunctions, httpsCallable } from 'firebase/functions';
 *   const distillWithLlm = httpsCallable(getFunctions(firebaseApp), 'distillCorrection');
 *   const { data } = await distillWithLlm({ anonymizedSkeleton, rejectedText, replacementText });
 *
 * The Function holds the provider key server-side, receives only the
 * already-anonymized skeleton (never raw source), and returns a
 * DistilledRule shaped payload — same contract as the local heuristic in
 * institutional-memory.worker.ts, so callers can swap one for the other
 * without touching swarm-orchestrator.ts.
 */
