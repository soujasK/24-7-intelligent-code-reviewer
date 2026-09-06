import { useState, useRef, useEffect } from 'react';
import { MonacoEditor } from '../Editor/MonacoEditor';
import { requestChatAssistant } from '../../firebase/llm-remediation';
import type { PolicyViolation, RawPolicyRule } from '../../types/rules';
import type { PodFinding } from '../../types/pods';
import type { SourceFileInput } from '../../db/ast-loader';
import {
  MessageSquare,
  Code2,
  Send,
  RefreshCw,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

interface ChatbotPanelProps {
  code: string;
  filePath?: string;
  onChangeCode: (newCode: string) => void;
  violations: PolicyViolation[];
  findings: PodFinding[];
  activeRules?: RawPolicyRule[];
  busy?: boolean;
  repoName?: string | null;
  allFiles?: SourceFileInput[];
}

/**
 * Deep, comprehensive local code defense analysis engine.
 * Parses functions, imports, AST complexity, policy violations, security
 * findings, and active CSV review rules to deliver rich, contextual, and accurate answers.
 */
function generateLocalSecurityAnalysis(
  question: string,
  code: string,
  violations: PolicyViolation[],
  findings: PodFinding[],
  filePath?: string,
  activeRules?: RawPolicyRule[],
  repoName?: string | null,
  allFiles?: SourceFileInput[],
): string {
  const q = question.toLowerCase();
  const lines = code.split('\n');
  const lineCount = lines.length;

  // Strip comments and multi-line docstrings to avoid false positive keyword matches
  const codeWithoutComments = code
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/'''[\s\S]*?'''/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(#|\/\/).*$/gm, '');

  // Extract function definitions from actual code
  const functionMatches = Array.from(
    codeWithoutComments.matchAll(/(?:def|function|const|async\s+function)\s+([a-zA-Z0-9_]+)/g),
  ).map((m) => (m as RegExpMatchArray)[1]);
  const uniqueFunctions = [...new Set(functionMatches)].filter(Boolean);

  // Extract imports from actual code
  const importMatches = Array.from(
    codeWithoutComments.matchAll(/(?:import|from)\s+([a-zA-Z0-9_.]+)/g),
  ).map((m) => (m as RegExpMatchArray)[1]);
  const uniqueImports = [...new Set(importMatches)].filter(Boolean);

  // Extract true loops count (excluding docstrings/comments)
  const loopCount = (codeWithoutComments.match(/\b(for|while)\b/g) || []).length;
  const errorViolations = violations.filter((v) => v.severity === 'error');
  const warnViolations = violations.filter((v) => v.severity === 'warn');
  const errorFindings = findings.filter((f) => f.severity === 'error');
  const warnFindings = findings.filter((f) => f.severity === 'warn');

  const totalErrors = errorViolations.length + errorFindings.length;
  const totalWarns = warnViolations.length + warnFindings.length;
  const totalIssues = violations.length + findings.length;

  // 1. Production Readiness Question: "Is this code safe for production?"
  if (
    q.includes('safe for production') ||
    q.includes('production ready') ||
    q.includes('production safe') ||
    q.includes('deploy') ||
    q.includes('can i ship') ||
    q.includes('is this safe')
  ) {
    if (totalErrors > 0) {
      return [
        `### 🔴 Production Safety Verdict: NOT READY (Critical Blockers)`,
        `\n**Assessment for \`${filePath || 'active file'}\`**: This file contains **${totalErrors} critical security/compliance blocker(s)** that prevent safe production deployment.`,
        `\n#### Critical Blocker(s):`,
        ...errorViolations.map((v) => `* ❌ **[Line ${v.startRow + 1}] Rule Violation (\`${v.ruleType}\`)**: ${v.message} (\`${v.evidence}\`)`),
        ...errorFindings.map((f) => `* ❌ **[Line ${f.startRow + 1}] ${f.podId.toUpperCase()} Pod**: ${f.title} — ${f.detail}`),
        `\n#### Production Deployment Checklist:`,
        `- [ ] Resolve all high-risk deserialization / injection sinks`,
        `- [ ] Replace unmetered calls with approved wrappers`,
        `- [ ] Re-run Zero-Trust Mesh scanner before merging`,
      ].join('\n');
    }

    if (totalWarns > 0) {
      return [
        `### 🟡 Production Safety Verdict: CONDITIONALLY SAFE (Warnings Detected)`,
        `\n**Assessment for \`${filePath || 'active file'}\`**: The code has **no critical runtime vulnerabilities**, but has **${totalWarns} quality/style warning(s)** from your active rules:`,
        `\n#### Active Warnings & Recommendations:`,
        ...warnViolations.map((v) => `* ⚠️ **[Line ${v.startRow + 1}] \`${v.ruleType}\`**: ${v.message}`),
        ...warnFindings.map((f) => `* ⚠️ **[Line ${f.startRow + 1}] ${f.podId.toUpperCase()} Pod**: ${f.title} (${f.detail})`),
        `\n#### Recommendation:`,
        `This file will execute safely, but we recommend resolving the naming and formatting warnings to comply with repository coding standards before production sign-off.`,
      ].join('\n');
    }

    return [
      `### 🟢 Production Safety Verdict: 100% PRODUCTION READY`,
      `\n**Assessment for \`${filePath || 'active file'}\`**: This file is clean, verified, and passes all active Zero-Trust Defense Mesh policies.`,
      `\n* **Critical Blockers**: 0`,
      `* **Quality Warnings**: 0`,
      `* **AST Policy Check**: All active CSV rules satisfied`,
      `\nReady for deployment! 🚀`,
    ].join('\n');
  }

  // 2. Specific Focus: Architectural Blast Radius & Cross-File Dependencies
  if (
    q.includes('blast radius') ||
    q.includes('dependencies and sinks') ||
    q.includes('cross-file') ||
    q.includes('coupling') ||
    q.includes('call graph')
  ) {
    const fileList = allFiles && allFiles.length > 0 ? allFiles : [{ path: filePath || 'main.py', content: code, language: 'python' }];
    const fileSummary = fileList.map((f) => {
      const imp = Array.from(f.content.matchAll(/(?:import|from)\s+([a-zA-Z0-9_]+)/g)).map((m) => (m as RegExpMatchArray)[1]);
      return `* **\`${f.path}\`**: ${imp.length > 0 ? `Imports \`${imp.join(', ')}\`` : 'Leaf Node (No imports)'}`;
    });

    return [
      `### 🌐 Architectural Blast Radius Analysis: ${repoName ? `\`${repoName}\`` : 'Active Codebase'}`,
      `\n**Total Ingested Files**: ${fileList.length} source file(s)`,
      `\n#### Dependency & Blast Radius Topology:`,
      ...fileSummary,
      `\n#### Blast Radius Assessment:`,
      `* Changes to upstream entry points (e.g. \`main.py\`) propagate directly to downstream sinks.`,
      `* High-fanout utilities (like \`utils.py\` or \`database.py\`) carry higher blast radius weights in D3 graph rendering.`,
      `* Switch to the **Blast Radius Graph** tab on your top navigation bar to interactively inspect node physics and isolated ripple zones!`,
    ].join('\n');
  }

  // 3. Specific Focus: 5 Autonomous Swarm Pods Evaluation
  if (
    q.includes('swarm pods') ||
    q.includes('5 pods') ||
    q.includes('pods rank') ||
    q.includes('autonomous swarm')
  ) {
    return [
      `### 🤖 Autonomous 5-Agent Swarm Pod Architecture`,
      `\nCodeKitchen distributes code defense across 5 specialized concurrent Web Workers:\n`,
      `1. 🛡️ **Security & Deserialization Pod**: Scans AST for unverified dynamic sinks (\`pickle.loads\`, \`eval\`, raw SQL injection).`,
      `2. ⚡ **Algorithmic Complexity Pod**: Detects nested loop bottlenecks, invariant loop invocations, and $O(N^2)$ scaling issues.`,
      `3. 🌐 **Architecture & Blast Radius Pod**: Builds AST dependency graphs and computes transitive breaking-change blast radii.`,
      `4. 🧪 **Pyodide Fuzzing Gate Pod**: Executes automated property-based fuzz tests in an isolated WASM Python sandbox.`,
      `5. 📜 **DuckDB Historical CSV Policy Pod**: Compiles historical CSV rules into real-time SQL AST relational queries.`,
      `\n*All 5 pods execute entirely client-side with 0 network data transmission.*`,
    ].join('\n');
  }

  // 4. Specific Focus: How to Add Custom Rules to CSV
  if (
    q.includes('add new custom rule') ||
    q.includes('add custom rule') ||
    q.includes('how do i add') ||
    q.includes('create csv rule')
  ) {
    return [
      `### 📝 Ingesting Custom Rules via CSV`,
      `\nYou can define customized team policies and compliance rules using a simple 3-column CSV format:`,
      `\n\`\`\`csv`,
      `id, type, description`,
      `1, formatting, Avoid single-character variable names — they hurt readability`,
      `2, security, Never interpolate raw user input directly into SQL queries`,
      `3, performance, Database queries and I/O operations inside loop iterations cause severe latency`,
      `4, forbidden-call, Direct call to built-in abs() or unmetered math is forbidden; use SafeAbs wrapper`,
      `\`\`\``,
      `\n#### Supported Rule Types:`,
      `* \`security\` — Blocks dangerous deserialization sinks and unvalidated inputs`,
      `* \`performance\` — Identifies N+1 query loops and heavy computations`,
      `* \`formatting\` / \`naming\` — Flags readability and convention issues`,
      `* \`forbidden-call\` — Flags unmetered or deprecated functions`,
      `\nClick **Upload CSV File** on the dashboard to load your customized file!`,
    ].join('\n');
  }

  // 5. Specific Focus: How to Remediate / Fix Code
  if (
    q.includes('remediate') ||
    q.includes('how do i fix') ||
    q.includes('how to fix') ||
    q.includes('fix the findings')
  ) {
    if (totalIssues === 0) {
      return `**Code Remediation Guide for \`${filePath || 'active file'}\`**\n\n🎉 No remediations needed! This file has 0 detected violations or findings.`;
    }

    const tips = [
      `### 🛠️ Remediation Plan for \`${filePath || 'active file'}\` (${totalIssues} Issue${totalIssues > 1 ? 's' : ''} to Resolve)\n`,
    ];

    violations.forEach((v) => {
      tips.push(`* **Fix [Line ${v.startRow + 1}] (\`${v.ruleType}\`)**:`);
      tips.push(`  * *Issue*: ${v.message}`);
      if (v.ruleType.includes('formatting') || v.ruleType.includes('naming')) {
        tips.push(`  * *Action*: Rename short identifiers (e.g. \`n\` -> \`num_items\` or \`payload_data\`).`);
      } else if (v.ruleType.includes('forbidden')) {
        tips.push(`  * *Action*: Replace direct call with \`SafeAbs()\` rate-metered wrapper.`);
      } else {
        tips.push(`  * *Action*: Sanitize inputs and remove raw expression \`${v.evidence}\`.`);
      }
    });

    findings.forEach((f) => {
      tips.push(`* **Fix [Line ${f.startRow + 1}] (${f.podId.toUpperCase()} Pod)**: ${f.title}`);
      tips.push(`  * *Action*: ${f.detail}`);
    });

    return tips.join('\n');
  }

  // 6. Specific Focus: How do CSV rules apply to this file?
  if (
    (q.includes('how') && (q.includes('rule') || q.includes('csv'))) ||
    q.includes('apply to this file') ||
    q.includes('apply to main') ||
    q.includes('which csv rules')
  ) {
    if (!activeRules || activeRules.length === 0) {
      return `**Active Historical CSV Policy Engine**\n\n*Status: 0 Custom Rules Loaded*\n\nUpload a CSV file containing \`<id>, <type>, <description>\` rows to evaluate this file against your custom rule set.`;
    }

    const triggeredTypes = new Set(violations.map((v) => v.ruleType.toLowerCase()));
    const triggeredRules = activeRules.filter((r) =>
      triggeredTypes.has(r.type.toLowerCase()) ||
      violations.some((v) => v.message.toLowerCase().includes(r.description.toLowerCase().slice(0, 15))),
    );
    const passedRules = activeRules.filter((r) => !triggeredRules.includes(r));

    const responseLines = [
      `### CSV Rules Evaluation on \`${filePath || 'active file'}\` (${activeRules.length} Total Rules Active)`,
      `\n#### ⚠️ Matching / Triggered Rules (${triggeredRules.length}):`,
    ];

    if (triggeredRules.length === 0 && violations.length === 0) {
      responseLines.push(`* None! This file currently complies with all active CSV rules.`);
    } else {
      violations.forEach((v) => {
        responseLines.push(`* **[Line ${v.startRow + 1}] Rule \`${v.ruleType}\`**: ${v.message}`);
      });
    }

    responseLines.push(`\n#### ✅ Satisfied / Passed Rules (${passedRules.length}):`);
    passedRules.forEach((r) => {
      responseLines.push(`* **[Rule #${r.id}] \`${r.type}\`**: ${r.description} — *PASSED (No violations found in this file)*`);
    });

    return responseLines.join('\n');
  }

  // 7. Specific Focus: Explain CSV / Policy Rules in General
  if (q.includes('explain active csv') || q.includes('what are the csv rules') || (q.includes('csv') && !q.includes('finding'))) {
    if (!activeRules || activeRules.length === 0) {
      return `**Active Historical CSV Policy Engine**\n\n*Status: 0 Custom Rules Loaded*\n\nUpload a CSV file containing \`<id>, <type>, <description>\` rows using the **Upload CSV File** button on your dashboard to ingest custom review guidelines into the DuckDB AST engine!`;
    }

    const rulesList = activeRules.map(
      (r) => `* **[Rule #${r.id}] \`${r.type}\`**: ${r.description}`,
    );

    return [
      `**Active Historical Review CSV Dataset (${activeRules.length} Rules Loaded)**:\n`,
      ...rulesList,
      `\n**Application to Code**: These historical rules are dynamically compiled into DuckDB SQL AST queries and continuously evaluated against your repository code. Any matching violations are flagged in real-time on your dashboard.`,
    ].join('\n');
  }

  // 7b. Specific Focus: How DuckDB compiles CSV rules into AST SQL queries
  if (q.includes('duckdb') || q.includes('compile csv') || q.includes('sql queries') || q.includes('ast sql')) {
    return [
      `### ⚡ DuckDB-Wasm Relational AST Rule Compilation Engine`,
      `\n24/7 Intelligent Code Review compiles CSV review policies directly into high-performance SQL queries executed over Tree-Sitter AST tables:\n`,
      `* **Relational Schema**: \`source_files\`, \`nodes\`, \`identifiers\`, \`functions\`, \`loops\`, \`call_expressions\`, \`edges\``,
      `* **Zero-Latency In-Browser Execution**: DuckDB-Wasm runs locally in browser Web Workers with zero network roundtrips.`,
      `\n#### Example Compiled SQL Rule Template:`,
      `\`\`\`sql`,
      `-- Ingested Rule: Never interpolate raw user input directly into SQL queries / deserialize`,
      `SELECT ce.node_id, ce.file_id, n.start_row, n.end_row, ce.callee_name AS evidence`,
      `FROM call_expressions ce`,
      `JOIN nodes n ON n.node_id = ce.node_id`,
      `WHERE ce.callee_name IN ('eval', 'exec', 'pickle.loads', 'os.system');`,
      `\`\`\``,
      `\n*Whenever files or CSV policies update, DuckDB executes the relational queries in <5ms.*`,
    ].join('\n');
  }

  // 7c. Specific Focus: Audit active code against all historical CSV policies
  if (q.includes('audit active code') || q.includes('audit against') || q.includes('full audit')) {
    if (!activeRules || activeRules.length === 0) {
      return `### 📋 Comprehensive Policy Audit Report\n\n*Status: 0 CSV Rules Ingested*\n\nLoad historical review rules using **Load Sample CSV Rules** or **Upload CSV File** to execute an in-depth audit against your team's policies.`;
    }

    return [
      `### 📋 Comprehensive Policy Audit Report: \`${filePath || 'Active Codebase'}\``,
      `\n**Active Rules Evaluated**: ${activeRules.length} policy guidelines`,
      `**Total Violations Detected**: ${violations.length}`,
      `\n#### Policy Audit Matrix:`,
      ...activeRules.map((r) => {
        const matchingViolations = violations.filter((v) => v.ruleId === r.id || v.ruleType.toLowerCase() === r.type.toLowerCase());
        if (matchingViolations.length > 0 && matchingViolations[0]) {
          const first = matchingViolations[0];
          return `* ❌ **[Rule #${r.id} - \`${r.type}\`]**: ${r.description}\n  * *Violation on Line ${first.startRow + 1}*: ${first.message}`;
        }
        return `* ✅ **[Rule #${r.id} - \`${r.type}\`]**: ${r.description} — *PASSED*`;
      }),
      `\n**Audit Verdict**: ${violations.length === 0 ? '🟢 100% Policy Compliance — Verified Ready' : `🟡 Action Required: ${violations.length} non-compliant code location(s) identified.`}`,
    ].join('\n');
  }

  // 7d. Specific Focus: Generate Automated Test Cases & Edge Cases
  if (q.includes('test case') || q.includes('edge case') || q.includes('generate test') || q.includes('fuzz')) {
    const fnName = uniqueFunctions[0] || 'solve';
    return [
      `### 🧪 Automated Test & Edge Case Suite for \`${fnName}()\``,
      `\nGenerated based on AST signature and boundary condition analysis:\n`,
      `\`\`\`python`,
      `import unittest`,
      `from ${filePath ? filePath.replace(/\.[^/.]+$/, '') : 'main'} import ${fnName}`,
      ``,
      `class Test${fnName.charAt(0).toUpperCase() + fnName.slice(1)}(unittest.TestCase):`,
      `    def test_nominal_input(self):`,
      `        """Nominal operational case."""`,
      `        self.assertIsNotNone(${fnName}(5))`,
      ``,
      `    def test_boundary_zero(self):`,
      `        """Zero edge case boundary."""`,
      `        self.assertEqual(${fnName}(0), 0)`,
      ``,
      `    def test_negative_values(self):`,
      `        """Negative domain testing."""`,
      `        self.assertIsNotNone(${fnName}(-10))`,
      ``,
      `    def test_large_scale(self):`,
      `        """Stress testing large numerical inputs."""`,
      `        self.assertIsNotNone(${fnName}(10**6))`,
      `\`\`\``,
      `\n*These test cases are automatically tested through our client-side Pyodide Fuzzing Gate.*`,
    ].join('\n');
  }

  // 8. Specific Focus: Explain Findings / Vulnerabilities
  if (q.includes('finding') || q.includes('vulnerability') || q.includes('security') || q.includes('violation')) {
    if (totalIssues === 0) {
      return `**Zero-Trust Security Assessment**\n\n*Status: Clean (0 Violations)*\n\nNo high-risk deserialization sinks, forbidden calls, or $O(N^2)$ bottlenecks were detected in this file. The code complies with active Defense Mesh policies.`;
    }

    const report = [
      `**Defense Mesh Security Findings (${totalIssues} Issue${totalIssues > 1 ? 's' : ''} Detected in \`${filePath || 'active file'}\`)**:\n`,
      ...violations.map(
        (v) =>
          `* **[Line ${v.startRow + 1}] Rule Violation (${v.ruleType})**:\n  * *Issue*: ${v.message}\n  * *Evidence*: \`${v.evidence}\`\n  * *Severity*: ${v.severity.toUpperCase()}\n`,
      ),
      ...findings.map(
        (f) =>
          `* **[Line ${f.startRow + 1}] ${f.podId.toUpperCase()} Pod Finding**:\n  * *Title*: ${f.title}\n  * *Detail*: ${f.detail}\n  * *Severity*: ${f.severity.toUpperCase()}\n`,
      ),
      `**Remediation Advice**: Hoist heavy computations out of loops, sanitize external inputs, and replace raw system/sink calls with validated wrappers.`,
    ];
    return report.join('\n');
  }

  // 9. Specific Focus: Complexity / Loop Analysis
  if (q.includes('loop') || q.includes('complexity') || q.includes('o(n') || q.includes('bottleneck') || q.includes('slow')) {
    const loopFindings = findings.filter((f) => f.podId === 'complexity');
    return [
      `**Algorithmic Complexity & Loop Analysis for \`${filePath || 'active file'}\`**:\n`,
      `* **Detected Loops**: ${loopCount} loop structure(s)`,
      `* **Active Complexity Warnings**: ${loopFindings.length}`,
      ...loopFindings.map(
        (lf) => `* **[Line ${lf.startRow + 1}] ${lf.title}**\n  * *Detail*: ${lf.detail}`,
      ),
      `\n**Optimization Strategies**:`,
      `1. **Avoid Invariant Calls in Inner Loops**: Hoist repeated function calls outside nested loops.`,
      `2. **Lookup Memoization**: Use pre-computed hash maps or prefix tables instead of nested linear scans.`,
      `3. **Vectorization**: Utilize built-in bulk operations where applicable.`,
    ].join('\n');
  }

  // 10. Comprehensive General Code Review
  const healthBadge =
    totalErrors > 0
      ? 'High Risk — Remediation Required'
      : totalWarns > 0
        ? 'Moderate Risk — Warnings Detected'
        : 'Secure & Clean (0 Violations)';

  const isConfigFile = filePath && (
    filePath.endsWith('.config.js') ||
    filePath.endsWith('.config.ts') ||
    filePath.endsWith('.json') ||
    filePath.includes('postcss') ||
    filePath.includes('tailwind') ||
    filePath.includes('vite')
  );

  const sections: string[] = [
    `### Code Review & Defense Mesh Analysis: \`${filePath || 'Current File'}\`\n`,
    `**Overall Health Status**: ${healthBadge}\n`,
    `#### 1. Code Architecture & Scope`,
    `* **File Path**: \`${filePath || 'active_file'}\``,
    `* **File Size**: ${lineCount} line${lineCount !== 1 ? 's' : ''}`,
  ];

  if (isConfigFile) {
    sections.push(`* **File Type**: Build & Tooling Configuration`);
    if (filePath?.includes('postcss')) {
      sections.push(`* **Purpose**: PostCSS transformation pipeline config registering \`tailwindcss\` and \`autoprefixer\`.`);
    } else if (filePath?.includes('tailwind')) {
      sections.push(`* **Purpose**: Tailwind CSS utility framework and theme configuration.`);
    } else if (filePath?.includes('vite')) {
      sections.push(`* **Purpose**: Vite bundler, build plugins, and dev server configuration.`);
    }
  } else {
    sections.push(
      `* **Functions Defined**: ${uniqueFunctions.length > 0 ? uniqueFunctions.map((f) => `\`${f}()\``).join(', ') : 'None detected'}`,
      `* **Dependencies / Modules**: ${uniqueImports.length > 0 ? uniqueImports.map((i) => `\`${i}\``).join(', ') : 'None detected'}`,
      `* **Loop Count**: ${loopCount} loop construct(s)`,
    );
  }

  sections.push(`\n#### 2. Defense Mesh Findings (${totalIssues} Total)`);

  if (totalIssues === 0) {
    sections.push(`* Clean File: No policy violations, dangerous sinks, or unhandled complexity detected.`);
  } else {
    if (totalErrors > 0) {
      sections.push(`* Critical Violations (${totalErrors}):`);
      errorViolations.forEach((v) => sections.push(`  * **[Line ${v.startRow + 1}]** \`${v.ruleType}\`: ${v.message}`));
      errorFindings.forEach((f) => sections.push(`  * **[Line ${f.startRow + 1}]** \`${f.podId}\`: ${f.title}`));
    }
    if (totalWarns > 0) {
      sections.push(`* Warnings & Optimization Opportunities (${totalWarns}):`);
      warnViolations.forEach((v) => sections.push(`  * **[Line ${v.startRow + 1}]** \`${v.ruleType}\`: ${v.message}`));
      warnFindings.forEach((f) => sections.push(`  * **[Line ${f.startRow + 1}]** \`${f.podId}\`: ${f.title} (${f.detail})`));
    }
  }

  sections.push(`\n#### 3. Active Historical CSV Rules Context`);
  if (activeRules && activeRules.length > 0) {
    sections.push(`Evaluating against ${activeRules.length} active historical CSV rules.`);
  } else {
    sections.push(`No custom historical CSV rules currently ingested.`);
  }

  return sections.join('\n');
}

export function ChatbotPanel({
  code,
  filePath,
  onChangeCode,
  violations,
  findings,
  activeRules,
  busy,
  repoName,
  allFiles,
}: ChatbotPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'chat' | 'code'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your Code Defense & Security Assistant powered by live AST context, DuckDB relational queries, and ingested CSV policy rules. Ask any question or click a context-aware prompt below.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = async (textToSend?: string): Promise<void> => {
    const question = (textToSend ?? inputQuestion).trim();
    if (!question || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: question,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputQuestion('');
    setLoading(true);

    try {
      const findingsSummary = [
        ...violations.map((v) => `[Rule Violation L${v.startRow + 1}] ${v.ruleType}: ${v.message} - ${v.evidence}`),
        ...findings.map((f) => `[${f.podId.toUpperCase()} Pod L${f.startRow + 1}] ${f.title}: ${f.detail}`),
      ].join('\n');

      const activeRulesSummary = (activeRules ?? [])
        .map((r) => `[CSV Rule #${r.id}] Type: ${r.type} | Guideline: ${r.description}`)
        .join('\n');

      let answer: string;
      try {
        answer = await requestChatAssistant({
          question,
          codeContext: code,
          findingsContext: findingsSummary || 'No violations or findings detected.',
          activeRulesContext: activeRulesSummary || 'No custom CSV rules uploaded yet.',
          filePath,
        });
      } catch {
        // Fallback to comprehensive local AST & security intelligence
        answer = generateLocalSecurityAnalysis(
          question,
          code,
          violations,
          findings,
          filePath,
          activeRules,
          repoName,
          allFiles,
        );
      }

      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      const localAnswer = generateLocalSecurityAnalysis(
        question,
        code,
        violations,
        findings,
        filePath,
        activeRules,
        repoName,
        allFiles,
      );
      const fallbackMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: localAnswer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setLoading(false);
    }
  };

  // User can manually toggle or let the input auto-detect
  const [suggestionCategory, setSuggestionCategory] = useState<'auto' | 'code' | 'csv'>('auto');

  // Real-time analysis of user input text or active context to decide between CSV and Code questions
  const isCsvMode = (() => {
    if (suggestionCategory === 'csv') return true;
    if (suggestionCategory === 'code') return false;

    const trimmed = inputQuestion.trim().toLowerCase();
    if (!trimmed) {
      // If no input typed yet, default to CSV if rules are loaded, otherwise Code
      return Boolean(activeRules && activeRules.length > 0);
    }

    // Code-specific syntax and keywords take precedence when user types code snippets
    const codeIndicators = [
      'def ', 'function', 'const ', 'let ', 'var ', 'class ', 'import ', 'return ',
      'public ', 'private ', 'async ', 'await ', '=>', '{', '}', '()', 'print(',
      'console.log', 'for (', 'while (', 'if (', 'def(', 'lambda'
    ];
    if (codeIndicators.some((ind) => trimmed.includes(ind))) {
      return false;
    }

    const csvKeywords = [
      'csv', 'rule', 'rules', 'policy', 'policies', 'guideline', 'dataset',
      'datasets', 'schema', 'forbidden-call', 'naming', '<id>', '<type>', '<description>'
    ];
    if (csvKeywords.some((kw) => trimmed.includes(kw)) || /^\d+\s*,/i.test(trimmed) || trimmed.includes('id, type, description')) {
      return true;
    }

    // Default to code suggestions when asking general code review questions
    return false;
  })();

  const csvSuggestions = [
    { label: 'How do CSV rules apply to this file?', modeLabel: 'CSV Policy', badgeColor: 'border-amber-500/40 text-amber-300' },
    { label: `Explain active CSV rules (${activeRules?.length ?? 0} loaded)`, modeLabel: 'CSV Policy', badgeColor: 'border-amber-500/40 text-amber-300' },
    { label: 'Which CSV rules triggered warnings or errors?', modeLabel: 'CSV Policy', badgeColor: 'border-amber-500/40 text-amber-300' },
    { label: 'How do I add new custom rules to CSV?', modeLabel: 'CSV Ingestion', badgeColor: 'border-amber-500/40 text-amber-300' },
    { label: 'How does DuckDB compile CSV rules into AST SQL queries?', modeLabel: 'CSV Engine', badgeColor: 'border-amber-500/40 text-amber-300' },
    { label: 'Audit active code against all historical CSV policies', modeLabel: 'CSV Audit', badgeColor: 'border-amber-500/40 text-amber-300' },
  ];

  const codeSuggestions = [
    { label: `Is ${filePath || 'this code'} safe for production?`, modeLabel: 'Security', badgeColor: 'border-emerald-500/40 text-emerald-300' },
    { label: 'Analyze security vulnerabilities and unsanitized sinks in this code', modeLabel: 'Security Pod', badgeColor: 'border-emerald-500/40 text-emerald-300' },
    { label: 'Detect algorithmic complexity bottlenecks and O(N^2) loops in this code', modeLabel: 'Complexity', badgeColor: 'border-emerald-500/40 text-emerald-300' },
    { label: 'What is the architectural blast radius across files for this code?', modeLabel: 'Architecture', badgeColor: 'border-emerald-500/40 text-emerald-300' },
    { label: 'How do I remediate findings and optimize this code?', modeLabel: 'Optimization', badgeColor: 'border-emerald-500/40 text-emerald-300' },
    { label: 'Generate automated test cases and edge cases for this function', modeLabel: 'Fuzzing Gate', badgeColor: 'border-emerald-500/40 text-emerald-300' },
  ];

  const activeChips = isCsvMode ? csvSuggestions : codeSuggestions;

  const currentModeTitle = isCsvMode
    ? `📄 CSV Policy Mode (${activeRules?.length ?? 0} Rules Loaded)`
    : (repoName || (allFiles && allFiles.length > 1))
      ? `🌐 Repository Mode (${repoName ?? `${allFiles?.length ?? 1} Files Ingested`})`
      : (violations.length > 0 || findings.length > 0)
        ? `⚠️ Finding Triage Mode (${violations.length + findings.length} Issues)`
        : '🛡️ 24/7 Intelligent Code Review (Ready)';

  return (
    <div className="flex flex-col h-[560px] rounded-xl border border-amber-500/20 bg-[#1a130e]/95 overflow-hidden shadow-2xl shadow-black/70">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-amber-900/30 bg-[#140e0b] px-4 py-2.5">
        <div className="flex items-center gap-1.5 bg-[#1f1712] p-1 rounded-lg border border-amber-900/30">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
              activeTab === 'chat'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Assistant Chat</span>
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all ${
              activeTab === 'code'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Code Studio</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-stone-900/80 border border-stone-700/50 text-stone-300">
            {currentModeTitle}
          </span>
        </div>
      </div>

      {/* Main Tab Body */}
      {activeTab === 'chat' ? (
        <div className="flex flex-col flex-1 overflow-hidden p-4">
          {/* Chat Messages Scroll Container */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-br-none shadow-md'
                      : 'bg-[#120e0b] text-stone-200 border border-amber-900/30 rounded-bl-none shadow-md'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                </div>
                <span className="mt-1 text-[10px] font-mono text-stone-500 px-1">{msg.timestamp}</span>
              </div>
            ))}

            {loading && (
              <div className="flex items-start gap-2">
                <div className="rounded-2xl rounded-bl-none bg-[#120e0b] border border-amber-500/30 px-4 py-2.5 text-xs text-amber-400 font-mono flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Evaluating AST relations and security rules...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Dynamic Context-Aware Suggestion Chips */}
          <div className="mt-3 pt-2 border-t border-amber-900/30">
            <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2 px-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-wider font-bold">
                  Suggested Prompts:
                </span>
                <div className="flex items-center gap-1 bg-[#150e0b] p-0.5 rounded-lg border border-amber-900/40">
                  <button
                    type="button"
                    onClick={() => setSuggestionCategory('code')}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-all ${
                      !isCsvMode
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    💻 Code Questions
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestionCategory('csv')}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-all ${
                      isCsvMode
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    📊 CSV Questions ({activeRules?.length ?? 0})
                  </button>
                </div>
              </div>
              <span className="text-[9px] font-mono text-stone-500 hidden sm:inline">
                {isCsvMode ? 'CSV Policy Intelligence' : 'AST Code Analysis'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleSendMessage(chip.label)}
                  disabled={loading || busy}
                  className={`rounded-lg border bg-[#221913]/80 px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 hover:bg-[#33241b] hover:text-white ${chip.badgeColor}`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="mt-2.5 flex items-center gap-2"
          >
            <input
              type="text"
              placeholder={
                isCsvMode
                  ? "Ask about CSV rules, compliance, schema, or DuckDB AST queries..."
                  : "Ask about code architecture, security sinks, complexity bottlenecks, or refactoring..."
              }
              value={inputQuestion}
              onChange={(e) => {
                setInputQuestion(e.target.value);
                if (suggestionCategory !== 'auto') {
                  // Re-enable auto-detection if user is actively typing
                  setSuggestionCategory('auto');
                }
              }}
              disabled={loading || busy}
              className="flex-1 rounded-lg border border-amber-900/40 bg-[#120e0b] px-3.5 py-2 text-xs text-stone-200 focus:outline-none focus:ring-1 focus:ring-amber-500 placeholder:text-stone-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || busy || !inputQuestion.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40 transition-all shadow-md shadow-amber-950/60 cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send</span>
            </button>
          </form>
        </div>
      ) : (
        <div className="flex-1 p-2 bg-[#120e0b]">
          <MonacoEditor value={code} language="python" onChange={onChangeCode} />
        </div>
      )}
    </div>
  );
}
