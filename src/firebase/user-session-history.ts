/**
 * Firestore helper for persisting user scan session history and CSV policy dataset history.
 * Stores and retrieves separated history records per authenticated user.
 */
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from './firebase-init';

export interface CodeScanHistoryItem {
  id: string;
  timestamp: string;
  repoOrFile: string;
  fileCount: number;
  score: number; // 1.0 - 10.0
  violationsCount: number;
  status: 'passed' | 'review_required';
}

export interface CsvPolicyHistoryItem {
  id: string;
  timestamp: string;
  datasetName: string;
  ruleCount: number;
  ruleTypes: string[];
  summary: string;
}

// 1. Code Review Scan Sessions
export async function saveUserScanSession(
  uid: string,
  sessionData: Omit<CodeScanHistoryItem, 'id' | 'timestamp'>,
): Promise<string | null> {
  if (!isFirebaseConfigured || !uid) return null;

  try {
    const db = getDb();
    const userScansRef = collection(db, 'users', uid, 'code_scans');

    const docRef = await addDoc(userScansRef, {
      ...sessionData,
      createdAt: serverTimestamp(),
      timestampStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    return docRef.id;
  } catch (err) {
    console.warn('[Firestore History] Failed to save code scan session:', err);
    return null;
  }
}

export async function fetchUserScanSessions(uid: string): Promise<CodeScanHistoryItem[]> {
  if (!isFirebaseConfigured || !uid) return [];

  try {
    const db = getDb();
    const userScansRef = collection(db, 'users', uid, 'code_scans');
    const q = query(userScansRef, orderBy('createdAt', 'desc'), limit(20));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        timestamp: data.timestampStr || 'Recent',
        repoOrFile: data.repoOrFile || 'Workspace Code',
        fileCount: data.fileCount || 1,
        score: typeof data.score === 'number' ? data.score : 7.0,
        violationsCount: data.violationsCount || 0,
        status: data.status || 'passed',
      };
    });
  } catch (err) {
    console.warn('[Firestore History] Failed to fetch code scan sessions:', err);
    return [];
  }
}

// 2. CSV Policy Dataset Ingestions
export async function saveUserCsvRulesSession(
  uid: string,
  csvData: Omit<CsvPolicyHistoryItem, 'id' | 'timestamp'>,
): Promise<string | null> {
  if (!isFirebaseConfigured || !uid) return null;

  try {
    const db = getDb();
    const userCsvRef = collection(db, 'users', uid, 'csv_policy_history');

    const docRef = await addDoc(userCsvRef, {
      ...csvData,
      createdAt: serverTimestamp(),
      timestampStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    return docRef.id;
  } catch (err) {
    console.warn('[Firestore History] Failed to save CSV policy history:', err);
    return null;
  }
}

export async function fetchUserCsvRulesSessions(uid: string): Promise<CsvPolicyHistoryItem[]> {
  if (!isFirebaseConfigured || !uid) return [];

  try {
    const db = getDb();
    const userCsvRef = collection(db, 'users', uid, 'csv_policy_history');
    const q = query(userCsvRef, orderBy('createdAt', 'desc'), limit(20));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        timestamp: data.timestampStr || 'Recent',
        datasetName: data.datasetName || 'Custom CSV Policy Dataset',
        ruleCount: data.ruleCount || 0,
        ruleTypes: Array.isArray(data.ruleTypes) ? data.ruleTypes : [],
        summary: data.summary || `${data.ruleCount || 0} active policy rules`,
      };
    });
  } catch (err) {
    console.warn('[Firestore History] Failed to fetch CSV policy sessions:', err);
    return [];
  }
}
