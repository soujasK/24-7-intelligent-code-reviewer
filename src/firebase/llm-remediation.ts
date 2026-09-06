/**
 * Client-side callers for LLM remediation & security assistant.
 * Supports:
 *   1. Direct Gemini REST endpoint (if VITE_GEMINI_API_KEY is configured in .env)
 *   2. Firebase Cloud Functions (if Firebase is deployed / emulators running)
 *   3. Guaranteed Local Rule-Based Heuristic Fallback (Offline / Demo mode)
 */
import { httpsCallable } from 'firebase/functions';
import { getFunctionsInstance, isFirebaseConfigured } from './firebase-init';
import type { RemediationCandidate } from '../types/pods';
import type { PolicyRuleType } from '../types/rules';

const directApiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();

async function callDirectGemini(prompt: string, systemInstruction?: string): Promise<string> {
  if (!directApiKey) throw new Error('No direct Gemini API key configured.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${directApiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Gemini API error (${resp.status}): ${errorText}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response returned from Gemini.');
  return text.trim();
}

function generateFallbackRemediation(findingTitle: string, reason: string): string {
  const t = (findingTitle + ' ' + reason).toLowerCase();

  // 1. I/O in Loop / Database in Loop (Must be checked FIRST!)
  if (
    t.includes('io_in_loop') ||
    t.includes('io-in-loop') ||
    t.includes('io-like') ||
    t.includes('readfile') ||
    t.includes('writehead') ||
    t.includes('stdout') ||
    t.includes('query') ||
    t.includes('database') ||
    t.includes('socket') ||
    t.includes('http') ||
    t.includes('fetch') ||
    t.includes('write')
  ) {
    if (t.includes('stdout') || t.includes('process.stdout') || t.includes('console')) {
      return 'Buffer stdout/logging streams or aggregate log messages outside the loop iteration to prevent synchronous I/O blocking.';
    }
    if (t.includes('readfile') || t.includes('file') || t.includes('writehead') || t.includes('res.') || t.includes('join(')) {
      return 'Pre-load static files into an in-memory cache or Map before iteration, or stream responses asynchronously rather than executing synchronous file reads per loop step.';
    }
    return 'Batch database queries or async requests outside the loop body using bulk operations (e.g. Promise.all or SQL IN clauses) to eliminate N+1 latency compounding.';
  }

  // 2. Dangerous Deserialization / Injection Sinks
  if (
    t.includes('pickle') ||
    t.includes('yaml') ||
    t.includes('deserialization') ||
    t.includes('eval') ||
    t.includes('exec') ||
    t.includes('os.system') ||
    t.includes('subprocess') ||
    t.includes('sink')
  ) {
    return 'Replace unsafe dynamic evaluation or deserialization (`pickle.loads`, `eval`, `exec`) with safe alternatives (`json.loads`, `yaml.safe_load`) to prevent Remote Code Execution (RCE).';
  }

  // 3. Forbidden / Unmetered Builtin Calls
  if (t.includes('forbidden') || t.includes('safeabs') || t.includes('abs(') || t.includes('unmetered')) {
    return 'Replace direct unmetered built-in calls with the approved, rate-metered `SafeAbs` wrapper function to satisfy policy compliance gates.';
  }

  // 4. Nested Loop Complexity & Algorithmic Bottlenecks (ONLY when not I/O)
  if (
    t.includes('nested') ||
    t.includes('complexity') ||
    t.includes('o(n^2)') ||
    t.includes('o(n^') ||
    t.includes('bottleneck')
  ) {
    return 'Refactor the nested loop by hoisting invariant call expressions outside the inner loop block, or use a pre-computed dictionary/set lookup to reduce algorithmic runtime from O(N^2) to O(N).';
  }

  // 5. Cross-File Fanout & Architectural Coupling
  if (t.includes('fanout') || t.includes('blast') || t.includes('coupling') || t.includes('architecture')) {
    return 'Encapsulate this high-fanout function inside a facade module or interface to reduce coupling and prevent cross-file breaking change propagation.';
  }

  return 'Review the highlighted code span and refactor using validated parameter boundaries, in-memory caching, and sanitized helper interfaces.';
}

