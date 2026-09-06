/**
 * Server-side LLM surface for the Zero-Trust Wasm Code Defense Mesh.
 *
 * Two callable functions, both requiring auth, both receiving ONLY the
 * already-anonymized AST skeleton (src/workers/sanitizer.ts on the client)
 * — never raw source. The Gemini API key lives here, never in client code.
 *
 * Local dev: values in .env (gitignored) are auto-loaded by
 * `firebase emulators:start`. Production: migrate GEMINI_API_KEY to
 * Secret Manager via `firebase functions:secrets:set GEMINI_API_KEY` —
 * defineSecret() below already reads from either source transparently.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenAI, Type } from '@google/genai';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Fast/cheap tier — both calls here are short input, short output, no
// multi-step reasoning required. Bump to a "pro"-tier model if remediation
// quality needs it; check ai.google.dev/gemini-api/docs/models for the
// current lineup if this id has since been retired.
const MODEL_ID = 'gemini-2.5-flash';

function getClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: geminiApiKey.value() });
}

// ---------------------------------------------------------------------------
// remediateFinding — Security/Complexity pod "requiresRemediation" findings.
// ---------------------------------------------------------------------------
interface RemediateFindingRequest {
  findingTitle: string;
  findingDetail: string;
  anonymizedSkeleton: string;
}
interface RemediateFindingResponse {
  suggestion: string;
}

export const remediateFinding = onCall<RemediateFindingRequest, Promise<RemediateFindingResponse>>(
  { secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const { findingTitle, findingDetail, anonymizedSkeleton } = request.data ?? ({} as RemediateFindingRequest);
    if (!anonymizedSkeleton) {
      throw new HttpsError('invalid-argument', 'anonymizedSkeleton is required.');
    }

    const response = await getClient().models.generateContent({
      model: MODEL_ID,
      contents:
        `Finding: ${findingTitle ?? '(untitled)'}\n` +
        `Detail: ${findingDetail ?? ''}\n` +
        `Anonymized code skeleton:\n${anonymizedSkeleton}`,
      config: {
        systemInstruction:
          'You are a senior code reviewer. The code skeleton has every identifier replaced ' +
          'with a role-based placeholder (var_1, arg_2, fn_3, Cls_4, ...) and every literal ' +
          'replaced with a <TYPE> tag — you cannot see real names, strings, or numbers. Give ' +
          'ONE short, concrete remediation suggestion (max 2 sentences) referencing ' +
          'placeholders generically. Do not restate the skeleton back.',
        maxOutputTokens: 200,
        temperature: 0.3,
      },
    });

    const suggestion = response.text?.trim();
    if (!suggestion) throw new HttpsError('internal', 'Model returned an empty response.');
    return { suggestion };
  },
);

// ---------------------------------------------------------------------------
// distillCorrection — closed-loop institutional memory. Same contract as the
// local heuristic in src/workers/institutional-memory.worker.ts; this is the
// "smarter" implementation the client can call instead when it wants one.
// ---------------------------------------------------------------------------
const RULE_TYPES = [
  'IO_IN_LOOP',
  'NESTED_LOOP_COMPLEXITY',
  'UNSANITIZED_DESERIALIZATION',
  'FORBIDDEN_CALL',
  'BLAST_RADIUS_FANOUT',
  'NAMING_CONVENTION',
  'GENERIC_KEYWORD_MATCH',
] as const;
type RuleType = (typeof RULE_TYPES)[number];

interface DistillCorrectionRequest {
  originalFindingSkeleton: string;
  rejectedRemediationText: string;
  developerReplacementText: string;
}
interface DistillCorrectionResponse {
  type: RuleType;
  description: string;
}

function isRuleType(value: string): value is RuleType {
  return (RULE_TYPES as readonly string[]).includes(value);
}

export const distillCorrection = onCall<DistillCorrectionRequest, Promise<DistillCorrectionResponse>>(
  { secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const { originalFindingSkeleton, rejectedRemediationText, developerReplacementText } =
      request.data ?? ({} as DistillCorrectionRequest);
    if (!developerReplacementText) {
      throw new HttpsError('invalid-argument', 'developerReplacementText is required.');
    }

    const response = await getClient().models.generateContent({
      model: MODEL_ID,
      contents:
        `Flagged (anonymized) skeleton:\n${originalFindingSkeleton ?? ''}\n\n` +
        `AI-suggested remediation the developer REJECTED:\n${rejectedRemediationText ?? ''}\n\n` +
        `What the developer committed instead (may name real internal APIs — that's expected):\n` +
        `${developerReplacementText}`,
      config: {
        systemInstruction:
          "Distill this developer correction into ONE reusable policy rule for a static-" +
          "analysis rule library. Name the specific API/pattern from the developer's " +
          'replacement if one is visible (e.g. "Use our internal `CacheWrapper` instead of ' +
          '`functools.lru_cache`"). Pick the single best-fitting rule type.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: [...RULE_TYPES] },
            description: { type: Type.STRING },
          },
          required: ['type', 'description'],
        },
        temperature: 0.2,
      },
    });

    const raw = response.text?.trim();
    if (!raw) throw new HttpsError('internal', 'Model returned an empty response.');

    let parsed: { type?: string; description?: string };
    try {
      parsed = JSON.parse(raw) as { type?: string; description?: string };
    } catch {
      throw new HttpsError('internal', 'Model returned malformed JSON.');
    }
    if (!parsed.description) {
      throw new HttpsError('internal', 'Model response missing "description".');
    }

    return {
      type: parsed.type && isRuleType(parsed.type) ? parsed.type : 'GENERIC_KEYWORD_MATCH',
      description: parsed.description,
    };
  },
);

// ---------------------------------------------------------------------------
// askCodeAssistant — Interactive AI Security Assistant chatbot.
// Accepts user questions with code and findings context.
// ---------------------------------------------------------------------------
interface AskCodeAssistantRequest {
  question: string;
  codeContext?: string;
  findingsContext?: string;
  activeRulesContext?: string;
}
interface AskCodeAssistantResponse {
  answer: string;
}

export const askCodeAssistant = onCall<AskCodeAssistantRequest, Promise<AskCodeAssistantResponse>>(
  { secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const { question, codeContext, findingsContext, activeRulesContext } = request.data ?? ({} as AskCodeAssistantRequest);
    if (!question) {
      throw new HttpsError('invalid-argument', 'Question is required.');
    }

    const response = await getClient().models.generateContent({
      model: MODEL_ID,
      contents:
        `User Question: ${question}\n\n` +
        `Active Code Context:\n${codeContext ?? '(No code loaded)'}\n\n` +
        `Active Historical CSV Rules / Policy Book:\n${activeRulesContext ?? '(No CSV rules loaded)'}\n\n` +
        `Active Security & Complexity Findings:\n${findingsContext ?? '(No findings yet)'}`,
      config: {
        systemInstruction:
          'You are an expert AI Code Defense & Security Assistant. Provide concise, clear, and actionable ' +
          'answers to the user about their code, security vulnerabilities, performance complexity, and active historical CSV policy rules. ' +
          'Always reference the Active Historical CSV Rules when relevant. Format code snippets using markdown code blocks.',
        temperature: 0.3,
      },
    });

    const answer = response.text?.trim();
    if (!answer) throw new HttpsError('internal', 'Model returned an empty response.');
    return { answer };
  },
);

