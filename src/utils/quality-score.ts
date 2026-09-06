/**
 * Standardized Code Quality Rating Calculator (Scale: 1.0 to 10.0)
 * Evaluates code submissions based on AST static analysis, security severity,
 * complexity bottlenecks, and test verdicts.
 */
import type { PolicyViolation } from '../types/rules';
import type { PodFinding } from '../types/pods';
import type { TestVerdict } from '../types/verdicts';

export interface CodeQualityBreakdown {
  score: number; // 1.0 to 10.0
  formattedScore: string; // e.g. "8.5"
  tier: 'Exceptional' | 'Good' | 'Moderate' | 'Needs Improvement' | 'Critical Issues';
  securityDeductions: number;
  complexityDeductions: number;
  architectureDeductions: number;
  fuzzDeductions: number;
}

export function calculateCodeQualityScore(
  violations: PolicyViolation[],
  findings: PodFinding[],
  verdicts: TestVerdict[],
): CodeQualityBreakdown {
  let baseScore = 10.0;

  // Deductions for Policy Violations
  let securityDeductions = 0;
  for (const v of violations) {
    if (v.severity === 'error') securityDeductions += 1.8;
    else if (v.severity === 'warn') securityDeductions += 0.8;
    else securityDeductions += 0.3;
  }

  // Deductions for Pod Findings
  let complexityDeductions = 0;
  let architectureDeductions = 0;

  for (const f of findings) {
    if (f.podId === 'security') {
      if (f.severity === 'error') securityDeductions += 1.5;
      else securityDeductions += 0.7;
    } else if (f.podId === 'complexity') {
      if (f.severity === 'error') complexityDeductions += 1.2;
      else complexityDeductions += 0.6;
    } else if (f.podId === 'architecture') {
      if (f.severity === 'error') architectureDeductions += 1.0;
      else architectureDeductions += 0.5;
    }
  }

  // Deductions for CP-Fuzz Test Failures
  let fuzzDeductions = 0;
  if (verdicts.length > 0) {
    const failedVerdicts = verdicts.filter((v) => v.status !== 'AC').length;
    fuzzDeductions += (failedVerdicts / verdicts.length) * 3.0;
  }

  const totalDeductions = securityDeductions + complexityDeductions + architectureDeductions + fuzzDeductions;
  const finalScore = Math.max(1.0, Math.min(10.0, baseScore - totalDeductions));
  const rounded = Math.round(finalScore * 10) / 10;

  let tier: CodeQualityBreakdown['tier'] = 'Exceptional';
  if (rounded >= 9.0) tier = 'Exceptional';
  else if (rounded >= 7.5) tier = 'Good';
  else if (rounded >= 5.5) tier = 'Moderate';
  else if (rounded >= 3.5) tier = 'Needs Improvement';
  else tier = 'Critical Issues';

  return {
    score: rounded,
    formattedScore: rounded.toFixed(1),
    tier,
    securityDeductions,
    complexityDeductions,
    architectureDeductions,
    fuzzDeductions,
  };
}
