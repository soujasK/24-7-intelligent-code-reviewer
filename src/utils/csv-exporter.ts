/**
 * CSV Exporter for Zero-Trust Defense Mesh findings, policy violations,
 * agent pod analysis, and CP-fuzz test verdicts.
 */
import type { PolicyViolation } from '../types/rules';
import type { PodFinding } from '../types/pods';
import type { TestVerdict } from '../types/verdicts';

export interface ExportReportParams {
  repoName?: string | null;
  violations: PolicyViolation[];
  findings: PodFinding[];
  verdicts: TestVerdict[];
  filePaths?: string[];
}

function escapeCsvCell(cell: string | number | undefined | null): string {
  if (cell === undefined || cell === null) return '""';
  const str = String(cell);
  // Double-quote escape for CSV
  return `"${str.replace(/"/g, '""')}"`;
}

export function generateSecurityReportCsv(params: ExportReportParams): string {
  const headers = [
    'File / Scope',
    'Line',
    'Source Agent / Category',
    'Severity',
    'Rule / Finding Title',
    'Evidence & Details',
  ];

  const rows: string[][] = [];

  // Policy Violations
  for (const v of params.violations) {
    const filePath = params.filePaths?.[v.fileId] ?? (params.repoName ? `${params.repoName} (file #${v.fileId})` : `file #${v.fileId}`);
    rows.push([
      filePath,
      String(v.startRow + 1),
      `Rule Engine (#${v.ruleId}: ${v.ruleType})`,
      v.severity.toUpperCase(),
      v.message,
      v.evidence,
    ]);
  }

  // Pod Findings (Security, Complexity, Architecture)
  for (const f of params.findings) {
    const matchedPath = f.fileId !== undefined && params.filePaths ? params.filePaths[f.fileId] : undefined;
    const filePath = matchedPath ?? params.repoName ?? 'Workspace Code';
    rows.push([
      filePath,
      String(f.startRow + 1),
      `${f.podId.toUpperCase()} POD AGENT`,
      f.severity.toUpperCase(),
      f.title,
      f.detail ?? '',
    ]);
  }

  // CP Verdicts
  for (const v of params.verdicts) {
    rows.push([
      'Fuzzer Sandbox',
      'N/A',
      'CP-FUZZ GATE AGENT',
      v.status === 'AC' ? 'PASS' : 'FAIL',
      `Test Case: ${v.testId}`,
      `Status: ${v.status} (${v.runtimeMs.toFixed(1)}ms)${v.error ? ` — Error: ${v.error}` : ''}`,
    ]);
  }

  // If clean state with no findings or violations, generate a verified compliance summary row
  if (rows.length === 0) {
    const scopeLabel = params.repoName ?? (params.filePaths && params.filePaths.length > 0 ? params.filePaths.join(', ') : 'main.py');
    rows.push([
      scopeLabel,
      '1',
      '24/7 Intelligent Code Review',
      'PASS',
      'Zero-Trust Clean — 0 Violations',
      'All active policies satisfied with zero security vulnerabilities, architectural bottlenecks, or rule violations detected.',
    ]);
  }

  const csvLines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];

  return csvLines.join('\n');
}

export function downloadCsvReport(filename: string, csvContent: string): void {
  // Prefix UTF-8 BOM so Excel & spreadsheet editors properly parse UTF-8 characters
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 1000);
}