interface RemediateFindingResponse {
  suggestion: string;
}

export async function requestRemediationSuggestion(
  candidate: RemediationCandidate,
  findingTitle: string,
): Promise<string> {
  // 1. Try Direct Gemini if API key available
  if (directApiKey) {
    try {
      const prompt = `Finding: ${findingTitle}\nReason: ${candidate.reason}\nSkeleton:\n${candidate.anonymizedSkeleton}`;
      const sys = 'You are a senior code reviewer. Give ONE short concrete remediation suggestion (max 2 sentences).';
      return await callDirectGemini(prompt, sys);
    } catch (err) {
      console.warn('[Remediation] Direct Gemini failed:', err);
    }
  }

  // 2. Try Firebase Cloud Functions if configured
  if (isFirebaseConfigured) {
    try {
      const remediateFinding = httpsCallable<
        { findingTitle: string; findingDetail: string; anonymizedSkeleton: string },
        RemediateFindingResponse
      >(getFunctionsInstance(), 'remediateFinding');

      const result = await remediateFinding({
        findingTitle,
        findingDetail: candidate.reason,
        anonymizedSkeleton: candidate.anonymizedSkeleton,
      });
      if (result.data?.suggestion) {
        return result.data.suggestion;
      }
    } catch (err) {
      console.warn('[Remediation] Firebase Cloud Function failed, using local heuristic:', err);
    }
  }

  // 3. Guaranteed Local Rule-Based Heuristic Fallback
  return generateFallbackRemediation(findingTitle, candidate.reason);
}

interface DistillCorrectionResponse {
  type: PolicyRuleType;
  description: string;
}

export async function requestRuleDistillation(params: {
  originalFindingSkeleton: string;
  rejectedRemediationText: string;
  developerReplacementText: string;
}): Promise<DistillCorrectionResponse> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured for Cloud Functions.');
  }

  const distillCorrection = httpsCallable<typeof params, DistillCorrectionResponse>(
    getFunctionsInstance(),
    'distillCorrection',
  );
  const result = await distillCorrection(params);
  return result.data;
}

interface AskCodeAssistantResponse {
  answer: string;
}

export async function requestChatAssistant(params: {
  question: string;
  codeContext?: string;
  findingsContext?: string;
  activeRulesContext?: string;
  filePath?: string;
}): Promise<string> {
  // 1. Try Direct Gemini REST API first if configured
  if (directApiKey) {
    const prompt =
      `User Question: ${params.question}\n\n` +
      `File Name / Path: ${params.filePath ?? 'active_file'}\n\n` +
      `Active Code Context:\n${params.codeContext ?? '(No code loaded)'}\n\n` +
      `Active Historical CSV Rules / Policy Book:\n${params.activeRulesContext ?? '(No CSV rules loaded)'}\n\n` +
      `Active Security & Complexity Findings for this file:\n${params.findingsContext ?? '(No findings detected)'}`;
    const sys =
      'You are an expert AI Code Defense & Security Assistant. Provide clear, direct, and actionable code analysis for the given file. ' +
      'Always reference the Active Historical CSV Rules and Security Findings when answering questions. Format code with markdown code blocks.';

    return await callDirectGemini(prompt, sys);
  }

  // 2. Try Firebase Cloud Function if available
  if (isFirebaseConfigured) {
    const askCodeAssistant = httpsCallable<typeof params, AskCodeAssistantResponse>(
      getFunctionsInstance(),
      'askCodeAssistant',
    );
    const result = await askCodeAssistant(params);
    return result.data.answer;
  }

  throw new Error('Neither Direct Gemini API nor Firebase Cloud Function is configured.');
}
