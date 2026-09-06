/**
 * Developer ELO + per-category skill matrix, persisted to
 * users/{uid}.skillMatrix and appended to users/{uid}/history.
 *
 * Standard chess-style Elo update against a fixed "task difficulty"
 * opponent rating — the same mechanism, applied to "did this submission
 * clear the gate" instead of "did you win the game". A 1200 baseline with
 * a 1400 task difficulty means a developer who's exactly at the bar treads
 * water; consistently clean submissions climb toward ~1700+, repeated
 * violations of the same rule type drag that category's rating down even
 * while the overall rating holds steady — that's the "anti-pattern
 * reduction over time" signal the blueprint asks for.
 */
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDb } from './firebase-init';
import type { PolicyViolation } from '../types/rules';
import type { TestVerdict } from '../types/verdicts';

export interface EloRecord {
  rating: number;
  gamesPlayed: number;
}

export type SkillMatrix = Record<string, EloRecord>;

const K_FACTOR = 24;
const DEFAULT_RATING = 1200;
const TASK_DIFFICULTY_RATING = 1400;
const MIN_RATING = 400;
const MAX_RATING = 3000;

export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

export function computeEloUpdate(current: EloRecord, outcome: 'pass' | 'fail', opponentRating = TASK_DIFFICULTY_RATING): EloRecord {
  const actualScore = outcome === 'pass' ? 1 : 0;
  const expected = expectedScore(current.rating, opponentRating);
  const rawRating = current.rating + K_FACTOR * (actualScore - expected);
  return {
    rating: Math.round(Math.min(MAX_RATING, Math.max(MIN_RATING, rawRating))),
    gamesPlayed: current.gamesPlayed + 1,
  };
}

/**
 * Updates 'overall' plus one category per distinct rule TYPE that produced
 * an error-severity violation this submission (a 'fail' signal for that
 * category). Categories never touched by a violation are left as-is —
 * this repo doesn't yet track which rules were *applicable but passed*
 * per submission, so it can only move a category down on infraction, not
 * up on demonstrated-clean exposure. Documented simplification, not an
 * oversight: extending PolicyViolation-less rule evaluation to emit
 * explicit passes is the natural next step.
 */
export async function recordSubmissionOutcome(
  uid: string,
  submissionId: string,
  violations: readonly PolicyViolation[],
  cpVerdicts: readonly TestVerdict[],
): Promise<SkillMatrix> {
  const userRef = doc(getDb(), 'users', uid);
  const snap = await getDoc(userRef);
  const existing: SkillMatrix = (snap.data()?.skillMatrix as SkillMatrix | undefined) ?? {};

  const violatedTypes = [...new Set(violations.filter((v) => v.severity === 'error').map((v) => v.ruleType))];
  const allTestsPassed = cpVerdicts.length === 0 || cpVerdicts.every((v) => v.status === 'AC');
  const overallOutcome: 'pass' | 'fail' = violatedTypes.length === 0 && allTestsPassed ? 'pass' : 'fail';

  const next: SkillMatrix = { ...existing };
  next.overall = computeEloUpdate(existing.overall ?? { rating: DEFAULT_RATING, gamesPlayed: 0 }, overallOutcome);
  for (const ruleType of violatedTypes) {
    next[ruleType] = computeEloUpdate(existing[ruleType] ?? { rating: DEFAULT_RATING, gamesPlayed: 0 }, 'fail');
  }

  await setDoc(userRef, { skillMatrix: next }, { merge: true });
  await addDoc(collection(getDb(), 'users', uid, 'history'), {
    submissionId,
    outcome: overallOutcome,
    ratingBefore: existing.overall?.rating ?? DEFAULT_RATING,
    ratingAfter: next.overall.rating,
    violatedRuleTypes: violatedTypes,
    cpSummary: { passed: cpVerdicts.filter((v) => v.status === 'AC').length, total: cpVerdicts.length },
    timestamp: serverTimestamp(),
  });

  return next;
}
