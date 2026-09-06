/**
 * Parses historical review CSV datasets in the hackathon brief schema:
 * `<id>, <type>, <description>`
 */
import type { RawPolicyRule } from '../types/rules';

export function parseHistoricalReviewCsv(csvText: string): RawPolicyRule[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const rules: RawPolicyRule[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip header line if present
    if (i === 0 && (line.toLowerCase().startsWith('id') || line.toLowerCase().includes('description'))) {
      continue;
    }

    // Split CSV line handling optional quotes
    const parts = line.match(/(?:^|,)\s*(?:"([^"]*)"|([^,]*))/g);
    if (!parts || parts.length < 3) {
      // Fallback simple comma split
      const rawParts = line.split(',').map((p) => p.trim());
      if (rawParts.length >= 3) {
        const id = parseInt(rawParts[0] ?? `${i + 1}`, 10) || (i + 1);
        const type = rawParts[1] ?? 'general';
        const description = rawParts.slice(2).join(', ').replace(/^"|"$/g, '').trim();
        rules.push({ id, type, description });
      }
      continue;
    }

    const cleanParts = parts.map((p) => p.replace(/^,\s*/, '').replace(/^"|"$/g, '').trim());
    const id = parseInt(cleanParts[0] ?? `${i + 1}`, 10) || (i + 1);
    const type = cleanParts[1] ?? 'general';
    const description = cleanParts.slice(2).join(', ');

    if (description) {
      rules.push({ id, type, description });
    }
  }

  return rules;
}

export const SAMPLE_HISTORICAL_RULES_CSV = `id, type, description
1, formatting, Avoid single-character variable names — they hurt readability
2, performance, Cache repeated database lookups inside the request loop
3, security, Never interpolate raw user input directly into SQL queries
4, nested-loop-complexity, Nested loops 2 or more deep that call another function are O(N^2) candidates and must be reviewed.
5, forbidden-call, Direct call to built-in abs() or unmetered math is forbidden; use SafeAbs wrapper.
6, io-in-loop, Database queries and I/O operations inside loop iterations cause severe latency compounding.
7, unsanitized-deserialization, Never call pickle.loads or eval on raw unverified user data.
`;
